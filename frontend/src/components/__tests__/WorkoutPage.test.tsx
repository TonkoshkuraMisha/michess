// Ежедневная разминка (таск 22.2): план с отметками и серией, переходы в задачи по теме, тренажёр, дебюты, ошибки.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WorkoutPage} from '../WorkoutPage';
import type {WorkoutPlan} from '../../services/workout';
import {setToken} from '../../services/authToken';

const PLAN: WorkoutPlan = {
    date: '2026-11-16', complete: false, streak: 3,
    steps: [
        {kind: 'puzzles', themes: ['pin', 'fork'], target: 5, done: 2},
        {kind: 'trainer', trainer: 'coord_name', done: true},
        {kind: 'repertoire', due: 4, repertoire_id: 7, done: false},
        {kind: 'mistake', due: 0, done: true},
    ],
};

function PuzzlesProbe() {
    const location = useLocation();
    return <p data-testid="probe">{JSON.stringify(location.state)}</p>;
}

const page = () => render(
    <MemoryRouter initialEntries={['/workout']}>
        <Routes>
            <Route path="/workout" element={<WorkoutPage/>}/>
            <Route path="/puzzles" element={<PuzzlesProbe/>}/>
        </Routes>
    </MemoryRouter>,
);

beforeEach(() => setToken('jwt'));
afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
});

describe('ежедневная разминка', () => {
    it('план, серия, ссылки на тренажёр и повторение', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => PLAN}) as Response));
        await act(async () => page());
        expect(screen.getByTestId('workout-status')).toHaveTextContent('Дней подряд: 3');
        expect(screen.getByTestId('workout-puzzles')).toHaveTextContent('Задачи на слабые темы: 2 из 5');
        expect(screen.getByRole('link', {name: 'Назови поле'})).toHaveAttribute('href', '/train/coord_name');
        expect(screen.getByRole('link', {name: 'Повторить позиций: 4'})).toHaveAttribute('href', '/repertoire/7/drill');
        expect(screen.getByTestId('workout-mistake')).toHaveTextContent('Сегодня ошибок для повторения нет.');
        await act(async () => fireEvent.click(screen.getByTestId('workout-theme-pin')));
        expect(screen.getByTestId('probe')).toHaveTextContent('{"train":{"theme":"pin","blind":false}}');
    });

    it('без входа — подсказка', () => {
        setToken(null);
        page();
        expect(screen.getByTestId('workout-login')).toBeInTheDocument();
    });
});
