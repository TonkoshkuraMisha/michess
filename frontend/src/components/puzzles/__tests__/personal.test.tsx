// «Мои ошибки» (таск 13.5): позиция из партии игрока, ответ одним ходом, повторение через интервалы.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import PuzzlesPage from '../PuzzlesPage';
import {resetThemeRegistryCache} from '../../../services/themes';

// После 3. Фh5 чёрные сыграли 3...Кf6?? — сильный ход 3...g6.
const VIEW = {
    id: 3, game_id: 41, ply: 6, fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
    previous_move: 'd1h5', color: 'black', themes: [], attempts: 0, solved_streak: 0,
};
const SUMMARY = {due: 2, active: 3, mastered: 1, next_due_at: null};
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

function stub(answer: unknown, nextAvailable = true) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/personal/next') && !nextAvailable) {
            return {ok: false, status: 404, json: async () => ({detail: {code: 'no_puzzles_available', params: {}}})} as Response;
        }
        const body = url.endsWith('/personal') ? SUMMARY
            : url.endsWith('/personal/next') ? VIEW
                : url.includes('/answer') ? answer
                    : url.includes('/themes') ? {sections: [], themes: []}
                        : {rating: 1500, games: 0, streak: 0, best: {'3': 0, '5': 0}, history: []};
        return {ok: true, status: 200, json: async () => body} as Response;
    }));
    return calls;
}

function Probe() {
    return <div data-testid="location">{useLocation().pathname}</div>;
}

async function open() {
    render(
        <MemoryRouter initialEntries={['/puzzles']}>
            <Routes>
                <Route path="/puzzles" element={<PuzzlesPage/>}/>
                <Route path="/game/:id" element={<Probe/>}/>
            </Routes>
        </MemoryRouter>,
    );
    await act(async () => {
        fireEvent.click(await screen.findByTestId('puzzle-mode-personal'));
    });
}

const square = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLElement;

beforeEach(() => {
    localStorage.setItem('token', 'jwt');
    vi.useFakeTimers({shouldAdvanceTime: true});
    resetThemeRegistryCache();
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('Мои ошибки', () => {
    it('позиция из партии: верный ход, повтор через 3 дня, что было сыграно', async () => {
        stub({correct: true, solution: 'g7g6', played: 'g8f6', done: false, solved_streak: 1,
              next_due_at: new Date(Date.now() + 3 * 86_400_000).toISOString()});
        await open();
        expect(screen.getByTestId('personal-summary').textContent).toBe('К повторению сейчас: 2 · в работе: 3 · освоено: 1');
        expect(screen.getByTestId('puzzle-status').textContent).toContain('Это было в вашей партии');
        // Ход соперника из партии подсвечен, доска — за чёрных.
        const order = Array.from(document.querySelectorAll('[data-square]')).map((el) => el.getAttribute('data-square'));
        expect(order[0]).toBe('h1');
        await act(async () => {
            fireEvent.click(square('g7'));
        });
        await act(async () => {
            fireEvent.click(square('g6'));
        });
        expect(await screen.findByTestId('personal-result')).toHaveTextContent('Верно! Вернёмся к ней через 3 дн.');
        expect(screen.getByTestId('personal-played').textContent).toBe('В партии вы сыграли 3… ♞f6; сильный ход — 3… g6.');
        await act(async () => {
            fireEvent.click(screen.getByTestId('personal-open-game'));
        });
        expect(screen.getByTestId('location').textContent).toBe('/game/41');
    });

    it('неверный ход: правильный показывается на доске, повтор завтра', async () => {
        stub({correct: false, solution: 'g7g6', played: 'g8f6', done: false, solved_streak: 0, next_due_at: tomorrow()});
        await open();
        await act(async () => {
            fireEvent.click(square('d8'));
        });
        await act(async () => {
            fireEvent.click(square('e7'));
        });
        expect(await screen.findByTestId('personal-result')).toHaveTextContent('Не этот ход. Вернёмся к ней через 1 дн.');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });
        expect(square('g6').querySelector('img')?.getAttribute('alt')).toBe('bp');
        expect(square('d8').querySelector('img')?.getAttribute('alt')).toBe('bq');
    });

    it('освоено после двух решений подряд; пусто — когда следующая', async () => {
        stub({correct: true, solution: 'g7g6', played: 'g8f6', done: true, solved_streak: 2, next_due_at: null});
        await open();
        await act(async () => {
            fireEvent.click(square('g7'));
        });
        await act(async () => {
            fireEvent.click(square('g6'));
        });
        expect(await screen.findByTestId('personal-result')).toHaveTextContent('Решено дважды подряд — освоено.');
    });

    it('к повторению ничего нет', async () => {
        stub(null, false);
        await open();
        expect(await screen.findByTestId('personal-empty')).toHaveTextContent('Все задачи на сегодня решены');
    });
});
