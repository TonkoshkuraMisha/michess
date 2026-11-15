// Совместный разбор (таск 17.3): стрелки ведущего, вопрос, ответ ученика ходом, шаг урока в формате школы.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {lessonProblems, lessonStep, sessionLesson, StudyRoomPage} from '../StudyPages';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BOARD = {fen: START, last_move: null, arrows: [], highlights: [], ghost: null};
const cell = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLElement;

function room(extra: Record<string, unknown> = {}) {
    return {code: 'abc12345', host: 'coach', is_host: true, version: 3, board: BOARD, chat: [], question: null, participants: ['coach'], ...extra};
}

function stub(state: Record<string, unknown>) {
    const fetchMock = vi.fn(async () => ({ok: true, status: 200, json: async () => state} as Response));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stub>, method: string) =>
    (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([, init]) => init?.method === method);

function open() {
    return render(<MemoryRouter initialEntries={['/study/abc12345']}><Routes><Route path="/study/:code" element={<StudyRoomPage/>}/></Routes></MemoryRouter>);
}

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('совместный разбор', () => {
    it('ведущий: стрелка двумя щелчками выбранным цветом и вопрос с вариантами', async () => {
        const fetchMock = stub(room());
        open();
        await screen.findByTestId('study-tools');
        fireEvent.click(screen.getByTestId('tool-arrow'));
        fireEvent.click(screen.getByRole('button', {name: 'Красная'}));
        fireEvent.click(cell('e2'));
        await act(async () => fireEvent.click(cell('e4')));
        expect(JSON.parse(String(calls(fetchMock, 'PUT')[0][1].body)).arrows).toEqual([{from: 'e2', to: 'e4', color: 'red'}]);

        fireEvent.change(screen.getByTestId('question-prompt'), {target: {value: 'Какой план?'}});
        fireEvent.change(screen.getByTestId('question-options'), {target: {value: 'Атака\nЗащита'}});
        fireEvent.change(screen.getByTestId('question-correct'), {target: {value: '2'}});
        await act(async () => fireEvent.click(screen.getByTestId('question-ask')));
        expect(JSON.parse(String(calls(fetchMock, 'POST').at(-1)![1].body))).toMatchObject({
            kind: 'choice', prompt: 'Какой план?', options: ['Атака', 'Защита'], correct: 1,
        });
        expect(screen.getByTestId('study-lesson')).toHaveTextContent('шагов 1');
    });

    it('ученик: ответ на вопрос «найти ход» — ходом на своей доске', async () => {
        const fetchMock = stub(room({is_host: false, question: {id: 'q', kind: 'move', prompt: 'Ваш ход', deadline: Date.now() / 1000 + 60, revealed: false}}));
        open();
        expect(await screen.findByTestId('study-question')).toHaveTextContent('Ваш ход');
        document.elementsFromPoint = vi.fn(() => [cell('e4')]);
        await act(async () => {
            fireEvent.pointerDown(cell('e2'), {button: 0, pointerType: 'mouse', clientX: 5, clientY: 5});
        });
        await act(async () => {
            fireEvent.pointerMove(window, {clientX: 50, clientY: 50});
        });
        await act(async () => {
            fireEvent.pointerUp(window, {clientX: 90, clientY: 90});
        });
        // Ответ уходит асинхронно — под нагрузкой CI запроса ещё могло не быть: дождаться его.
        await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(1));
        expect(JSON.parse(String(calls(fetchMock, 'POST')[0][1].body))).toEqual({answer: 'e2e4'});
    });

    it('урок из занятия: без вопроса — не готов; с вопросом — проходит проверку формата школы', () => {
        const step = lessonStep({...BOARD, arrows: [{from: 'e2', to: 'e4', color: 'green'}], highlights: [{square: 'e4', tone: 'light'}]}, 'Центр');
        expect(lessonProblems(sessionLesson('abc', 'Разбор', [step]))).not.toEqual([]);
        const question = {type: 'find_move', fen: START, text: {en: 'Ход?', uk: 'Ход?', ru: 'Ход?'}, line: [{answers: ['e2e4']}]};
        expect(lessonProblems(sessionLesson('abc', 'Разбор', [step, question]))).toEqual([]);
    });
});
