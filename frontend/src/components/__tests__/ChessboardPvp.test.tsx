// --- FILE: frontend/src/components/__tests__/ChessboardPvp.test.tsx ---
// PvP и просмотр партий через события WebSocket: чужие события не должны менять доску,
// потерянный game_over восстанавливается по HTTP, вызов возвращается в лобби после обрыва связи.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest';
import Chessboard from '../Chessboard';
import {gameSocket} from '../../services/gameSocket';
import {emitSocketEvent, mockFetchRouter} from '../../test/mocks';

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
    localStorage.setItem('token', 'test-token');
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
        expect(screen.getByText('Идет рейтинговая партия')).toBeInTheDocument();
    });
});

describe('поиск соперника', () => {
    it('после переподключения WebSocket вызов возвращается в лобби', async () => {
        renderBoard();
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
        await act(async () => {
            fireEvent.click(await screen.findByRole('radio', {name: 'Товарищеская'}));
            fireEvent.click(screen.getByRole('button', {name: /С другом/}));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /Сгенерировать и скопировать ссылку/}));
        });

        expect(sendMock).toHaveBeenCalledWith('create_invite', expect.objectContaining({rated: false}));
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
        expect(screen.getByText('Идет рейтинговая партия')).toBeInTheDocument();

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
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', {name: /Лобби \/ Live/}));
        });

        const friendly = (await screen.findByText('Friendly')).closest('div')!.parentElement!;
        expect(friendly.textContent).toContain('товарищеская');
        const serious = screen.getByText('Serious').closest('div')!.parentElement!;
        expect(serious.textContent).not.toContain('товарищеская');
    });
});
