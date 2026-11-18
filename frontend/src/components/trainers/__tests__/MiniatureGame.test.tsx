// «Миниатюры» (таск 27.9): засчитывается любой мат, неверный ход показывает ход партии, итог после последнего.

import {act, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {isMate, MiniatureGame} from '../MiniatureGame';

let boardMove: ((uci: string) => void) | null = null;
vi.mock('../../puzzles/PuzzleBoard', () => ({
    PuzzleBoard: ({onMove, fen, interactive, arrows}: {
        onMove: (uci: string) => void; fen: string; interactive: boolean; arrows: { from: string; to: string }[];
    }) => {
        boardMove = onMove;
        return <div data-testid="board" data-fen={fen} data-interactive={String(interactive)}
                    data-arrows={arrows.map((a) => a.from + a.to).join(',')}/>;
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

    it('после ответа доска свободна: ход стоит на доске, позицию можно доиграть и вернуть', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => ({miniatures: [ITEM, ITEM]})}) as Response));
        await act(async () => render(<MemoryRouter><MiniatureGame seed={1} onFinish={vi.fn()}/></MemoryRouter>));
        const board = () => screen.getByTestId('board');
        // Верный мат — ферзь стоит на f7, стрелки нет, доска по-прежнему откликается.
        act(() => boardMove!('h5f7'));
        expect(board().dataset.fen).toContain('r1bqkb1r/pppp1Qpp/');
        expect(board().dataset.interactive).toBe('true');
        expect(board().dataset.arrows).toBe('');
        act(() => screen.getByTestId('explorer-reset').click());
        expect(board().dataset.fen).toBe(BEFORE_MATE);

        // Неверный ответ — позиция задачи и стрелка хода партии; её можно сыграть самому и вернуть назад.
        act(() => screen.getByTestId('quiz-next').click());
        act(() => boardMove!('h5e5'));
        expect(board().dataset.fen).toBe(BEFORE_MATE);
        expect(board().dataset.arrows).toBe('h5f7');
        act(() => boardMove!('h5f7'));
        expect(board().dataset.fen).toContain('pppp1Qpp');
        expect(board().dataset.arrows).toBe('');
        expect(screen.getByTestId('miniature-verdict')).toHaveTextContent('Не мат');  // засчитан первый ответ
        act(() => screen.getByTestId('explorer-back').click());
        expect(board().dataset.fen).toBe(BEFORE_MATE);
    });
});
