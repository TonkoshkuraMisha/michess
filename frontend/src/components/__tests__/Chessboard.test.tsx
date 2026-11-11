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
