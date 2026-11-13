// Пометки игрока правой кнопкой (таск B.1): стрелки и поля, цвета модификаторами, повтор снимает, левый щелчок и
// новая позиция убирают всё; на живой доске при выбранной фигуре правая кнопка остаётся за отменой.

import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {PuzzleBoard} from '../../puzzles/PuzzleBoard';
import {annotationColor, toggleArrow, toggleSquare} from '../annotations';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** jsdom не умеет elementsFromPoint: поле под указателем — то, на котором событие. */
function pointer(type: 'pointerDown' | 'pointerUp', square: string, init: Record<string, unknown> = {}) {
    const cell = document.querySelector(`[data-square="${square}"]`) as HTMLElement;
    document.elementsFromPoint = () => [cell];
    fireEvent[type](cell, {pointerType: 'mouse', button: 2, ...init});
}

describe('пометки доски', () => {
    it('цвет по модификатору', () => {
        const none = {shiftKey: false, altKey: false, ctrlKey: false, metaKey: false};
        expect(annotationColor(none)).toBe('green');
        expect(annotationColor({...none, shiftKey: true})).toBe('red');
        expect(annotationColor({...none, altKey: true})).toBe('blue');
        expect(annotationColor({...none, ctrlKey: true})).toBe('yellow');
        expect(annotationColor({...none, shiftKey: true, altKey: true})).toBe('yellow');
    });

    it('повтор снимает, другой цвет перекрашивает', () => {
        const one = toggleArrow([], {from: 'e2', to: 'e4', color: 'green'});
        expect(toggleArrow(one, {from: 'e2', to: 'e4', color: 'red'})).toEqual([{from: 'e2', to: 'e4', color: 'red'}]);
        expect(toggleArrow(one, {from: 'e2', to: 'e4', color: 'green'})).toEqual([]);
        expect(toggleSquare(toggleSquare({}, 'd5', 'blue'), 'd5', 'blue')).toEqual({});
    });

    it('доска задач: стрелка, поле, левый щелчок и новая позиция убирают', () => {
        const {rerender} = render(<PuzzleBoard fen={START} orientation="white" interactive onMove={vi.fn()}/>);
        pointer('pointerDown', 'g1');
        pointer('pointerUp', 'f3', {shiftKey: true});
        expect(screen.getByTestId('note-arrow-g1-f3').getAttribute('data-color')).toBe('red');
        pointer('pointerDown', 'e5');
        pointer('pointerUp', 'e5');
        expect(screen.getByTestId('note-square-e5')).toBeTruthy();

        pointer('pointerDown', 'a3', {button: 0});
        expect(screen.queryByTestId('board-annotations')).toBeNull();

        pointer('pointerDown', 'g1');
        pointer('pointerUp', 'f3');
        rerender(<PuzzleBoard fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1" orientation="white" interactive onMove={vi.fn()}/>);
        expect(screen.queryByTestId('board-annotations')).toBeNull();
    });

    it('касание пальцем пометок не рисует', () => {
        render(<PuzzleBoard fen={START} orientation="white" interactive onMove={vi.fn()}/>);
        pointer('pointerDown', 'g1', {pointerType: 'touch'});
        pointer('pointerUp', 'f3', {pointerType: 'touch'});
        expect(screen.queryByTestId('board-annotations')).toBeNull();
    });
});
