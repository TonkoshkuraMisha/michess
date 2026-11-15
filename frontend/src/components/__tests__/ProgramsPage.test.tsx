// Программы тренировок (таск 22.3): список с прогрессом, недели и занятия, отметка «занятие выполнено».

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ProgramPage, ProgramsPage} from '../ProgramsPage';
import {setToken} from '../../services/authToken';

function stub(progress: unknown[]) {
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([String(url), init]);
        const body = init?.method === 'PUT' ? {lesson_id: 'program-to_1200', step: 2, steps_total: 40, completed: false} : progress;
        return {ok: true, json: async () => body} as Response;
    }));
    return calls;
}

const page = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/programs" element={<ProgramsPage/>}/>
            <Route path="/programs/:programId" element={<ProgramPage/>}/>
        </Routes>
    </MemoryRouter>,
);

beforeEach(() => setToken('jwt'));
afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
});

describe('программы тренировок', () => {
    it('список с прогрессом', async () => {
        stub([{lesson_id: 'program-club', step: 4, steps_total: 40, completed: false}]);
        await act(async () => page('/programs'));
        expect(screen.getByTestId('program-club')).toHaveTextContent('Пройдено занятий: 5 из 40');
        expect(screen.getByTestId('program-first_steps')).toHaveTextContent('Пройдено занятий: 0 из 40');
    });

    it('занятия программы и отметка текущего', async () => {
        const calls = stub([{lesson_id: 'program-to_1200', step: 1, steps_total: 40, completed: false}]);
        await act(async () => page('/programs/to_1200'));
        expect(screen.getByTestId('program-progress')).toHaveTextContent('Пройдено занятий: 2 из 40');
        expect(screen.getByTestId('session-0')).toHaveTextContent('Двойной удар');
        expect(screen.getByTestId('session-2')).toHaveTextContent('Тренажёр');
        await act(async () => fireEvent.click(screen.getByTestId('session-done')));
        const put = calls.find(([, init]) => init?.method === 'PUT')!;
        expect(put[0]).toContain('/learn/progress/program-to_1200');
        expect(JSON.parse(String(put[1]!.body))).toEqual({step: 2, steps_total: 40, completed: false});
        expect(screen.getByTestId('program-progress')).toHaveTextContent('Пройдено занятий: 3 из 40');
    });

    it('нет такой программы', () => {
        stub([]);
        page('/programs/nope');
        expect(screen.getByText('Такой программы нет.')).toBeInTheDocument();
    });
});
