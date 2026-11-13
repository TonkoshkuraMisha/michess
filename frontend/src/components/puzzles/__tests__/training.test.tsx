// Тренировка по приёмам (таск 13.4): список тем с прогрессом, карточка темы, показ на доске, тренировка, подборки.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import PuzzlesPage from '../PuzzlesPage';
import {DemoViewer} from '../TrainingPanel';
import {resetThemeRegistryCache} from '../../../services/themes';

const OVERVIEW = {window: 10, pass: 8, themes: [
    {code: 'fork', section: 'A', stage: 2, recent: '1101', solved: 14, mastered: false, available: [30, 40, 20, 10], ready: true},
    {code: 'fork_knight', section: 'A', stage: 1, recent: '', solved: 0, mastered: false, available: [12, 3, 0, 0], ready: false},
    {code: 'pin', section: 'B', stage: 4, recent: '', solved: 60, mastered: true, available: [25, 25, 20, 15], ready: true},
    {code: 'lucena', section: 'J', stage: 1, recent: '', solved: 0, mastered: false, available: [0, 0, 0, 0], ready: false},
]};
const PUZZLE = {
    id: 9, fen: 'r2q2k1/ppp3pp/8/4N3/8/8/PPP2PPP/R2QK2R b KQ - 0 1', first_move: 'g8h8', rating: 950,
    themes: ['fork', 'fork_knight'], color: 'white', solution_length: 1, stage: 1,
};

function stub(extra: (url: string) => unknown = () => null) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        let body = extra(url);
        if (body === null) {
            if (url.includes('/training')) body = OVERVIEW;
            else if (url.includes('/demo')) body = {theme: 'fork', examples: [
                {fen: PUZZLE.fen, moves: ['g8h8', 'e5f7'], color: 'white'},
                {fen: PUZZLE.fen, moves: ['g8f8', 'e5d7'], color: 'white'},
            ]};
            else if (url.includes('/train')) body = PUZZLE;
            else if (url.includes('/themes')) body = {sections: ['A'], themes: []};
            else body = {rating: 1500, games: 0, streak: 0, best: {'3': 0, '5': 0}, history: []};
        }
        return {ok: true, status: 200, json: async () => body} as Response;
    }));
    return calls;
}

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

async function openThemes() {
    render(<MemoryRouter><PuzzlesPage/></MemoryRouter>);
    await act(async () => {
        fireEvent.click(await screen.findByTestId('puzzle-mode-themes'));
    });
    return screen.findByTestId('training-panel');
}

describe('режим «Приёмы»', () => {
    it('темы по разделам с прогрессом; тема без задач приглушена', async () => {
        stub();
        await openThemes();
        expect(screen.getByTestId('training-section-A').textContent).toContain('Двойной удар');
        expect(screen.getByTestId('training-theme-fork').textContent).toContain('ступень 2 · 3/8');
        expect(screen.getByTestId('training-theme-pin').textContent).toContain('освоено');
        expect(screen.getByTestId('training-theme-lucena').className).toContain('opacity-50');
    });

    it('карточка темы: объяснение, показ на доске, тренировка с прогрессом', async () => {
        const calls = stub((url) => (url.includes('/move')
            ? {correct: true, done: true, reply: null, solution: null, result: {
                solved: true, rating_before: 1500, rating_after: 1508, delta: 8, streak: 1, themes: ['fork'], run: null,
                training: {theme: 'fork', stage: 2, recent: '11011', mastered: false, advanced: false, window: 10, pass: 8},
            }}
            : null));
        await openThemes();
        fireEvent.click(screen.getByTestId('training-theme-fork'));
        const card = screen.getByTestId('theme-card');
        expect(card.textContent).toContain('Вилка');
        expect(card.textContent).toContain('одна фигура одновременно нападает');
        expect(card.textContent).toContain('Ступень 2 — закрепление: чисто решено 3 из последних 10, для перехода нужно 8.');

        await act(async () => {
            fireEvent.click(screen.getByTestId('theme-demo'));
        });
        expect(screen.getByTestId('demo-viewer')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByTestId('theme-train'));
        });
        expect(calls.some((u) => u.endsWith('/train?theme=fork'))).toBe(true);
        expect(screen.getByTestId('training-target').textContent).toContain('Вилка');
        expect(screen.getByTestId('puzzle-info').textContent).toContain('ступень 1');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
        });
        await act(async () => {
            fireEvent.click(document.querySelector('[data-square="e5"]') as HTMLElement);
        });
        await act(async () => {
            fireEvent.click(document.querySelector('[data-square="f7"]') as HTMLElement);
        });
        expect(await screen.findByTestId('training-progress')).toHaveTextContent('Ступень 2: чисто решено 4 из последних 10 (нужно 8).');

        await act(async () => {
            fireEvent.click(screen.getByTestId('training-back'));
        });
        expect(await screen.findByTestId('training-panel')).toBeTruthy();
    });

    it('смешанная подборка «без названия темы» скрывает темы до конца решения', async () => {
        const calls = stub((url) => (url.includes('/train?') ? {...PUZZLE, themes: [], stage: null} : null));
        await openThemes();
        fireEvent.click(screen.getByTestId('training-blind'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('training-mixed-A'));
        });
        expect(calls.some((u) => u.endsWith('/train?section=A&blind=true'))).toBe(true);
        expect(screen.getByTestId('training-target').textContent).toContain('Смешанная: Двойной удар · Без названия темы');
        expect(screen.queryByTestId('puzzle-themes')).toBeNull();
    });

    it('переход на следующую ступень и освоение темы', async () => {
        stub((url) => (url.includes('/move')
            ? {correct: true, done: true, reply: null, solution: null, result: {
                solved: true, rating_before: 1500, rating_after: 1508, delta: 8, streak: 1, themes: [], run: null,
                training: {theme: 'fork', stage: 3, recent: '', mastered: false, advanced: true, window: 10, pass: 8},
            }}
            : null));
        await openThemes();
        fireEvent.click(screen.getByTestId('training-theme-fork'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('theme-train'));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
        });
        await act(async () => {
            fireEvent.click(document.querySelector('[data-square="e5"]') as HTMLElement);
        });
        await act(async () => {
            fireEvent.click(document.querySelector('[data-square="f7"]') as HTMLElement);
        });
        await waitFor(() => expect(screen.getByTestId('training-progress').textContent).toBe('Ступень пройдена! Теперь ступень 3.'));
    });
});

describe('DemoViewer', () => {
    it('ходы по шагам и переключение примеров', () => {
        render(<DemoViewer examples={[
            {fen: PUZZLE.fen, moves: ['g8h8', 'e5f7'], color: 'white'},
            {fen: PUZZLE.fen, moves: ['g8f8'], color: 'white'},
        ]}/>);
        expect(screen.getByTestId('demo-caption').textContent).toBe('Исходная позиция · ход 0 из 2');
        fireEvent.click(screen.getByTestId('demo-next'));
        expect(screen.getByTestId('demo-caption').textContent).toContain('Ход соперника');
        fireEvent.click(screen.getByTestId('demo-next'));
        expect(screen.getByTestId('demo-caption').textContent).toContain('Ход решения');
        expect(document.querySelector('[data-square="f7"] img')?.getAttribute('alt')).toBe('wn');
        expect((screen.getByTestId('demo-next') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByTestId('demo-prev'));
        expect(screen.getByTestId('demo-caption').textContent).toContain('ход 1 из 2');
        fireEvent.click(screen.getByTestId('demo-other'));
        expect(screen.getByTestId('demo-caption').textContent).toBe('Исходная позиция · ход 0 из 1');
    });
});
