// Защитные упражнения (таск 13.6): «Что грозит?» (показать угрозу, затем защититься), «Не зевни» (выбор из трёх),
// переход из тренировки по приёмам и «Единственная защита».

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import PuzzlesPage from '../PuzzlesPage';
import {resetThemeRegistryCache} from '../../../services/themes';

// Белые; чёрный ферзь h4 грозит взять f2. Защита — конь f3 бьёт ферзя.
const THREAT = {
    id: 4, kind: 'threat', theme: 'find_the_threat', color: 'white', rating: 1300, stage: 2, choices: [],
    fen: 'r1b1k2r/pppp1ppp/2n5/2b1p3/2B1P2q/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 1',
};
const BLUNDER = {
    id: 5, kind: 'blunder', theme: 'blunder_check', color: 'white', rating: 900, stage: 1,
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1',
    choices: ['f1c4', 'f3e5', 'd2d4'],
};
const PROGRESS = {theme: 'find_the_threat', stage: 2, recent: '1', mastered: false, advanced: false, window: 10, pass: 8};
const OVERVIEW = {window: 10, pass: 8, themes: [
    {code: 'find_the_threat', section: 'I', stage: 1, recent: '', solved: 0, mastered: false, available: [100, 100, 100, 100], ready: true},
    {code: 'defensive_move', section: 'I', stage: 1, recent: '', solved: 0, mastered: false, available: [114, 245, 403, 966], ready: true},
]};

function stub(answers: Record<string, unknown>) {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({url, body: init?.body ? JSON.parse(String(init.body)) : null});
        const key = Object.keys(answers).find((k) => url.includes(k));
        let body: unknown = key ? answers[key] : null;
        if (body === null) {
            if (url.includes('/training')) body = OVERVIEW;
            else if (url.includes('/themes')) body = {sections: ['I'], themes: []};
            else body = {rating: 1500, games: 0, streak: 0, best: {'3': 0, '5': 0}, history: []};
        }
        return {ok: true, status: 200, json: async () => body} as Response;
    }));
    return calls;
}

function square(name: string) {
    return document.querySelector(`[data-square="${name}"]`) as HTMLElement;
}

async function openDefense() {
    render(<MemoryRouter><PuzzlesPage/></MemoryRouter>);
    await act(async () => {
        fireEvent.click(await screen.findByTestId('puzzle-mode-defense'));
    });
    return screen.findByTestId('defense-trainer');
}

beforeEach(() => {
    localStorage.setItem('token', 'jwt');
    resetThemeRegistryCache();
});
afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('«Что грозит?»', () => {
    it('сначала угроза — щелчком по полю, затем защита ходом; прогресс темы', async () => {
        const calls = stub({
            '/defense/next': THREAT,
            '/threat': {correct: true, threat: 'h4f2', motifs: ['fork']},
            '/answer': {correct: true, clean: true, good: ['f3h4'], threat: 'h4f2', refutations: {}, motifs: ['fork'], training: PROGRESS},
        });
        await openDefense();
        await act(async () => {
            fireEvent.click(screen.getByTestId('defense-next'));
        });
        expect(screen.getByTestId('defense-status').textContent).toContain('Что он сыграет?');

        await act(async () => {
            fireEvent.click(square('f2'));
        });
        expect(calls.find((c) => c.url.includes('/threat'))?.body).toEqual({square: 'f2'});
        expect(screen.getByTestId('defense-threat-result').textContent).toContain('угроза найдена: ♛xf2+');
        expect(screen.getByTestId('puzzle-hint-h4')).toBeTruthy();
        expect(screen.getByTestId('defense-motifs').textContent).toContain('Вилка');
        expect(screen.getByTestId('defense-status').textContent).toContain('Теперь защититесь');

        await act(async () => {
            fireEvent.click(square('f3'));
        });
        await act(async () => {
            fireEvent.click(square('h4'));
        });
        expect(calls.find((c) => c.url.includes('/answer'))?.body).toEqual({move: 'f3h4'});
        expect(screen.getByTestId('defense-outcome').textContent).toBe('Верно!');
        expect(screen.getByTestId('defense-progress').textContent).toContain('Ступень 2');
    });

    it('пропущенная угроза показывается, неверная защита — с ходами, которые держат', async () => {
        stub({
            '/defense/next': THREAT,
            '/threat': {correct: false, threat: 'h4f2', motifs: []},
            '/answer': {correct: false, clean: false, good: ['f3h4'], threat: 'h4f2', refutations: {}, motifs: [], training: {...PROGRESS, recent: '0'}},
        });
        await openDefense();
        await act(async () => {
            fireEvent.click(screen.getByTestId('defense-next'));
        });
        await act(async () => {
            fireEvent.click(square('a7'));
        });
        expect(screen.getByTestId('defense-threat-result').textContent).toContain('Соперник грозит ♛xf2+');
        await act(async () => {
            fireEvent.click(square('a2'));
        });
        await act(async () => {
            fireEvent.click(square('a3'));
        });
        expect(screen.getByTestId('defense-outcome').textContent).toBe('Этот ход проигрывает.');
        expect(screen.getByTestId('defense-good').textContent).toContain('♘xh4');
    });
});

describe('«Не зевни»', () => {
    it('три хода на выбор; проигрывающий — с опровержением, безопасный подсвечен', async () => {
        const calls = stub({
            '/defense/next': BLUNDER,
            '/answer': {correct: false, clean: false, good: ['f1c4'], threat: null, motifs: ['hanging_piece'],
                refutations: {f3e5: 'c6e5', d2d4: 'e5d4'}, training: {...PROGRESS, theme: 'blunder_check', stage: 1, recent: '0'}},
        });
        await openDefense();
        await act(async () => {
            fireEvent.click(screen.getByTestId('defense-kind-blunder'));
        });
        expect(screen.getByTestId('defense-status').textContent).toContain('Какой из трёх ходов не проигрывает?');
        expect(screen.getByTestId('defense-choices').textContent).toBe('♗c4♘xe5d4');

        await act(async () => {
            fireEvent.click(screen.getByTestId('defense-choice-f3e5'));
        });
        expect(calls.find((c) => c.url.includes('/answer'))?.body).toEqual({move: 'f3e5'});
        expect(screen.getByTestId('defense-outcome').textContent).toBe('Этот ход проигрывает.');
        expect(screen.getByTestId('defense-choice-f1c4').className).toContain('emerald');
        expect(screen.getByTestId('defense-choice-f3e5').className).toContain('rose');
        expect(screen.getByTestId('defense-refutation-f3e5').textContent).toBe('На ♘xe5 соперник отвечает ♞xe5.');
    });
});

describe('переходы', () => {
    it('тема «Найди угрозу» в приёмах ведёт в защитные упражнения, без показа на доске', async () => {
        const calls = stub({'/defense/next': THREAT});
        render(<MemoryRouter><PuzzlesPage/></MemoryRouter>);
        await act(async () => {
            fireEvent.click(await screen.findByTestId('puzzle-mode-themes'));
        });
        fireEvent.click(await screen.findByTestId('training-theme-find_the_threat'));
        expect(screen.queryByTestId('theme-demo')).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByTestId('theme-train'));
        });
        expect(await screen.findByTestId('defense-trainer')).toBeTruthy();
        expect(calls.some((c) => c.url.includes('/train?'))).toBe(false);
    });

    it('«Единственная защита» — тренировка темы defensive_move', async () => {
        const calls = stub({'/train': {
            id: 7, fen: THREAT.fen, first_move: 'a7a6', rating: 1200, themes: ['defensive_move'], color: 'black',
            solution_length: 1, stage: 1,
        }});
        await openDefense();
        await act(async () => {
            fireEvent.click(screen.getByTestId('defense-kind-defensive'));
        });
        await waitFor(() => expect(calls.some((c) => c.url.includes('/train?theme=defensive_move'))).toBe(true));
        expect(screen.getByTestId('training-target').textContent).toContain('Единственная защита');
    });
});
