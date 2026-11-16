// «Узнай структуру» (таск 27.9): вопросы с сервера, ответ подсвечивается, ссылка на партию, итог после последнего.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {StructureQuiz} from '../StructureQuiz';

afterEach(() => vi.unstubAllGlobals());

const QUESTIONS = [
    {fen: '6k1/pp3ppp/4p3/8/3P4/8/PP3PPP/6K1 w - - 0 1', answer: 'isolated_pawn',
        options: ['carlsbad', 'isolated_pawn', 'saw', 'hedgehog'], game_id: null, ply: null},
    {fen: '6k1/pp1q1ppp/4p3/3pP3/3P4/8/PP3PPP/6K1 w - - 0 1', answer: 'french_chain',
        options: ['french_chain', 'symmetry', 'spanish', 'wedge'], game_id: 42, ply: 20},
];

describe('Узнай структуру', () => {
    it('два вопроса: верный и неверный ответ, ссылка на партию, итог', async () => {
        const fetchMock = vi.fn(async () => ({ok: true, json: async () => ({questions: QUESTIONS})}) as Response);
        vi.stubGlobal('fetch', fetchMock);
        const onFinish = vi.fn();
        await act(async () => render(<MemoryRouter><StructureQuiz seed={3} onFinish={onFinish}/></MemoryRouter>));
        expect(String(fetchMock.mock.calls[0])).toContain('/library/structure-quiz?count=10&seed=3');
        fireEvent.click(screen.getByTestId('quiz-option-isolated_pawn'));
        expect(screen.queryByTestId('structure-game-link')).toBeNull();  // скелет — без партии
        fireEvent.click(screen.getByTestId('quiz-next'));
        fireEvent.click(screen.getByTestId('quiz-option-wedge'));
        expect(screen.getByTestId('quiz-option-french_chain').className).toContain('emerald');
        expect(screen.getByTestId('structure-game-link')).toHaveAttribute('href', '/library/game/42');
        fireEvent.click(screen.getByTestId('quiz-next'));
        expect(onFinish).toHaveBeenCalledWith(10, 1);
    });
});
