// Большой курс (таск 27.6): уровни, ветви, пустые модули видны только в каркасе, отметка «модуль пройден».

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SupercoursePage} from '../SupercoursePage';
import {setToken} from '../../../services/authToken';

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
                : [{lesson_id: 'course-t1-2', step: 0, steps_total: 1, completed: true}];
            return {ok: true, json: async () => body} as Response;
        }));
        await act(async () => render(<MemoryRouter><SupercoursePage/></MemoryRouter>));
        expect(screen.getByTestId('course-module-T0.0')).toHaveTextContent('Доска, фигуры и взятие');
        await act(async () => fireEvent.click(screen.getByTestId('course-level-1')));
        expect(screen.getByTestId('course-level-1')).toHaveTextContent('1/');
        expect(screen.queryByTestId('course-module-G1.1')).toBeNull();  // миниатюр ещё нет — модуль пустой
        fireEvent.click(screen.getByTestId('course-skeleton'));
        expect(screen.getByTestId('course-module-G1.1')).toHaveTextContent('скоро');
        await act(async () => fireEvent.click(screen.getByTestId('course-done-T1.1')));
        const put = calls.find(([, init]) => init?.method === 'PUT')!;
        expect(put[0]).toContain('/learn/progress/course-t1-1');
        expect(screen.queryByTestId('course-done-T1.1')).toBeNull();
    });
});
