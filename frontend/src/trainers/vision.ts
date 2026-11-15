// --- FILE: frontend/src/trainers/vision.ts ---
// Тренажёры видения доски (таск 16.5), генераторы уровней. Детерминированы по seed; каждый уровень решаем — это
// проверяет поиск (starsSolution из азбуки) или перебор, а не надежда на случай.
//
// * «Тихая тропа» — провести фигуру к цели, не вставая под бой: чем выше уровень, тем больше сторожей и фигуры другие.
// * «Маршрут коня» — то же для коня, но засчитывается только кратчайший путь.
// * «Двойной удар» — за минуту находить поле, с которого конь бьёт сразу две ценные фигуры (с 4-го уровня — поле должно
//   быть безопасным).

import {Chess} from 'chess.js';
import type {Square} from 'chess.js';
import {starsMove, starsSolution} from '../content/basics/rules';

export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const FILES = 'abcdefgh';
const squareName = (i: number) => `${FILES[i % 8]}${Math.floor(i / 8) + 1}`;
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

function fenOf(pieces: Record<string, string>): string {
    const rows: string[] = [];
    for (let rank = 8; rank >= 1; rank--) {
        let row = '';
        let empty = 0;
        for (let f = 0; f < 8; f++) {
            const piece = pieces[`${FILES[f]}${rank}`];
            if (piece) {
                row += (empty || '') + piece;
                empty = 0;
            } else empty++;
        }
        rows.push(row + (empty || ''));
    }
    return `${rows.join('/')} w - - 0 1`;
}

function free(pieces: Record<string, string>, random: () => number): string {
    for (;;) {
        const square = squareName(Math.floor(random() * 64));
        if (!pieces[square]) return square;
    }
}

/** Позиция корректна для chess.js и ни один король не под шахом (ход белых, чёрные не под шахом). */
function legal(fen: string): boolean {
    try {
        const game = new Chess(fen);
        if (game.inCheck()) return false;
        return !new Chess(fen.replace(' w ', ' b '), {skipValidation: true}).inCheck();
    } catch {
        return false;
    }
}

/** Кратчайший путь проходит по настоящим правилам (связки и шах своему королю учитывает chess.js). */
function replays(fen: string, hero: string, target: string, path: string[]): boolean {
    let position = fen;
    let square = hero;
    for (const uci of path) {
        const verdict = starsMove(position, square, uci, new Set([target]));
        if (!verdict.ok) return false;
        position = verdict.fen;
        square = verdict.to;
    }
    return square === target;
}

export interface PathLevel {
    fen: string;
    hero: string;
    target: string;
    par: number;
}

function heroFor(kind: 'quiet' | 'knight', level: number, random: () => number): string {
    if (kind === 'knight') return 'N';
    const pool = level <= 3 ? ['R'] : level <= 6 ? ['R', 'B'] : level <= 9 ? ['R', 'B', 'Q', 'K'] : ['R', 'B', 'Q', 'K', 'N'];
    return pool[Math.floor(random() * pool.length)];
}

const GUARDS = ['p', 'n', 'b', 'r', 'q'];

/** Уровень «Тихой тропы» или «Маршрута коня». */
export function pathLevel(kind: 'quiet' | 'knight', level: number, seed: number): PathLevel {
    const random = rng(seed * 1009 + level);
    const guards = Math.min(1 + Math.floor(level / 2), 7);
    const minPar = kind === 'knight' ? 3 : 2;
    for (let attempt = 0; attempt < 500; attempt++) {
        const pieces: Record<string, string> = {};
        const heroPiece = heroFor(kind, level, random);
        pieces[free(pieces, random)] = 'K';
        pieces[free(pieces, random)] = 'k';
        const hero = free(pieces, random);
        pieces[hero] = heroPiece;
        for (let i = 0; i < guards; i++) {
            const square = free(pieces, random);
            const guard = GUARDS[Math.floor(random() * Math.min(GUARDS.length, 2 + Math.floor(level / 3)))];
            if (guard === 'p' && (square[1] === '1' || square[1] === '8')) continue;
            pieces[square] = guard;
        }
        const target = free(pieces, random);
        const fen = fenOf(pieces);
        if (!legal(fen)) continue;
        const solution = starsSolution({fen, hero, stars: [target]});
        if (!solution || solution.par < minPar || solution.par > minPar + 2 + Math.floor(level / 3)) continue;
        if (!replays(fen, hero, target, solution.path)) continue;
        return {fen, hero, target, par: solution.par};
    }
    throw new Error(`no ${kind} level ${level} for seed ${seed}`);
}

export interface ForkLevel {
    fen: string;
    knight: string;
    /** Поля вилки (ход коня отсюда бьёт две ценные фигуры; на уровнях с 4-го — только безопасные). */
    answers: string[];
    safeOnly: boolean;
}

const VALUABLE = new Set(['k', 'q', 'r', 'b', 'n']);

export function knightTargets(square: string): string[] {
    const f = FILES.indexOf(square[0]);
    const r = Number(square[1]) - 1;
    return KNIGHT.map(([df, dr]) => [f + df, r + dr]).filter(([x, y]) => x >= 0 && x < 8 && y >= 0 && y < 8)
        .map(([x, y]) => `${FILES[x]}${y + 1}`);
}

/** Сколько ценных фигур чёрных бьёт конь с поля square. */
export function forkCount(fen: string, square: string): number {
    const game = new Chess(fen, {skipValidation: true});
    return knightTargets(square).filter((s) => {
        const piece = game.get(s as Square);
        return piece && piece.color === 'b' && VALUABLE.has(piece.type);
    }).length;
}

export function isSafe(fen: string, square: string): boolean {
    return !new Chess(fen, {skipValidation: true}).isAttacked(square as Square, 'b');
}

/** Уровень «Двойного удара»: белый конь, ходом которого можно поставить вилку. */
export function forkLevel(level: number, seed: number): ForkLevel {
    const random = rng(seed * 7919 + level);
    const safeOnly = level >= 4;
    const extra = Math.min(level, 6);
    for (let attempt = 0; attempt < 500; attempt++) {
        const pieces: Record<string, string> = {};
        pieces[free(pieces, random)] = 'K';
        pieces[free(pieces, random)] = 'k';
        const knight = free(pieces, random);
        pieces[knight] = 'N';
        for (let i = 0; i < 1 + extra; i++) {
            const square = free(pieces, random);
            const piece = ['q', 'r', 'b', 'n', 'p', 'p'][Math.floor(random() * 6)];
            if (piece === 'p' && (square[1] === '1' || square[1] === '8')) continue;
            pieces[square] = piece;
        }
        const fen = fenOf(pieces);
        if (!legal(fen)) continue;
        const game = new Chess(fen);
        const moves = game.moves({square: knight as Square, verbose: true}).map((m) => m.to as string);
        const answers = moves.filter((to) => {
            if (forkCount(fen, to) < 2) return false;
            return !safeOnly || isSafe(fen, to);
        });
        if (answers.length === 0 || answers.length > 2) continue;
        return {fen, knight, answers, safeOnly};
    }
    throw new Error(`no fork level ${level} for seed ${seed}`);
}

/** Очки за путь: кратчайший — 100, каждый лишний ход — минус 25. */
export function pathScore(moves: number, par: number): number {
    return Math.max(0, 100 - 25 * Math.max(0, moves - par));
}
