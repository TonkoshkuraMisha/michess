// --- FILE: frontend/src/test/boardMoves.ts ---
// Ход на доске в тестах страниц: два щелчка — по своей фигуре и по полю. Не перетаскивание: доски подписываются на
// отпускание фигуры из эффекта, и под нагрузкой CI отпускание иногда приходило раньше подписки — ход терялся, тест
// падал случайно. Само перетаскивание проверяют тесты PuzzleBoard (puzzleMoves.test.tsx) и главной доски.

import {act, fireEvent} from '@testing-library/react';

/** Клетка доски по имени поля (data-square). */
export function boardCell(square: string): HTMLElement {
    const element = document.querySelector(`[data-square="${square}"]`);
    if (!(element instanceof HTMLElement)) throw new Error(`no square ${square}`);
    return element;
}

/** Сделать ход from → to двумя щелчками (каждый — в act, чтобы React успел отрисовать выбор). */
export async function playMove(from: string, to: string): Promise<void> {
    await act(async () => {
        fireEvent.click(boardCell(from));
    });
    await act(async () => {
        fireEvent.click(boardCell(to));
    });
}
