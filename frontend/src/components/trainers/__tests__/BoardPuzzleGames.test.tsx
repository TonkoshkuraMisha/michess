// Головоломки на доске (таск 19.4): расстановка с подсветкой конфликтов и счётчиком решений, обход конём с подсказкой.

import {fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {KnightTourGame, PlacementGame} from '../BoardPuzzleGames';
import {CLOSED_TOUR_SCORE, OPEN_TOUR_SCORE, allQueenSolutions, warnsdorffHint} from '../../../trainers/boardPuzzles';
import type {Cell} from '../../../trainers/boardPuzzles';

const FILES = 'abcdefgh';
const click = ([x, y]: Cell) => fireEvent.click(document.querySelector(`[data-cell="${FILES[x]}${y + 1}"]`)!);

afterEach(() => localStorage.clear());

describe('расстановка', () => {
    it('4 ферзя: конфликт — ошибка и подсветка; решение — итог и счётчик решений', () => {
        const onFinish = vi.fn();
        render(<PlacementGame level={1} seed={1} onFinish={onFinish}/>);
        click([0, 0]);
        click([1, 1]);   // по диагонали — конфликт
        expect(screen.getByTestId('placement-status')).toHaveTextContent('есть фигуры, которые бьют друг друга');
        click([1, 1]);   // снять
        click([0, 0]);
        for (const cell of allQueenSolutions(4)[0]) click(cell);
        expect(onFinish).toHaveBeenCalledWith(90, 1);
        expect(screen.getByTestId('placement-found')).toHaveTextContent('Найдено различных решений: 1 из 2');
        expect(JSON.parse(localStorage.getItem('regence_placement_solutions_queens4')!)).toHaveLength(1);
    });

    it('больше фигур, чем нужно, поставить нельзя; доминирование показывает непокрытые поля', () => {
        render(<PlacementGame level={10} seed={1} onFinish={vi.fn()}/>);
        expect(screen.getByTestId('placement-status')).toHaveTextContent('не под контролем полей: 64');
        for (const cell of [[0, 0], [1, 0], [5, 1], [0, 4], [4, 5], [7, 7]] as Cell[]) click(cell);
        expect(screen.getByTestId('placement-status')).toHaveTextContent('Расставлено: 5 из 5');
    });
});

describe('обход конём', () => {
    it('подсказка Варнсдорфа ведёт до конца 5×5; неверный ход — ошибка; итог открытого обхода', () => {
        const onFinish = vi.fn();
        render(<KnightTourGame level={1} seed={1} onFinish={onFinish}/>);
        click([0, 0]);
        click([0, 1]);   // не ход коня
        const path: Cell[] = [[0, 0]];
        for (let i = 1; i < 25; i++) {
            fireEvent.click(screen.getByTestId('tour-hint'));
            const next = warnsdorffHint(path, 5)!;
            path.push(next);
            click(next);
        }
        expect(onFinish).toHaveBeenCalledTimes(1);
        const [score, mistakes] = onFinish.mock.calls[0];
        expect(mistakes).toBe(1);
        expect(score === OPEN_TOUR_SCORE - 90 || score === CLOSED_TOUR_SCORE - 90).toBe(true);
    });

    it('тупик распознаётся (подсказка недоступна); ход можно вернуть', () => {
        render(<KnightTourGame level={1} seed={1} onFinish={vi.fn()}/>);
        // Короткий маршрут на 5×5, после которого у коня нет ходов (найден перебором).
        const deadEnd: Cell[] = [[0, 0], [1, 2], [2, 4], [4, 3], [3, 1], [1, 0], [0, 2], [2, 3], [0, 4]];
        for (const cell of deadEnd) click(cell);
        expect(screen.getByTestId('tour-stuck')).toHaveTextContent('тупик');
        expect(screen.getByTestId('tour-hint')).toBeDisabled();
        fireEvent.click(screen.getByTestId('tour-undo'));
        expect(screen.queryByTestId('tour-stuck')).toBeNull();
        expect(screen.getByTestId('tour-status')).toHaveTextContent('Пройдено полей: 8 из 25');
    });
});
