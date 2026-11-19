// Диагностический экзамен (таск 22.0): обзор тестов, прохождение без подсказок, итог. Решение доигрывается до конца:
// верный ход — ответ соперника и очко, ошибка или «не знаю» — следующая позиция.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {EXAM_NEXT_MS, EXAM_REPLY_MS, ExamPage} from '../ExamPage';
import {setToken} from '../../services/authToken';

const SUMMARY = {
    tests: ['F', 'A', 'endgame'], overall: 1450, level: 'second', passed: 1, of: 10,
    results: {F: {correct: 6, total: 10, estimate: 1450, level: 'second', at: null}},
};
// Позиция 1 — мат в два: 1. R2e8+ Rxe8 2. Rxe8#; позиция 2 — мат в один: Qd8#.
const MATE2 = '3r2k1/5ppp/p7/8/8/8/4RPPP/4R1K1 w - - 0 2';
const MATE1 = '6k1/5ppp/p7/8/8/8/5PPP/3Q2K1 w - - 0 2';
const QUESTIONS = [
    {id: 1, fen: MATE2, color: 'white', previous_move: 'a7a6'},
    {id: 2, fen: MATE1, color: 'white', previous_move: 'a7a6'},
];
const GRADED = {correct: 1, total: 2, estimate: 1300, level: 'third', points: 2, max_points: 3, review: [
    {id: 1, answer: 'e2e8', correct: true, solution: 'e2e8', solution_san: 'R2e8+', rating: 800, points: 2, max_points: 2},
    {id: 2, answer: '0000', correct: false, solution: 'd1d8', solution_san: 'Qd8#', rating: 1600, points: 0, max_points: 1},
]};
const LINES: Record<number, string[]> = {1: ['e2e8', 'd8e8', 'e1e8'], 2: ['d1d8']};

/** Сервер экзамена: /move сверяет ходы с решением, как src/services/exam.play. */
function checkMove(body: { id: number; moves: string[] }) {
    const line = LINES[body.id];
    const total = (line.length + 1) / 2;
    const index = body.moves.length - 1;
    if (body.moves[index] !== line[2 * index]) {
        return {correct: false, reply: null, done: true, solved: false, points: index, max_points: total};
    }
    const solved = index + 1 === total;
    return {correct: true, reply: solved ? null : line[2 * index + 1], done: solved, solved, points: index + 1, max_points: total};
}

function stub(graded: object = GRADED, timeLimitS: number | null = null) {
    const calls: [string, any][] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const sent = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push([u, sent]);
        const body = u.endsWith('/questions') ? {section: 'F', questions: QUESTIONS, time_limit_s: timeLimitS}
            : u.endsWith('/move') ? checkMove(sent) : u.endsWith('/submit') ? graded : SUMMARY;
        return {ok: true, json: async () => body} as Response;
    }));
    return calls;
}

const click = (square: string) => fireEvent.click(document.querySelector(`[data-square="${square}"]`)!);
const pieceOn = (square: string) => document.querySelector(`[data-square="${square}"] img`)?.getAttribute('alt') ?? null;
const play = async (from: string, to: string) => {
    click(from);
    await act(async () => click(to));
};
const wait = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
});

beforeEach(() => {
    vi.useFakeTimers();
    setToken('jwt');
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setToken(null);
});

describe('диагностический экзамен', () => {
    it('комбинация доигрывается до мата: ответ соперника, очко за каждый верный ход, потом следующая позиция', async () => {
        const calls = stub();
        await act(async () => render(<MemoryRouter><ExamPage/></MemoryRouter>));
        expect(screen.getByTestId('exam-overall')).toHaveTextContent('Общий уровень: II разряд (~1450), пройдено тестов: 1 из 10.');
        expect(screen.getByTestId('exam-test-F')).toHaveTextContent('В прошлый раз: 6 из 10 · II разряд');
        expect(screen.getByTestId('exam-test-endgame')).toHaveTextContent('Эндшпильный экзамен (30 позиций)');

        await act(async () => fireEvent.click(screen.getByTestId('exam-start-F')));
        expect(screen.getByTestId('exam-progress')).toHaveTextContent('Позиция 1 из 2');
        expect(screen.getByTestId('exam-points')).toHaveTextContent('Очки: 0');

        // Первый верный ход: позиция НЕ сменилась, очко начислено, соперник отвечает ходом из решения.
        await play('e2', 'e8');
        expect(screen.getByTestId('exam-progress')).toHaveTextContent('Позиция 1 из 2');
        expect(screen.getByTestId('exam-points')).toHaveTextContent('Очки: 1');
        expect(screen.getByTestId('exam-flash')).toHaveTextContent('Верно! +1');
        expect(pieceOn('e8')).toBe('wr');
        expect(screen.getByTestId('exam-skip')).toBeDisabled();
        await wait(EXAM_REPLY_MS);
        expect(pieceOn('e8')).toBe('br');
        expect(screen.getByTestId('exam-progress')).toHaveTextContent('Позиция 1 из 2');

        // Матующий ход: мат виден на доске, и только после паузы — следующая позиция.
        await play('e1', 'e8');
        expect(screen.getByTestId('exam-flash')).toHaveTextContent('Решено! +1');
        expect(screen.getByTestId('exam-points')).toHaveTextContent('Очки: 2');
        expect(pieceOn('e8')).toBe('wr');
        expect(screen.getByTestId('exam-progress')).toHaveTextContent('Позиция 1 из 2');
        await wait(EXAM_NEXT_MS);
        expect(screen.getByTestId('exam-progress')).toHaveTextContent('Позиция 2 из 2');
        expect(pieceOn('d1')).toBe('wq');

        await act(async () => fireEvent.click(screen.getByTestId('exam-skip')));
        const moves = calls.filter(([u]) => u.endsWith('/F/move')).map(([, body]) => body);
        expect(moves).toEqual([{id: 1, moves: ['e2e8']}, {id: 1, moves: ['e2e8', 'e1e8']}]);
        const submit = calls.find(([u]) => u.endsWith('/F/submit'))!;
        expect(submit[1]).toEqual({answers: [{id: 1, moves: ['e2e8', 'e1e8']}, {id: 2, moves: []}]});
        expect(screen.getByTestId('exam-result')).toHaveTextContent('Итог: 1 из 2 · III разряд (~1300)');
        expect(screen.getByTestId('exam-result-points')).toHaveTextContent('Очки за верные ходы: 2 из 3');
        expect(screen.getByTestId('exam-result')).toHaveTextContent('2. Решение: Qd8# (задача ~1600) · найдено ходов: 0 из 1');
    });

    it('ошибка заканчивает позицию, очки за уже найденные ходы остаются', async () => {
        const calls = stub();
        await act(async () => render(<MemoryRouter><ExamPage/></MemoryRouter>));
        await act(async () => fireEvent.click(screen.getByTestId('exam-start-F')));
        await play('e2', 'e8');
        await wait(EXAM_REPLY_MS);
        await play('g1', 'h1');
        expect(screen.getByTestId('exam-flash')).toHaveTextContent('Не этот ход — следующая позиция.');
        expect(screen.getByTestId('exam-points')).toHaveTextContent('Очки: 1');
        await wait(EXAM_NEXT_MS);
        expect(screen.getByTestId('exam-progress')).toHaveTextContent('Позиция 2 из 2');
        await play('d1', 'd8');
        await wait(EXAM_NEXT_MS);
        const submit = calls.find(([u]) => u.endsWith('/F/submit'))!;
        expect(submit[1]).toEqual({answers: [{id: 1, moves: ['e2e8', 'g1h1']}, {id: 2, moves: ['d1d8']}]});
    });

    it('сбой сети на ходу: ход не теряется, позицию можно продолжить', async () => {
        const calls = stub();
        await act(async () => render(<MemoryRouter><ExamPage/></MemoryRouter>));
        await act(async () => fireEvent.click(screen.getByTestId('exam-start-F')));
        const working = globalThis.fetch;
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline');
        }));
        await play('e2', 'e8');
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(pieceOn('e2')).toBe('wr');
        vi.stubGlobal('fetch', working);
        await play('e2', 'e8');
        expect(screen.getByTestId('exam-points')).toHaveTextContent('Очки: 1');
        expect(calls.filter(([u]) => u.endsWith('/F/move'))).toHaveLength(1);
    });

    it('без входа — подсказка', () => {
        setToken(null);
        render(<MemoryRouter><ExamPage/></MemoryRouter>);
        expect(screen.getByTestId('exam-login')).toBeInTheDocument();
    });

    it('экзамен уровня на время (27.12): часы, по истечении тест сдаётся сам, недошедшие позиции — пустые', async () => {
        const calls = stub(GRADED, 120);
        await act(async () => render(<MemoryRouter initialEntries={['/exam?test=level2']}><ExamPage/></MemoryRouter>));
        expect(screen.getByTestId('exam-clock')).toHaveTextContent('Осталось: 2:00');
        await wait(60_000);
        expect(screen.getByTestId('exam-clock')).toHaveTextContent('Осталось: 1:00');
        await act(async () => fireEvent.click(screen.getByTestId('exam-skip')));
        expect(calls.some(([u]) => u.endsWith('/submit'))).toBe(false);
        await wait(60_000);
        const submit = calls.find(([u]) => u.endsWith('/level2/submit'));
        expect(submit?.[1]).toEqual({answers: [{id: 1, moves: []}, {id: 2, moves: []}]});
        expect(screen.getByTestId('exam-time-up')).toHaveTextContent('Время вышло');
        expect(calls.filter(([u]) => u.endsWith('/submit'))).toHaveLength(1);  // сдан один раз
    });

    it('у диагностики разделов времени нет', async () => {
        stub();
        await act(async () => render(<MemoryRouter initialEntries={['/exam?test=F']}><ExamPage/></MemoryRouter>));
        expect(screen.getByTestId('exam-question')).toBeInTheDocument();
        expect(screen.queryByTestId('exam-clock')).toBeNull();
    });

    it('экзамен уровня курса (27.12): старт по ссылке ?test=, итог по ветвям', async () => {
        const calls = stub({...GRADED, branches: {T: {correct: 1, total: 1}, E: {correct: 0, total: 1}}});
        await act(async () => render(<MemoryRouter initialEntries={['/exam?test=level2']}><ExamPage/></MemoryRouter>));
        expect(calls.some(([u]) => u.endsWith('/level2/questions'))).toBe(true);
        expect(screen.getByTestId('exam-question')).toHaveTextContent('Экзамен уровня 2');
        await act(async () => fireEvent.click(screen.getByTestId('exam-skip')));
        await play('d1', 'd8');
        await wait(EXAM_NEXT_MS);
        expect(calls.some(([u]) => u.endsWith('/level2/submit'))).toBe(true);
        expect(screen.getByTestId('exam-branches')).toHaveTextContent('Тактика: 1/1');
        expect(screen.getByTestId('exam-branches')).toHaveTextContent('Эндшпиль: 0/1');
    });
});
