// Упражнения-генераторы (таск 13.7): задание по виду, подсказка фигуры, ход и проверка сервером, мат в 2 с ответом
// соперника, решение при ошибке, забег на минуту с рекордом, недоступное сочетание, переход из карточки темы.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import PuzzlesPage from '../PuzzlesPage';
import {resetThemeRegistryCache} from '../../../services/themes';

// Белая ладья a1 берёт незащищённого коня a8.
const CAPTURE = {
    key: 'capture.r.1.5', kind: 'capture', piece: 'r', level: 1, color: 'white', piece_type: 'r', moves: 1,
    fen: 'n3k3/8/8/8/8/8/8/R3K3 w - - 0 1',
};
// Мат в 2: 1. Лa7 Крf8 2. Лb8#.
const MATE2 = {
    key: 'mate2.r.1.9', kind: 'mate2', piece: 'r', level: 1, color: 'white', piece_type: 'r', moves: 2,
    fen: '4k3/8/8/8/8/8/1R6/R3K3 w - - 0 1',
};
const RUN = {combo: 'capture.r.1', solved: 0, mistakes: 0, seconds_left: 60, over: false};

type Handler = (url: string, body: { key?: string; moves?: string[]; run?: boolean } | null) => unknown;

function stub(handler: Handler) {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({url, body});
        let answer = handler(url, body);
        if (answer === undefined) {
            if (url.includes('/drills/records')) answer = {records: {'capture.r.1': 4}, themes: {}};
            else if (url.includes('/training')) {
                answer = {window: 10, pass: 8, themes: [
                    {code: 'fork', section: 'A', stage: 1, recent: '', solved: 0, mastered: false, available: [30, 30, 20, 10], ready: true},
                ]};
            } else if (url.includes('/themes')) answer = {sections: [], themes: []};
            else answer = {rating: 1500, games: 0, streak: 0, best: {'3': 0, '5': 0}, history: []};
        }
        return {ok: true, status: 200, json: async () => answer} as Response;
    }));
    return calls;
}

const cell = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLElement;
const answers = (calls: { url: string; body: unknown }[]) => calls.filter((c) => c.url.includes('/drills/answer')).map((c) => c.body);

async function clickMove(from: string, to: string) {
    await act(async () => {
        fireEvent.click(cell(from));
    });
    await act(async () => {
        fireEvent.click(cell(to));
    });
}

async function openDrills() {
    render(<MemoryRouter><PuzzlesPage/></MemoryRouter>);
    await act(async () => {
        fireEvent.click(await screen.findByTestId('puzzle-mode-drills'));
    });
    return screen.findByTestId('generated-drills');
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

describe('упражнения-генераторы', () => {
    it('задание и фигура, верный ход — «Верно!»; выбранные вид, фигура и уровень уходят в запрос', async () => {
        const calls = stub((url) => {
            if (url.includes('/drills/next')) return CAPTURE;
            if (url.includes('/drills/answer')) return {correct: true, done: true, reply: null, solution: null, run: null};
            return undefined;
        });
        await openDrills();
        expect(screen.getByTestId('drill-record').textContent).toBe('Рекорд: 0');  // ферзь — рекорда нет
        fireEvent.click(screen.getByTestId('drill-piece-r'));
        fireEvent.click(screen.getByTestId('drill-level-1'));
        expect(screen.getByTestId('drill-record').textContent).toBe('Рекорд: 4');
        await act(async () => {
            fireEvent.click(screen.getByTestId('drill-next'));
        });
        expect(calls.find((c) => c.url.includes('/drills/next'))?.url).toContain('kind=capture&piece=r&level=1');
        expect(screen.getByTestId('drill-status').textContent).toContain('Возьмите незащищённую фигуру');
        expect(screen.getByTestId('drill-piece-hint').textContent).toContain('♖ Ладья');

        await clickMove('a1', 'a8');
        expect(answers(calls)).toEqual([{key: 'capture.r.1.5', moves: ['a1a8'], run: false}]);
        expect(screen.getByTestId('drill-outcome').textContent).toBe('Верно!');
        expect(screen.getByTestId('puzzle-mark-ok')).toBeTruthy();
    });

    it('неверный ход — отметка и решение', async () => {
        stub((url) => {
            if (url.includes('/drills/next')) return CAPTURE;
            if (url.includes('/drills/answer')) return {correct: false, done: true, reply: null, solution: ['a1a8'], run: null};
            return undefined;
        });
        await openDrills();
        await act(async () => {
            fireEvent.click(screen.getByTestId('drill-next'));
        });
        await clickMove('a1', 'a5');
        expect(screen.getByTestId('drill-outcome').textContent).toBe('Не тот ход.');
        expect(screen.getByTestId('drill-solution').textContent).toBe('Решение: 1. ♖xa8+');

        // Решение на доске (таск B.3): с позиции упражнения, ход за ходом.
        fireEvent.click(screen.getByTestId('replay-line-solution'));
        const cell = (sq: string) => document.querySelector(`[data-square="${sq}"]`) as HTMLElement;
        expect(cell('a1').querySelector('img')?.getAttribute('alt')).toBe('wr');
        fireEvent.click(screen.getByTestId('replay-forward'));
        expect(cell('a8').querySelector('img')?.getAttribute('alt')).toBe('wr');
        expect(screen.getByTestId('replay-step').textContent).toBe('Ход 1 из 1');
    });

    it('мат в 2: после первого хода соперник отвечает, второй ход уходит вместе с историей', async () => {
        const calls = stub((url, body) => {
            if (url.includes('/drills/next')) return MATE2;
            if (url.includes('/drills/answer')) {
                return body?.moves?.length === 1
                    ? {correct: true, done: false, reply: 'e8f8', solution: null, run: null}
                    : {correct: true, done: true, reply: null, solution: null, run: null};
            }
            return undefined;
        });
        await openDrills();
        fireEvent.click(screen.getByTestId('drill-kind-mate2'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('drill-next'));
        });
        await clickMove('a1', 'a7');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        expect(cell('f8').querySelector('img')?.getAttribute('alt')).toBe('bk');
        expect(screen.getByTestId('drill-status').textContent).toContain('Теперь — мат');
        await clickMove('b2', 'b8');
        expect(answers(calls).map((b) => (b as { moves: string[] }).moves)).toEqual([['a1a7'], ['a1a7', 'e8f8', 'b2b8']]);
        expect(screen.getByTestId('drill-outcome').textContent).toBe('Верно!');
    });

    it('на минуту: счёт с сервера, выбор заблокирован, конец забега — рекорд', async () => {
        const calls = stub((url) => {
            if (url.includes('/run/start')) return RUN;
            if (url.includes('/run/next')) return {...CAPTURE, run: RUN};
            if (url.includes('/drills/answer')) {
                return {correct: true, done: true, reply: null, solution: null, run: {...RUN, solved: 5, over: true}};
            }
            if (url.includes('/run/finish')) return {combo: 'capture.r.1', score: 5, mistakes: 0, best: 5, new_record: true};
            return undefined;
        });
        await openDrills();
        fireEvent.click(screen.getByTestId('drill-piece-r'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('drill-timed'));
        });
        expect(screen.getByTestId('drill-run').textContent).toContain('1:00');
        expect((screen.getByTestId('drill-kind-fork') as HTMLButtonElement).disabled).toBe(true);
        await clickMove('a1', 'a8');
        expect(answers(calls)[0]).toEqual({key: 'capture.r.1.5', moves: ['a1a8'], run: true});
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(screen.getByTestId('drill-run-result').textContent).toContain('решено 5, рекорд 5');
        expect(screen.getByTestId('drill-run-result').textContent).toContain('Новый личный рекорд');
    });

    it('конь не связывает: кнопки недоступны', async () => {
        stub(() => undefined);
        await openDrills();
        fireEvent.click(screen.getByTestId('drill-kind-pin'));
        fireEvent.click(screen.getByTestId('drill-piece-n'));
        expect(screen.getByTestId('drill-unsupported')).toBeTruthy();
        expect((screen.getByTestId('drill-next') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('drill-timed') as HTMLButtonElement).disabled).toBe(true);
    });

    it('из карточки темы «Вилка» — упражнение-генератор с выбранной вилкой', async () => {
        stub(() => undefined);
        render(<MemoryRouter><PuzzlesPage/></MemoryRouter>);
        await act(async () => {
            fireEvent.click(await screen.findByTestId('puzzle-mode-themes'));
        });
        fireEvent.click(await screen.findByTestId('training-theme-fork'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('theme-drill'));
        });
        expect(await screen.findByTestId('generated-drills')).toBeTruthy();
        expect(screen.getByTestId('drill-kind-fork').getAttribute('aria-selected')).toBe('true');
    });
});
