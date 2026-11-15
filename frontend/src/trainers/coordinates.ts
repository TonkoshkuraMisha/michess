// --- FILE: frontend/src/trainers/coordinates.ts ---
// Тренажёры координат (таск 19.2): «Найди поле», «Назови поле», «Цвет поля», «Диагонали». Вопросы — детерминированные
// по seed (тесты); настройки попытки (сторона, координаты на доске, время) кодируются в номер уровня 1–8, чтобы
// рекорды считались отдельно для каждого сочетания.

import {rng} from './vision';

export const COORD_TRAINERS = ['coord_find', 'coord_name', 'coord_color', 'coord_diagonal'] as const;
export type CoordTrainer = typeof COORD_TRAINERS[number];

export const FILES = 'abcdefgh';
export const ALL_SQUARES = Array.from({length: 64}, (_, i) => `${FILES[i % 8]}${Math.floor(i / 8) + 1}`);

export interface CoordOptions {
    side: 'white' | 'black';
    coordinates: boolean;
    seconds: 30 | 60;
}

/** Уровень 1–8 ↔ настройки: сторона, координаты, время. */
export function optionsToLevel(o: CoordOptions): number {
    return 1 + (o.side === 'black' ? 1 : 0) + (o.coordinates ? 0 : 2) + (o.seconds === 60 ? 4 : 0);
}

export function levelToOptions(level: number): CoordOptions {
    const n = Math.min(8, Math.max(1, level)) - 1;
    return {side: n & 1 ? 'black' : 'white', coordinates: !(n & 2), seconds: n & 4 ? 60 : 30};
}

/** a1 — тёмное поле. */
export function squareColor(square: string): 'light' | 'dark' {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1]) - 1;
    return (file + rank) % 2 === 0 ? 'dark' : 'light';
}

export function sameDiagonal(a: string, b: string): boolean {
    if (a === b) return false;
    const df = Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0]));
    const dr = Math.abs(Number(a[1]) - Number(b[1]));
    return df === dr;
}

export interface CoordQuestion {
    /** Поле вопроса: назвать / найти / цвет / от него диагональ. */
    square: string;
    /** Варианты ответа (для «Назови поле» и «Диагонали»), правильный — `answer`. */
    options: string[];
    answer: string;
}

function shuffle<T>(items: T[], next: () => number): T[] {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/** Вопрос номер `index` попытки с данным seed. */
export function coordQuestion(trainer: CoordTrainer, seed: number, index: number): CoordQuestion {
    const next = rng(seed * 1009 + index * 7919 + 17);
    const pick = <T, >(list: T[]) => list[Math.floor(next() * list.length)];
    const square = pick(ALL_SQUARES);
    if (trainer === 'coord_name') {
        const others = shuffle(ALL_SQUARES.filter((s) => s !== square), next).slice(0, 3);
        return {square, options: shuffle([square, ...others], next), answer: square};
    }
    if (trainer === 'coord_diagonal') {
        // Поле, у которого есть диагональные соседи (у любого поля они есть), и три поля не на его диагоналях.
        const onDiagonal = ALL_SQUARES.filter((s) => sameDiagonal(square, s));
        const answer = pick(onDiagonal);
        const wrong = shuffle(ALL_SQUARES.filter((s) => s !== square && !sameDiagonal(square, s)), next).slice(0, 3);
        return {square, options: shuffle([answer, ...wrong], next), answer};
    }
    if (trainer === 'coord_color') return {square, options: ['light', 'dark'], answer: squareColor(square)};
    return {square, options: [], answer: square};
}

/** Проверка ответа: для «Найди поле» ответ — поле, по которому нажали. */
export function isCorrect(question: CoordQuestion, reply: string): boolean {
    return reply === question.answer;
}
