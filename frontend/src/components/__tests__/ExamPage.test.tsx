// Диагностический экзамен (таск 22.0): обзор тестов, прохождение без подсказок (ход на доске и «не знаю»), итог.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ExamPage} from '../ExamPage';
import {setToken} from '../../services/authToken';

const SUMMARY = {
    tests: ['F', 'A', 'endgame'], overall: 1450, level: 'second', passed: 1, of: 10,
    results: {F: {correct: 6, total: 10, estimate: 1450, level: 'second', at: null}},
};
const QUESTIONS = [
    {id: 1, fen: '6k1/p4ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1', color: 'white', previous_move: 'a7a6'},
    {id: 2, fen: '6k1/p4ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1', color: 'white', previous_move: 'a7a6'},
];
const GRADED = {correct: 1, total: 2, estimate: 1300, level: 'third', review: [
    {id: 1, answer: 'd1d8', correct: true, solution: 'd1d8', solution_san: 'Qd8#', rating: 800},
    {id: 2, answer: '0000', correct: false, solution: 'd1d8', solution_san: 'Qd8#', rating: 1600},
]};

function stub(graded: object = GRADED) {
    const calls: [string, unknown][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        calls.push([u, init?.body ? JSON.parse(String(init.body)) : null]);
        const body = u.endsWith('/questions') ? {section: 'F', questions: QUESTIONS} : u.endsWith('/submit') ? graded : SUMMARY;
        return {ok: true, json: async () => body} as Response;
    }));
    return calls;
}

const click = (square: string) => fireEvent.click(document.querySelector(`[data-square="${square}"]`)!);

beforeEach(() => setToken('jwt'));
afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
});

describe('диагностический экзамен', () => {
    it('обзор, прохождение теста и итог с разбором', async () => {
        const calls = stub();
        await act(async () => render(<MemoryRouter><ExamPage/></MemoryRouter>));
        expect(screen.getByTestId('exam-overall')).toHaveTextContent('Общий уровень: II разряд (~1450), пройдено тестов: 1 из 10.');
        expect(screen.getByTestId('exam-test-F')).toHaveTextContent('В прошлый раз: 6 из 10 · II разряд');
        expect(screen.getByTestId('exam-test-endgame')).toHaveTextContent('Эндшпильный экзамен (30 позиций)');

        await act(async () => fireEvent.click(screen.getByTestId('exam-start-F')));
        expect(screen.getByTestId('exam-progress')).toHaveTextContent('Позиция 1 из 2');
        click('d1');
        await act(async () => click('d8'));
        expect(screen.getByTestId('exam-progress')).toHaveTextContent('Позиция 2 из 2');
        await act(async () => fireEvent.click(screen.getByTestId('exam-skip')));

        const submit = calls.find(([u]) => u.endsWith('/F/submit'))!;
        expect(submit[1]).toEqual({answers: [{id: 1, move: 'd1d8'}, {id: 2, move: '0000'}]});
        expect(screen.getByTestId('exam-result')).toHaveTextContent('Итог: 1 из 2 · III разряд (~1300)');
        expect(screen.getByTestId('exam-result')).toHaveTextContent('2. Решение: Qd8# (задача ~1600)');
    });

    it('без входа — подсказка', () => {
        setToken(null);
        render(<MemoryRouter><ExamPage/></MemoryRouter>);
        expect(screen.getByTestId('exam-login')).toBeInTheDocument();
    });

    it('экзамен уровня курса (27.12): старт по ссылке ?test=, итог по ветвям', async () => {
        const calls = stub({...GRADED, branches: {T: {correct: 1, total: 1}, E: {correct: 0, total: 1}}});
        await act(async () => render(<MemoryRouter initialEntries={['/exam?test=level2']}><ExamPage/></MemoryRouter>));
        expect(calls.some(([u]) => u.endsWith('/level2/questions'))).toBe(true);
        expect(screen.getByTestId('exam-question')).toHaveTextContent('Экзамен уровня 2');
        click('d1');
        await act(async () => click('d8'));
        await act(async () => fireEvent.click(screen.getByTestId('exam-skip')));
        expect(calls.some(([u]) => u.endsWith('/level2/submit'))).toBe(true);
        expect(screen.getByTestId('exam-branches')).toHaveTextContent('Тактика: 1/1');
        expect(screen.getByTestId('exam-branches')).toHaveTextContent('Эндшпиль: 0/1');
    });
});
