// Большой курс (таск 27.6): уровни, ветви, пустые модули видны только в каркасе, отметка «модуль пройден».

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SupercoursePage} from '../SupercoursePage';
import {setToken} from '../../../services/authToken';

// Все модули курса наполнены; чтобы проверить режим «каркас», модуль T3.2 подменяется пустым.
vi.mock('../../../content/supercourse', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../content/supercourse')>();
    return {...original, COURSE: original.COURSE.map((m) => (m.code === 'T3.2' ? {...m, steps: []} : m))};
});

beforeEach(() => setToken('jwt'));
afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
});

describe('Большой курс', () => {
    it('уровень 1, каркас и отметка модуля', async () => {
        const calls: [string, RequestInit | undefined][] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            calls.push([String(url), init]);
            const body = init?.method === 'PUT' ? {lesson_id: 'course-t1-1', step: 0, steps_total: 1, completed: true}
                : String(url).includes('/exam') ? {results: {level0: {estimate: 900}, level1: {estimate: 950}}}
                : String(url).includes('/puzzles/training') ? {window: 10, pass: 8, themes: [
                    {code: 'fork', section: 'A', stage: 1, recent: '', solved: 0, mastered: false, available: [30, 30, 30, 30], ready: true},
                    {code: 'pin', section: 'B', stage: 1, recent: '', solved: 0, mastered: false, available: [0, 0, 0, 0], ready: false}]}
                    : [{lesson_id: 'course-t1-2', step: 0, steps_total: 1, completed: true}];
            return {ok: true, json: async () => body} as Response;
        }));
        await act(async () => render(<MemoryRouter><SupercoursePage/></MemoryRouter>));
        expect(screen.getByTestId('course-module-T0.0')).toHaveTextContent('Доска, фигуры и взятие');
        // Экзамен уровня 0 сдан (≥ 800), уровня 1 — нет (< 1000).
        expect(screen.getByTestId('course-exam-target-0')).toHaveTextContent('Уровень пройден');
        await act(async () => fireEvent.click(screen.getByTestId('course-level-1')));
        expect(screen.getByTestId('course-level-1')).toHaveTextContent('1/');
        await act(async () => fireEvent.click(screen.getByTestId('course-level-3')));
        expect(screen.queryByTestId('course-module-T3.2')).toBeNull();  // модуль без шагов скрыт
        fireEvent.click(screen.getByTestId('course-skeleton'));
        expect(screen.getByTestId('course-module-T3.2')).toHaveTextContent('скоро');
        await act(async () => fireEvent.click(screen.getByTestId('course-level-1')));
        expect(screen.getByTestId('course-exam-target-1')).toHaveTextContent('не ниже 1000');
        expect(screen.getByTestId('course-step-empty-pin')).toHaveTextContent('задач пока нет');  // T1.2: в теме нет задач
        await act(async () => fireEvent.click(screen.getByTestId('course-done-T1.1')));
        const put = calls.find(([, init]) => init?.method === 'PUT')!;
        expect(put[0]).toContain('/learn/progress/course-t1-1');
        expect(screen.queryByTestId('course-done-T1.1')).toBeNull();
    });
});
