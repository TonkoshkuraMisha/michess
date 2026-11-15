// --- FILE: frontend/src/trainers/memory.ts ---
// Тренажёры памяти (таск 19.3). «Восстанови позицию»: позиция из настоящей партии показывается несколько секунд,
// затем её нужно расставить по памяти; оценка — по каждому полю. «Запомни партию»: первые ходы известной партии
// проигрываются, затем их нужно повторить на доске. Позиции — из партий классики (14.7) и эндшпилей (14.4): у
// естественных позиций другая память, чем у случайных.

import {Chess} from 'chess.js';
import {rng} from './vision';

export type Placement = Record<string, string>;

/** Ступени «Восстанови позицию»: 4–6, 7–12, 13–24 фигуры; время показа убывает с 15 до 3 с. */
export const MEMORY_LEVELS: { min: number; max: number; seconds: number }[] = [
    {min: 3, max: 6, seconds: 15}, {min: 3, max: 6, seconds: 10}, {min: 4, max: 6, seconds: 6},
    {min: 7, max: 12, seconds: 15}, {min: 7, max: 12, seconds: 10}, {min: 7, max: 12, seconds: 6},
    {min: 13, max: 18, seconds: 15}, {min: 13, max: 24, seconds: 10}, {min: 13, max: 24, seconds: 6}, {min: 13, max: 24, seconds: 3},
];

export function memoryLevel(level: number) {
    return MEMORY_LEVELS[Math.min(MEMORY_LEVELS.length, Math.max(1, level)) - 1];
}

export function placementOfFen(fen: string): Placement {
    const result: Placement = {};
    fen.split(' ')[0].split('/').forEach((row, i) => {
        let file = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) file += Number(ch);
            else result[`${String.fromCharCode(97 + file++)}${8 - i}`] = ch;
        }
    });
    return result;
}

/** Все позиции партий (после каждого полухода) и позиции эндшпилей — пул для «Восстанови позицию». */
export function positionPool(games: { moves: string[] }[], endgames: { fen: string }[]): string[] {
    const pool: string[] = [];
    for (const game of games) {
        const board = new Chess();
        for (const uci of game.moves) {
            try {
                board.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
            } catch {
                break;
            }
            pool.push(board.fen());
        }
    }
    for (const item of endgames) pool.push(item.fen);
    return pool;
}

export function pieceCount(fen: string): number {
    return Object.keys(placementOfFen(fen)).length;
}

/** Позиция для уровня: из пула — с числом фигур в диапазоне уровня; детерминированно по seed. */
export function pickPosition(pool: string[], level: number, seed: number): string | null {
    const {min, max} = memoryLevel(level);
    const fitting = pool.filter((fen) => {
        const n = pieceCount(fen);
        return n >= min && n <= max;
    });
    if (fitting.length === 0) return null;
    return fitting[Math.floor(rng(seed)() * fitting.length)];
}

export interface PlacementScore {
    /** Поля, где фигура стоит верно. */
    correct: string[];
    /** Поля с ошибкой: не та фигура, лишняя или пропущенная. */
    wrong: string[];
    /** 0–100: доля верных полей среди всех занятых в исходной позиции или в ответе. */
    score: number;
}

export function scorePlacement(target: Placement, answer: Placement): PlacementScore {
    const squares = new Set([...Object.keys(target), ...Object.keys(answer)]);
    const correct: string[] = [];
    const wrong: string[] = [];
    for (const square of squares) (target[square] === answer[square] ? correct : wrong).push(square);
    correct.sort();
    wrong.sort();
    return {correct, wrong, score: squares.size === 0 ? 100 : Math.round((correct.length / squares.size) * 100)};
}

/** «Запомни партию»: сколько полуходов показать на уровне (6–24). */
export function recallPlies(level: number): number {
    return 4 + 2 * Math.min(10, Math.max(1, level));
}

export function pickGame<T extends { moves: string[] }>(games: T[], level: number, seed: number): T | null {
    const need = recallPlies(level);
    const fitting = games.filter((g) => g.moves.length >= need);
    return fitting.length ? fitting[Math.floor(rng(seed + 31)() * fitting.length)] : null;
}
