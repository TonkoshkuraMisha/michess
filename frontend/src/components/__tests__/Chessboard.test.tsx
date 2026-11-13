// --- FILE: frontend/src/components/__tests__/Chessboard.test.tsx ---
// Поведенческие тесты пяти ключевых сценариев перед декомпозицией Chessboard.tsx (задача 7.13
// из ToDo.md): ход, премув, флаг, сдача, реванш. Гоняем их через партию с историческим ботом —
// она не требует реального WebSocket-рукопожатия и использует тот же executeMove/клок/премув,
// что и настоящий PvP.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import Chessboard from '../Chessboard';
import {mockFetchRouter} from '../../test/mocks';
import {DEFAULT_CONFIG} from '../../services/personalities';
import {resetBotCatalogCache} from '../../services/botCatalog';

vi.mock('../../services/gameSocket', () => ({
    gameSocket: {
        connect: vi.fn(),
        disconnect: vi.fn(),
        send: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
}));

vi.mock('../../services/soundEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/soundEngine')>();
    return {
        ...actual,
        soundEngine: {
            play: vi.fn(),
            isMuted: vi.fn(() => false),
            toggleMute: vi.fn(() => true),
        },
    };
});

const BOT_MOVE_DEFAULT = {uci: 'e7e5', san: 'e5', fen_after: '', source: 'book', comment: 'Классика.', thinking_time_ms: 10};

function renderChessboard() {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <Chessboard/>
        </MemoryRouter>,
    );
}

function squareEl(square: string): HTMLElement {
    const el = document.querySelector(`[data-square="${square}"]`);
    if (!el) throw new Error(`Клетка ${square} не найдена на доске`);
    return el as HTMLElement;
}

function clickSquare(square: string) {
    fireEvent.click(squareEl(square));
}

async function startBotGame(color: 'white' | 'black', botReply: Partial<typeof BOT_MOVE_DEFAULT> = {}) {
    vi.stubGlobal('fetch', mockFetchRouter({
        '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
        '/profile/matchmaking/queue': () => [],
        '/profile/games/live': () => [],
        '/profile/games/my-active': () => ({active: false}),
        '/bots/move': () => ({...BOT_MOVE_DEFAULT, ...botReply}),
        '/bots/save-game': () => ({game_id: 999, status: 'finished', result: '1-0'}),
    }));

    renderChessboard();

    const startButton = await screen.findByRole('button', {name: color === 'white' ? /Белыми/ : /Чёрными/});
    await act(async () => {
        fireEvent.click(startButton);
    });
}

beforeEach(() => {
    resetBotCatalogCache();
    localStorage.setItem('token', 'test-token');
    vi.useFakeTimers({shouldAdvanceTime: true});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('ход', () => {
    it('ход человека на свободную клетку применяется и попадает в журнал ходов', async () => {
        await startBotGame('white');

        clickSquare('e2');
        clickSquare('e4');

        expect(screen.getByText('e4')).toBeInTheDocument();
    });
});

describe('премув', () => {
    it('ход на чужом ходу ставится в очередь и исполняется, когда наступает очередь игрока', async () => {
        await startBotGame('black', {uci: 'e2e4', san: 'e4', thinking_time_ms: 200});

        // Белыми играет бот — сейчас не наш ход, клик должен поставить премув, а не ход.
        clickSquare('e7');
        clickSquare('e5');

        expect(screen.getByText(/Предход: e7 → e5/)).toBeInTheDocument();

        // Бот отвечает, премув должен автоматически исполниться.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });

        await waitFor(() => {
            expect(screen.queryByText(/Предход:/)).not.toBeInTheDocument();
        });
        expect(screen.getByText('e5')).toBeInTheDocument();
    });
});

describe('флаг', () => {
    it('истечение времени завершает партию с ботом поражением по флагу', async () => {
        await startBotGame('white');

        // Тикает каждые 50мс и вычитает реально прошедшее время — 3 минуты с запасом.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 2000);
        });

        expect(screen.getByText(/Флажок упал!.*\(0-1\)/)).toBeInTheDocument();
    });
});

describe('сдача', () => {
    it('подтверждённая сдача завершает партию поражением игрока', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await startBotGame('white');

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сдаться/}));
        });

        expect(screen.getByText(/Вы сдались.*\(0-1\)/)).toBeInTheDocument();
    });

    it('отменённое подтверждение не завершает партию', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        await startBotGame('white');

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сдаться/}));
        });

        expect(screen.queryByText(/Вы сдались/)).not.toBeInTheDocument();
    });
});

describe('реванш', () => {
    it('реванш с ботом стартует новую партию с противоположным цветом игрока', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await startBotGame('white');

        // a8 первой в DOM — доска не перевёрнута (мы играем белыми).
        expect(squareEl('a8')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сдаться/}));
        });
        expect(screen.getByText(/Вы сдались/)).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Реванш/}));
        });

        // Реванш меняет цвет игрока на чёрный — доска переворачивается, h1 теперь первая.
        expect(squareEl('h1')).toBeInTheDocument();
        expect(screen.queryByText(/Вы сдались/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Сдаться/})).toBeInTheDocument();
    });
});

describe('сбой связи с сервером в партии с ботом', () => {
    function stubBotFetch(moveReplies: Array<() => Promise<Response>>) {
        const base = mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
            '/bots/save-game': () => ({game_id: 999, status: 'finished', result: '1-0'}),
        });
        const moveCalls: number[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            if (input.toString().includes('/bots/move')) {
                moveCalls.push(Date.now());
                const reply = moveReplies[Math.min(moveCalls.length - 1, moveReplies.length - 1)];
                return reply();
            }
            return base(input);
        }));
        return moveCalls;
    }

    const okMove = () => Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({...BOT_MOVE_DEFAULT, uci: 'e2e4', san: 'e4', thinking_time_ms: 10}),
    } as unknown as Response);

    async function startAsBlack() {
        renderChessboard();
        const startButton = await screen.findByRole('button', {name: /Чёрными/});
        await act(async () => {
            fireEvent.click(startButton);
        });
    }

    it('бот повторяет запрос после сетевой ошибки и 500 и всё-таки ходит', async () => {
        const moveCalls = stubBotFetch([
            () => Promise.reject(new TypeError('Failed to fetch')),
            () => Promise.resolve({ok: false, status: 500, headers: new Headers(), json: async () => ({})} as unknown as Response),
            okMove,
        ]);
        await startAsBlack();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(4000);
        });

        expect(moveCalls).toHaveLength(3);
        await waitFor(() => expect(screen.getByText('e4')).toBeInTheDocument());
    });

    it('при долгом сбое бот сообщает, что ждёт связи, а не молчит', async () => {
        stubBotFetch([() => Promise.reject(new TypeError('Failed to fetch'))]);
        await startAsBlack();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(4000);
        });

        expect(screen.getByText(/Нет связи с сервером/)).toBeInTheDocument();
    });

    it('постоянная ошибка (4xx) показывается, бот не повторяет запрос бесконечно', async () => {
        const moveCalls = stubBotFetch([() => Promise.resolve({
            ok: false, status: 400, headers: new Headers(),
            json: async () => ({detail: 'Некорректная позиция'}),
        } as unknown as Response)]);
        await startAsBlack();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(4000);
        });

        expect(moveCalls).toHaveLength(1);
        expect(screen.getByText(/Бот не смог сделать ход: Некорректная позиция/)).toBeInTheDocument();
    });
});

describe('партия с ботом с произвольной позиции', () => {
    const KQ_VS_K = 'k7/7Q/1K6/8/8/8/8/8 w - - 0 57';

    function stubBotApi() {
        const fetchMock = mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
            '/bots/move': () => BOT_MOVE_DEFAULT,
            '/bots/save-game': () => ({game_id: 999, status: 'finished', result: '1-0'}),
        });
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    async function loadFen(fen: string) {
        fireEvent.change(await screen.findByLabelText('Позиция в записи FEN'), {target: {value: fen}});
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Поставить/}));
        });
    }

    it('позиция из FEN ставится на свободную доску, некорректная — отклоняется', async () => {
        stubBotApi();
        renderChessboard();

        await loadFen('совсем не fen');
        expect(screen.getByRole('alert')).toHaveTextContent('Некорректная позиция');

        await loadFen(KQ_VS_K);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(squareEl('h7').querySelector('img')?.getAttribute('alt')).toBe('wq');
        expect(squareEl('e2').querySelector('img')).toBeNull();
        // Сброс возвращает обычную расстановку даже без сделанных ходов.
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сбросить доску/}));
        });
        expect(squareEl('e2').querySelector('img')?.getAttribute('alt')).toBe('wp');
    });

    it('партия с ботом начинается с позиции на доске и сохраняется вместе с ней', async () => {
        const fetchMock = stubBotApi();
        renderChessboard();
        await loadFen(KQ_VS_K);

        expect(screen.getByLabelText('Начать с позиции на доске')).toBeChecked();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Белыми/}));
        });
        expect(squareEl('h7').querySelector('img')?.getAttribute('alt')).toBe('wq');

        // Qa7# — мат; партия уходит на сервер с начальной позицией.
        clickSquare('h7');
        clickSquare('a7');

        await waitFor(() => {
            expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/bots/save-game'))).toBe(true);
        });
        const saveCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => String(url).includes('/bots/save-game'))!;
        const body = JSON.parse((saveCall as unknown as [string, RequestInit])[1].body as string);
        expect(body).toMatchObject({start_fen: KQ_VS_K, moves_uci: ['h7a7'], result: '1-0'});
        // Журнал нумерует ход по позиции: 57-й, а не первый.
        expect(screen.getByText('57.')).toBeInTheDocument();
    });

    it('без галочки партия начинается с обычной расстановки', async () => {
        const fetchMock = stubBotApi();
        renderChessboard();
        await loadFen(KQ_VS_K);
        fireEvent.click(screen.getByLabelText('Начать с позиции на доске'));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Белыми/}));
        });

        expect(squareEl('e2').querySelector('img')?.getAttribute('alt')).toBe('wp');
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/bots/save-game'))).toBe(false);
    });

    it('на обычной расстановке выбора «с позиции» нет', async () => {
        stubBotApi();
        renderChessboard();
        await screen.findByRole('button', {name: /Белыми/});
        expect(screen.queryByLabelText('Начать с позиции на доске')).not.toBeInTheDocument();
    });
});

describe('мастерская соперников', () => {
    it('партия с архетипом: ходы через /custom-move с конфигом, сохранение как bot_id custom', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const fetchMock = mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
            '/bots/personalities': () => [],
            '/bots/catalog': () => ({
                calibration: null, historical: [],
                archetypes: [{
                    id: 'rusher', config: {...DEFAULT_CONFIG, target_elo: 700},
                    declared_rating: 700, rating: 700, measured: false, games: 0, ci95: null,
                }],
            }),
            '/bots/custom-move': () => ({
                ...BOT_MOVE_DEFAULT, uci: 'e2e4', san: 'e4', comment: {key: 'personality.develop', params: {}},
            }),
            '/bots/save-game': () => ({game_id: 1000, status: 'finished', result: '1-0'}),
        });
        vi.stubGlobal('fetch', fetchMock);
        renderChessboard();

        fireEvent.click(await screen.findByRole('tab', {name: 'Мастерская'}));
        fireEvent.click(await screen.findByRole('button', {name: /Торопыга/}));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Чёрными/}));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });

        const moveCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => String(url).includes('/bots/custom-move'));
        const moveBody = JSON.parse(String(moveCall?.[1].body));
        expect(moveBody.config.target_elo).toBe(700);
        expect(moveBody.bot_id).toBeUndefined();
        await waitFor(() => expect(screen.getByText('e4')).toBeInTheDocument());
        expect(screen.getAllByText('Торопыга').length).toBeGreaterThan(0);
        // Реплика бота пришла ключом и показана из каталога.
        expect(screen.getByText('Развиваем фигуры — каждый темп на счету.')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сдаться/}));
        });
        const saveCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => String(url).includes('/bots/save-game'));
        const saveBody = JSON.parse(String(saveCall?.[1].body));
        expect(saveBody).toMatchObject({bot_id: 'custom', personality_name: 'archetype:rusher', player_color: 'black'});
    });
});

describe('клубная лестница', () => {
    it('партия лестницы: соперник от сервера, без возврата хода, итог в статусе', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const ladderState = {
            rating: 1000, games: 0, step: 0, total: 2, active_opponent: null,
            rungs: [
                {key: 'morphy', kind: 'historical', id: 'morphy', rating: 2050, measured: true, status: 'current'},
                {key: 'paulsen', kind: 'historical', id: 'paulsen', rating: 2100, measured: false, status: 'locked'},
            ],
        };
        const fetchMock = mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
            '/bots/catalog': () => ({calibration: null, historical: [], archetypes: []}),
            '/bots/ladder/start': () => ({
                opponent: {key: 'morphy', kind: 'historical', id: 'morphy', rating: 2050, bot_id: 'morphy', config: null},
                color: 'white', step: 0, forfeited: null,
            }),
            '/bots/ladder': () => ladderState,
            '/bots/move': () => BOT_MOVE_DEFAULT,
            '/bots/save-game': () => ({
                game_id: 1001, status: 'finished', result: '0-1',
                ladder: {counted: true, reason: null, delta: -6, rating: 994, step: 0, promoted: false, opponent: 'Морфи'},
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        renderChessboard();

        fireEvent.click(await screen.findByRole('tab', {name: 'Лестница'}));
        const white = await screen.findByRole('button', {name: /Белыми/});
        await act(async () => {
            fireEvent.click(white);
        });

        clickSquare('e2');
        clickSquare('e4');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        expect(screen.getByRole('button', {name: /Вернуть ход/})).toBeDisabled();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сдаться/}));
        });
        const saveCall = (fetchMock.mock.calls as unknown as [string, RequestInit][])
            .find(([url]) => String(url).includes('/bots/save-game'));
        expect(JSON.parse(String(saveCall?.[1].body))).toMatchObject({bot_id: 'morphy', ladder: true, player_color: 'white'});
        expect(await screen.findByText('Лестница: рейтинг 994 (-6).')).toBeInTheDocument();
    });
});

describe('клавиатура', () => {
    it('стрелки листают ходы, обработчик регистрируется один раз', async () => {
        const addListener = vi.spyOn(window, 'addEventListener');
        vi.stubGlobal('fetch', mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
        }));
        renderChessboard();
        await screen.findByRole('button', {name: /Белыми/});

        // Свободная доска: ход сразу после хода — стрелка должна видеть уже обновлённую историю.
        clickSquare('e2');
        clickSquare('e4');
        fireEvent.keyDown(window, {key: 'ArrowLeft'});
        await waitFor(() => expect(squareEl('e2').querySelector('img')?.getAttribute('alt')).toBe('wp'));
        expect(squareEl('e4').querySelector('img')).toBeNull();

        fireEvent.keyDown(window, {key: 'ArrowDown'});
        await waitFor(() => expect(squareEl('e4').querySelector('img')?.getAttribute('alt')).toBe('wp'));

        expect(addListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
        addListener.mockRestore();
    });
});

describe('игра с наставником', () => {
    const BLUNDER = {
        available: true, cp_loss: 320, classification: 'Blunder', symbol: '??', eval_before: 30, eval_after: -290,
        best_move_uci: 'd2d4', reply_uci: 'd8h4', missed_tactic: false,
        coach: {comment: [{key: 'coach.verdict.blunder.v1', params: {move: 'f3'}}],
            arrows: [{from: 'd8', to: 'h4', kind: 'threat'}], highlights: []},
    };

    async function startCoachedGame(check: object) {
        localStorage.setItem('michess_coach_enabled', '1');
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            calls.push(url);
            const body = (() => {
                if (url.includes('/analysis/check-move')) return check;
                if (url.includes('/bots/move')) return BOT_MOVE_DEFAULT;
                if (url.includes('/bots/save-game')) return {game_id: 1};
                if (url.includes('/profile/me')) return {id: 1, username: 'TestPlayer', blitz_rating: 1500};
                if (url.includes('/profile/games/my-active')) return {active: false};
                return [];
            })();
            return {ok: true, status: 200, json: async () => body} as Response;
        }));
        renderChessboard();
        const startButton = await screen.findByRole('button', {name: /Белыми/});
        await act(async () => {
            fireEvent.click(startButton);
        });
        return {calls};
    }

    it('зевок: бот ждёт решения, «Почему?» рисует стрелку, «Переходить» возвращает позицию', async () => {
        const {calls} = await startCoachedGame(BLUNDER);
        clickSquare('f2');
        clickSquare('f3');

        expect(await screen.findByTestId('coach-warning')).toBeInTheDocument();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(calls.some((url) => url.includes('/bots/move'))).toBe(false);

        fireEvent.click(screen.getByTestId('coach-why'));
        expect(screen.getByTestId('coach-arrow-threat')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('coach-takeback'));
        expect(screen.queryByTestId('coach-warning')).toBeNull();
        expect(screen.queryByText('f3')).toBeNull();
    });

    it('ход оставлен — бот отвечает, партия сохраняется учебной', async () => {
        const {calls} = await startCoachedGame(BLUNDER);
        clickSquare('f2');
        clickSquare('f3');
        fireEvent.click(await screen.findByTestId('coach-keep'));
        await waitFor(() => expect(calls.some((url) => url.includes('/bots/move'))).toBe(true));
        expect(screen.getByTestId('coach-assisted')).toBeInTheDocument();
    });

    it('хороший ход — без предупреждения, бот отвечает сразу', async () => {
        const {calls} = await startCoachedGame({...BLUNDER, cp_loss: 0, classification: 'Best', eval_after: 30});
        clickSquare('e2');
        clickSquare('e4');
        await waitFor(() => expect(calls.some((url) => url.includes('/bots/move'))).toBe(true));
        expect(screen.queryByTestId('coach-warning')).toBeNull();
    });
});
