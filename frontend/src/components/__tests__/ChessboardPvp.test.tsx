// --- FILE: frontend/src/components/__tests__/ChessboardPvp.test.tsx ---
// PvP и просмотр партий через события WebSocket: чужие события не должны менять доску,
// потерянный game_over восстанавливается по HTTP, вызов возвращается в лобби после обрыва связи.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest';
import Chessboard from '../Chessboard';
import {gameSocket} from '../../services/gameSocket';
import {emitSocketEvent, mockFetchRouter} from '../../test/mocks';
import {setLanguage} from '../../i18n';
import {setToken} from '../../services/authToken';
import {openHuman} from '../../test/newGame';

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

const onMock = gameSocket.on as unknown as Mock;
const sendMock = gameSocket.send as unknown as Mock;

const MATCH = {
    event: 'match_found',
    game_id: 5,
    color: 'white',
    opponent_id: 2,
    white_username: 'TestPlayer',
    white_rating: 1500,
    black_username: 'Rival',
    black_rating: 1510,
    base_time_ms: 180000,
    increment_ms: 0,
    white_time_ms: 180000,
    black_time_ms: 180000,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '',
    state_version: 0,
};

/** Последний зарегистрированный обработчик события (эффект мог переподписаться). */
function emit(event: string, data: any) {
    const calls = onMock.mock.calls.filter(([name]: [string]) => name === event);
    if (calls.length === 0) {
        emitSocketEvent(onMock, event, data);
        return;
    }
    calls[calls.length - 1][1](data);
}

async function emitAct(event: string, data: any) {
    await act(async () => {
        emit(event, data);
    });
}

function renderBoard(fetchHandlers: Record<string, () => unknown> = {}) {
    vi.stubGlobal('fetch', mockFetchRouter({
        '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
        '/profile/matchmaking/queue': () => [],
        '/profile/games/live': () => [],
        '/profile/games/my-active': () => ({active: false}),
        ...fetchHandlers,
    }));
    return render(
        <MemoryRouter initialEntries={['/']}>
            <Chessboard/>
        </MemoryRouter>,
    );
}


beforeEach(() => {
    setToken('test-token');
    onMock.mockClear();
    sendMock.mockClear();
    vi.useFakeTimers({shouldAdvanceTime: true});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('события чужой партии', () => {
    it('ход и итог другой партии не меняют доску и не завершают текущую', async () => {
        renderBoard({'/profile/games/my-active': () => ({...MATCH, active: true})});
        await emitAct('match_found', MATCH);

        await emitAct('move_made', {game_id: 7, state_version: 1, pgn: '1. d4', san: 'd4', game_over: false});
        expect(screen.queryByText('d4')).not.toBeInTheDocument();

        await emitAct('game_over', {game_id: 7, result: '0-1', reason: 'resignation'});
        expect(screen.queryByText(/Партия окончена/)).not.toBeInTheDocument();

        await emitAct('move_made', {game_id: 5, state_version: 1, pgn: '1. e4', san: 'e4', game_over: false});
        expect(screen.getByText('e4')).toBeInTheDocument();
    });

    it('итог своей партии показывается вместе с причиной', async () => {
        renderBoard({'/profile/games/my-active': () => ({...MATCH, active: true})});
        await emitAct('match_found', MATCH);
        await emitAct('game_over', {game_id: 5, result: '1-0', reason: 'resignation', white_delta: 8, black_delta: -8});

        expect(screen.getByText('Партия окончена. Результат: 1-0 (сдача)')).toBeInTheDocument();
    });
});

describe('предложение ничьей', () => {
    it('восстанавливается из снимка партии и снимается ответным ходом', async () => {
        const snapshot = {...MATCH, pgn: '1. e4 e5', state_version: 2, draw_offer_from: 2};
        renderBoard({'/profile/games/my-active': () => ({...snapshot, active: true})});
        await emitAct('match_found', snapshot);

        expect(screen.getByText('Соперник предлагает ничью.')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Принять'})).toBeInTheDocument();

        // Игрок (белые) отвечает ходом — предложение отклонено, кнопки исчезают.
        await emitAct('move_made', {game_id: 5, state_version: 3, pgn: '1. e4 e5 2. Nf3', san: 'Nf3', game_over: false});
        expect(screen.queryByText('Соперник предлагает ничью.')).not.toBeInTheDocument();
    });
});

describe('берсерк в партии арены (33.3)', () => {
    const ARENA_MATCH = {...MATCH, increment_ms: 2000, arena_id: 3, berserk_allowed: true, white_berserk: false,
        black_berserk: false};
    const BERSERK = {game_id: 5, color: 'white', white_time_ms: 90000, black_time_ms: 180000, berserk_allowed: true,
        white_berserk: true, black_berserk: false};

    it('кнопка до первого хода шлёт действие; событие ставит отметку игроку и убирает кнопку', async () => {
        renderBoard({'/profile/games/my-active': () => ({...ARENA_MATCH, active: true})});
        await emitAct('match_found', ARENA_MATCH);
        expect(screen.queryByTestId('berserk-mark')).toBeNull();

        fireEvent.click(screen.getByTestId('berserk-button'));
        expect(sendMock).toHaveBeenCalledWith('berserk', {game_id: 5});

        await emitAct('berserk', BERSERK);
        expect(screen.queryByTestId('berserk-button')).toBeNull();
        expect(screen.getAllByTestId('berserk-mark')).toHaveLength(1);
        expect(screen.getByRole('img', {name: 'Берсерк: половина времени, без добавки'})).toBeInTheDocument();
    });

    it('берсерк соперника виден, а своя кнопка остаётся; после своего первого хода её нет', async () => {
        renderBoard({'/profile/games/my-active': () => ({...ARENA_MATCH, active: true})});
        await emitAct('match_found', ARENA_MATCH);
        await emitAct('berserk', {...BERSERK, color: 'black', white_time_ms: 180000, black_time_ms: 90000,
            white_berserk: false, black_berserk: true});
        expect(screen.getAllByTestId('berserk-mark')).toHaveLength(1);
        expect(screen.getByTestId('berserk-button')).toBeInTheDocument();

        await emitAct('move_made', {game_id: 5, state_version: 1, pgn: '1. e4', san: 'e4', game_over: false});
        expect(screen.queryByTestId('berserk-button')).toBeNull();
        expect(screen.getAllByTestId('berserk-mark')).toHaveLength(1);
    });

    it('чёрные могут сыграть берсерк после первого хода белых; в обычной партии кнопки нет', async () => {
        const asBlack = {...ARENA_MATCH, color: 'black', opponent_id: 1, white_username: 'Rival',
            black_username: 'TestPlayer', pgn: '1. e4', state_version: 1};
        const view = renderBoard({'/profile/games/my-active': () => ({...asBlack, active: true})});
        await emitAct('match_found', asBlack);
        expect(screen.getByTestId('berserk-button')).toBeInTheDocument();
        view.unmount();

        renderBoard({'/profile/games/my-active': () => ({...MATCH, active: true})});
        await emitAct('match_found', MATCH);
        expect(screen.queryByTestId('berserk-button')).toBeNull();
    });

    it('чужое событие берсерка и снимок той же партии без полей берсерка ничего не меняют', async () => {
        renderBoard({'/profile/games/my-active': () => ({...MATCH, active: true})});
        await emitAct('match_found', ARENA_MATCH);
        await emitAct('berserk', {...BERSERK, game_id: 7});
        expect(screen.queryByTestId('berserk-mark')).toBeNull();

        await emitAct('berserk', BERSERK);
        // Опрос my-active отдаёт снимок без полей берсерка — отметка остаётся.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3500);
        });
        expect(screen.getAllByTestId('berserk-mark')).toHaveLength(1);
    });
});

describe('потерянный game_over', () => {
    it('партия, которой на сервере уже нет, завершается по итогу из HTTP', async () => {
        renderBoard({
            '/profile/games/5/summary': () => ({
                game_id: 5, status: 'COMPLETED', result: '0-1', termination: 'timeout',
                white_delta: -8, black_delta: 8,
            }),
        });
        await emitAct('match_found', MATCH);

        // Опрос my-active раз в 1.5 с отвечает «активной партии нет» два раза подряд.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        await waitFor(() => {
            expect(screen.getByText('Партия окончена. Результат: 0-1 (истекло время)')).toBeInTheDocument();
        });
    });

    it('пока итог не записан на сервере, партия на экране продолжается', async () => {
        renderBoard({
            '/profile/games/5/summary': () => ({game_id: 5, status: 'IN_PROGRESS', result: null, termination: null}),
        });
        await emitAct('match_found', MATCH);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        expect(screen.queryByText(/Партия окончена/)).not.toBeInTheDocument();
        expect(screen.getByText('Идёт рейтинговая партия')).toBeInTheDocument();
    });
});

describe('поиск соперника', () => {
    it('после переподключения WebSocket вызов возвращается в лобби', async () => {
        renderBoard();
        await openHuman();
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', {name: /Найти соперника/}));
        });
        const joinsBefore = sendMock.mock.calls.filter(([action]) => action === 'join_queue').length;
        expect(joinsBefore).toBe(1);

        await emitAct('connected', {event: 'connected'});

        const joins = sendMock.mock.calls.filter(([action]) => action === 'join_queue');
        expect(joins).toHaveLength(2);
        expect(joins[1][1]).toEqual(joins[0][1]);
    });

    it('connected без активного поиска ничего не отправляет', async () => {
        renderBoard();
        await emitAct('connected', {event: 'connected'});
        expect(sendMock.mock.calls.filter(([action]) => action === 'join_queue')).toHaveLength(0);
    });

    it('«вы уже играете» при уже начавшейся партии не показывается как ошибка', async () => {
        renderBoard({'/profile/games/my-active': () => ({...MATCH, active: true})});
        await emitAct('match_found', MATCH);
        await emitAct('error', {event: 'error', code: 'self_in_game', message: 'Вы уже играете партию'});

        expect(screen.queryByText('Вы уже играете партию')).not.toBeInTheDocument();
    });

    it('отказ сервера с кодом показывается из каталога на языке игрока и переводится при смене языка', async () => {
        renderBoard();
        await emitAct('error', {
            event: 'error', code: 'rating_out_of_range',
            params: {rating: 1500, min: 1600, max: 1800}, message: 'Your rating 1500 is outside the challenge range (1600–1800)',
        });
        expect(screen.getByText('Ваш рейтинг 1500 вне диапазона вызова (1600–1800)')).toBeInTheDocument();

        act(() => setLanguage('uk', {persist: false}));
        expect(screen.getByText('Ваш рейтинг 1500 поза діапазоном виклику (1600–1800)')).toBeInTheDocument();
    });
});

describe('зритель', () => {
    const SPECTATE = {
        event: 'spectate_started', game_id: 9,
        white_username: 'Alpha', white_rating: 1600, black_username: 'Beta', black_rating: 1610,
        base_time_ms: 180000, increment_ms: 0, white_time_ms: 170000, black_time_ms: 175000,
        fen: '', pgn: '1. e4 e5', state_version: 2,
    };

    it('не может писать в чат, двигать фигуры и не видит кнопок песочницы', async () => {
        renderBoard();
        await emitAct('spectate_started', SPECTATE);

        expect(screen.getByText('Зрители могут только читать чат.')).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Написать сообщение...')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /Сбросить доску/})).not.toBeInTheDocument();

        const whitePawn = document.querySelector('[data-square="d2"] > div.relative') as HTMLElement;
        fireEvent.pointerDown(whitePawn, {button: 0, pointerType: 'mouse', clientX: 10, clientY: 10});
        fireEvent.pointerUp(window, {clientX: 10, clientY: 10});
        expect(screen.queryByText(/Предход:/)).not.toBeInTheDocument();
    });

    it('начало своей партии завершает просмотр на сервере', async () => {
        renderBoard();
        await emitAct('spectate_started', SPECTATE);
        await emitAct('match_found', MATCH);

        expect(sendMock).toHaveBeenCalledWith('leave_spectate', {game_id: 9});
        // Ходы просмотренной партии больше не попадают на доску.
        await emitAct('move_made', {game_id: 9, state_version: 3, pgn: '1. e4 e5 2. Nf3', san: 'Nf3', game_over: false});
        expect(screen.queryByText('Nf3')).not.toBeInTheDocument();
    });
});

describe('итог партии с человеком', () => {
    it('после конца партии — разбор этой партии и ключевые ходы; во время партии разбор не запрашивается', async () => {
        renderBoard({
            '/profile/games/my-active': () => ({...MATCH, active: true}),
            '/analysis/game/5': () => ({
                white: {accuracy: 91}, black: {accuracy: 64},
                moves: [{ply: 1, move_number: 1, color: 'white', san: 'e4'}, {ply: 2, move_number: 1, color: 'black', san: 'f6'}],
                summary: {kind: 'decisive_blunder', turning_point_ply: 2, lead_changes: 0, equal_share: 0.5,
                          white: {best_ply: 1, worst_ply: null}, black: {best_ply: null, worst_ply: 2}},
            }),
            '/learn/after-game/5': () => ({cards: []}),
        });
        await emitAct('match_found', MATCH);
        const analysisCalls = () => (vi.mocked(fetch).mock.calls as unknown as [string][]).filter(([url]) => String(url).includes('/analysis/game/'));
        expect(analysisCalls()).toHaveLength(0);  // честная игра: во время партии — ни одного запроса разбора

        await emitAct('game_over', {game_id: 5, result: '1-0', reason: 'resignation'});
        const summary = await screen.findByTestId('game-summary');
        await waitFor(() => expect(summary.textContent).toContain('Решила одна ошибка'));
        expect(String(analysisCalls()[0][0])).toContain('/analysis/game/5');
        expect(screen.queryByTestId('summary-recommendation')).toBeNull();  // соперника-бота не рекомендуем
    });
});

describe('реванш', () => {
    it('уход с завершённой партии снимает своё предложение реванша', async () => {
        renderBoard({'/profile/games/my-active': () => ({...MATCH, active: true})});
        await emitAct('match_found', MATCH);
        await emitAct('game_over', {game_id: 5, result: '1-0', reason: 'resignation'});

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /^Реванш$/}));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /В лобби/}));
        });

        expect(sendMock).toHaveBeenCalledWith('decline_rematch', {game_id: 5});
    });
});

describe('товарищеские партии', () => {
    it('выбранный тип уходит на сервер по WebSocket и HTTP и возвращается после переподключения', async () => {
        renderBoard();
        await openHuman();
        await act(async () => {
            fireEvent.click(await screen.findByRole('radio', {name: 'Товарищеская'}));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Найти соперника/}));
        });

        const joins = () => sendMock.mock.calls.filter(([action]) => action === 'join_queue');
        expect(joins()[0][1]).toMatchObject({rated: false});
        const fetchMock = fetch as unknown as Mock;
        const httpJoin = fetchMock.mock.calls.find(([url]) => String(url).includes('/matchmaking/join'));
        expect(JSON.parse(httpJoin![1].body)).toMatchObject({rated: false});
        expect(screen.getByText(/товарищеский вызов/)).toBeInTheDocument();
        // Пока идёт поиск, тип поменять нельзя — вызов уже опубликован.
        expect(screen.getByRole('radio', {name: 'Рейтинговая'})).toBeDisabled();

        await emitAct('connected', {event: 'connected'});
        expect(joins()[1][1]).toMatchObject({rated: false});
    });

    it('приглашение по ссылке создаётся выбранного типа', async () => {
        renderBoard();
        await openHuman();
        await act(async () => {
            fireEvent.click(await screen.findByRole('radio', {name: 'Товарищеская'}));
            fireEvent.click(screen.getByRole('button', {name: /С другом/}));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сгенерировать и скопировать ссылку/}));
        });

        expect(sendMock).toHaveBeenCalledWith('create_invite', expect.objectContaining({rated: false}));
    });

    it('приглашение с форой (21.1): вид форы и кто даёт уходят серверу', async () => {
        renderBoard();
        await openHuman();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /С другом/}));
        });
        fireEvent.change(screen.getByTestId('invite-odds-kind'), {target: {value: 'knight'}});
        expect(screen.getByTestId('invite-odds')).toHaveTextContent('не меняет рейтинг');
        fireEvent.change(screen.getByTestId('invite-odds-giver'), {target: {value: 'opponent'}});
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сгенерировать и скопировать ссылку/}));
        });
        expect(sendMock).toHaveBeenCalledWith('create_invite', expect.objectContaining({odds_kind: 'knight', odds_giver: 'acceptor'}));
    });

    it('«песочные часы» (21.1): без выбора «кто даёт», вид уходит серверу; часы ждущего растут', async () => {
        renderBoard();
        await openHuman();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /С другом/}));
        });
        fireEvent.change(screen.getByTestId('invite-odds-kind'), {target: {value: 'hourglass'}});
        expect(screen.queryByTestId('invite-odds-giver')).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сгенерировать и скопировать ссылку/}));
        });
        expect(sendMock).toHaveBeenCalledWith('create_invite', expect.objectContaining({odds_kind: 'hourglass'}));

        await emitAct('match_found', {...MATCH, hourglass: true});
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        // Белые думают 5 секунд: у них 02:55, у чёрных — 03:05.
        expect(screen.getAllByText('02:55').length).toBeGreaterThan(0);
        expect(screen.getAllByText('03:05').length).toBeGreaterThan(0);
    });

    it('партия Фишера (21.3): вариант уходит серверу, фора скрыта; match_found 960 уводит на свою страницу', async () => {
        vi.stubGlobal('fetch', mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [], '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
        }));
        render(
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<Chessboard/>}/>
                    <Route path="/play/960/live" element={<div data-testid="live-960-route"/>}/>
                </Routes>
            </MemoryRouter>,
        );
        await openHuman();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /С другом/}));
        });
        fireEvent.change(screen.getByTestId('invite-variant-select'), {target: {value: 'chess960'}});
        expect(screen.queryByTestId('invite-odds')).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сгенерировать и скопировать ссылку/}));
        });
        expect(sendMock).toHaveBeenCalledWith('create_invite', expect.objectContaining({variant: 'chess960'}));
        expect(sendMock).not.toHaveBeenCalledWith('create_invite', expect.objectContaining({odds_kind: expect.anything()}));
        await emitAct('match_found', {...MATCH, variant: 'chess960', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1'});
        expect(screen.getByTestId('live-960-route')).toBeInTheDocument();
    });

    it('тип идущей партии берётся из снимка сервера, изменение рейтинга не показывается', async () => {
        const casual = {...MATCH, is_rated: false};
        renderBoard({'/profile/games/my-active': () => ({...casual, active: true})});
        await emitAct('match_found', casual);

        expect(screen.getByText('Идёт товарищеская партия')).toBeInTheDocument();

        await emitAct('game_over', {game_id: 5, result: '1-0', reason: 'resignation', white_delta: 0, black_delta: 0});
        expect(screen.queryByText('(+0)')).not.toBeInTheDocument();
    });

    it('рейтинговая партия показывает изменение рейтинга', async () => {
        renderBoard({'/profile/games/my-active': () => ({...MATCH, active: true})});
        await emitAct('match_found', MATCH);
        expect(screen.getByText('Идёт рейтинговая партия')).toBeInTheDocument();

        await emitAct('game_over', {game_id: 5, result: '1-0', reason: 'resignation', white_delta: 8, black_delta: -8});
        expect(screen.getByText('(+8)')).toBeInTheDocument();
    });

    it('товарищеский вызов помечен в лобби', async () => {
        renderBoard({
            '/profile/matchmaking/queue': () => [
                {user_id: 7, username: 'Friendly', rating: 1500, base_time_ms: 180000, increment_ms: 0, rated: false},
                {user_id: 8, username: 'Serious', rating: 1500, base_time_ms: 180000, increment_ms: 0, rated: true},
            ],
        });
        // Лобби всегда в левой колонке игрового зала (вкладки «Боты / Лобби» больше нет: боты — в окне «Новая партия»).
        const friendly = (await screen.findByText('Friendly')).closest('div')!.parentElement!;
        expect(friendly.textContent).toContain('товарищеская');
        const serious = screen.getByText('Serious').closest('div')!.parentElement!;
        expect(serious.textContent).not.toContain('товарищеская');
    });
});

describe('режим зрителя со страницы «Просмотр» (16.3)', () => {
    it('доска сама просит сервер показать партию из location.state', async () => {
        vi.stubGlobal('fetch', mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
        }));
        render(
            <MemoryRouter initialEntries={[{pathname: '/', state: {spectate: 42}}]}>
                <Chessboard/>
            </MemoryRouter>,
        );
        await act(async () => undefined);
        expect(sendMock).toHaveBeenCalledWith('spectate_game', {game_id: 42});
    });
});

describe('прямой вызов из профиля (17.1)', () => {
    it('доска создаёт приглашение и отправляет его сопернику уведомлением', async () => {
        const fetchMock = mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
            '/social/challenge/magnus': () => ({sent: true, online: true}),
        });
        vi.stubGlobal('fetch', fetchMock);
        render(
            <MemoryRouter initialEntries={[{pathname: '/', state: {challenge: 'magnus'}}]}>
                <Chessboard/>
            </MemoryRouter>,
        );
        await act(async () => undefined);
        expect(sendMock).toHaveBeenCalledWith('create_invite', expect.objectContaining({color_pref: expect.any(String)}));
        await emitAct('invite_created', {code: 'abc12345'});
        expect(await screen.findByTestId('challenge-sent')).toHaveTextContent('magnus');
        const call = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
            .find(([url]) => String(url).includes('/social/challenge/magnus'))!;
        expect(JSON.parse(String(call[1].body))).toEqual({code: 'abc12345'});
    });
});
