// «Миниатюры» (таск 27.9): засчитывается любой мат, неверный ход показывает ход партии, итог после последнего.

import {act, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {isMate, MiniatureGame} from '../MiniatureGame';

let boardMove: ((uci: string) => void) | null = null;
vi.mock('../../puzzles/PuzzleBoard', () => ({
    PuzzleBoard: ({onMove}: { onMove: (uci: string) => void }) => {
        boardMove = onMove;
        return <div data-testid="board"/>;
    },
}));

afterEach(() => vi.unstubAllGlobals());

const BEFORE_MATE = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
const ITEM = {id: 7, white: 'A', black: 'B', event: '', site: '', date: '', year: 1900, result: '1-0', eco: 'C20', opening: '',
    plies: 7, structure: null, fen: BEFORE_MATE, moves: ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6'], answer: 'h5f7'};

describe('Миниатюры', () => {
    it('мат проверяется по позиции', () => {
        expect(isMate(BEFORE_MATE, 'h5f7')).toBe(true);
        expect(isMate(BEFORE_MATE, 'h5e5')).toBe(false);
        expect(isMate(BEFORE_MATE, 'a1a8')).toBe(false);  // нелегальный ход
    });

    it('верный и неверный ответ, итог', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => ({miniatures: [ITEM, ITEM]})}) as Response));
        const onFinish = vi.fn();
        await act(async () => render(<MemoryRouter><MiniatureGame seed={1} onFinish={onFinish}/></MemoryRouter>));
        expect(screen.getByTestId('miniature-players')).toHaveTextContent('A — B, 1900');
        act(() => boardMove!('h5f7'));
        expect(screen.getByTestId('miniature-verdict')).toHaveTextContent('Мат!');
        expect(screen.getByTestId('miniature-game-link')).toHaveAttribute('href', '/library/game/7');
        act(() => screen.getByTestId('quiz-next').click());
        act(() => boardMove!('h5e5'));
        expect(screen.getByTestId('miniature-verdict')).toHaveTextContent('Не мат');
        act(() => screen.getByTestId('quiz-next').click());
        expect(onFinish).toHaveBeenCalledWith(10, 1);
    });
});
