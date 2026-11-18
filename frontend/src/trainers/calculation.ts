// --- FILE: frontend/src/trainers/calculation.ts ---
// Счёт и внимание (таск 19.7): шахи и взятия за обе стороны, исход размена (SEE — перебор взятий наименее ценной
// фигурой, с рентгеном), число ходов коня и короля до поля, правило квадрата, оценка позиции по оценкам классики.
// Вопросы — детерминированные по seed; позиции — из партий классики (естественные).

import {Chess} from 'chess.js';
import type {Square} from 'chess.js';
import {rng} from './vision';

export const VALUES: Record<string, number> = {p: 100, n: 300, b: 300, r: 500, q: 900, k: 20000};

/** Все ходы стороны (даже если сейчас ход соперника): позиция с переданной очередью. */
function sideMoves(fen: string, color: 'w' | 'b') {
    const parts = fen.split(' ');
    parts[1] = color;
    parts[3] = '-';
    try {
        return new Chess(parts.join(' ')).moves({verbose: true});
    } catch {
        return [];   // сторона, которая не ходит, под шахом — ход за неё невозможен
    }
}

/** Все шахи и взятия обеих сторон (UCI без превращения). */
export function checksAndCaptures(fen: string): Set<string> {
    const result = new Set<string>();
    for (const color of ['w', 'b'] as const) {
        for (const move of sideMoves(fen, color)) {
            if (move.captured || move.san.includes('+') || move.san.includes('#')) result.add(`${move.from}${move.to}`);
        }
    }
    return result;
}

/** Позиция для «Шахов и взятий»: случайная (по seed) из пула, где шахов и взятий от 2 до 8. */
export function checksPosition(pool: string[], seed: number): string | null {
    const next = rng(seed);
    for (let attempt = 0; attempt < 300 && pool.length; attempt++) {
        const fen = pool[Math.floor(next() * pool.length)];
        const n = checksAndCaptures(fen).size;
        if (n >= 2 && n <= 8) return fen;
    }
    return null;
}

/** Выигрыш стороны, которая ходит, от серии взятий на поле `square` (0 — брать не обязательно). */
function swap(board: Chess, square: Square): number {
    const target = board.get(square);
    if (!target) return 0;
    const captures = board.moves({verbose: true}).filter((m) => m.to === square && m.captured)
        .sort((a, b) => VALUES[a.piece] - VALUES[b.piece]);
    if (captures.length === 0) return 0;
    const first = captures[0];
    board.move({from: first.from, to: first.to, promotion: 'q'});
    const value = VALUES[target.type] - swap(board, square);
    board.undo();
    return Math.max(0, value);
}

/** Итог взятия на поле наименее ценной фигурой (сама первая жертва обязательна, дальше — по желанию). */
export function captureGain(fen: string, square: string): number {
    const board = new Chess(fen);
    const target = board.get(square as Square);
    const captures = board.moves({verbose: true}).filter((m) => m.to === square && m.captured)
        .sort((a, b) => VALUES[a.piece] - VALUES[b.piece]);
    if (!target || captures.length === 0) return 0;
    board.move({from: captures[0].from, to: captures[0].to, promotion: 'q'});
    return VALUES[target.type] - swap(board, square as Square);
}

export type ExchangeAnswer = 'win' | 'equal' | 'lose';

export function exchangeVerdict(gain: number): ExchangeAnswer {
    return gain > 50 ? 'win' : gain < -50 ? 'lose' : 'equal';
}

export interface ExchangeQuestion {
    fen: string;
    square: string;
    answer: ExchangeAnswer;
}

/** Вопрос о размене: позиция, где у стороны, которая ходит, есть взятие (не короля, не пешкой пешки — скучно). */
export function exchangeQuestion(pool: string[], seed: number): ExchangeQuestion | null {
    const next = rng(seed);
    for (let attempt = 0; attempt < 200; attempt++) {
        const fen = pool[Math.floor(next() * pool.length)];
        const board = new Chess(fen);
        const targets = [...new Set(board.moves({verbose: true}).filter((m) => m.captured && !(m.piece === 'p' && m.captured === 'p'))
            .map((m) => m.to))];
        if (targets.length === 0) continue;
        const square = targets[Math.floor(next() * targets.length)];
        return {fen, square, answer: exchangeVerdict(captureGain(fen, square))};
    }
    return null;
}

// ---- Расстояния ----

const FILES = 'abcdefgh';
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

export function knightDistance(from: string, to: string): number {
    const start = [FILES.indexOf(from[0]), Number(from[1]) - 1];
    const goal = `${FILES.indexOf(to[0])},${Number(to[1]) - 1}`;
    const seen = new Set([start.join(',')]);
    let frontier = [start];
    for (let d = 0; d < 8; d++) {
        if (frontier.some((c) => c.join(',') === goal)) return d;
        const nextFrontier: number[][] = [];
        for (const [x, y] of frontier) {
            for (const [dx, dy] of KNIGHT) {
                const c = [x + dx, y + dy];
                if (c[0] < 0 || c[1] < 0 || c[0] > 7 || c[1] > 7 || seen.has(c.join(','))) continue;
                seen.add(c.join(','));
                nextFrontier.push(c);
            }
        }
        frontier = nextFrontier;
    }
    return -1;
}

export function kingDistance(from: string, to: string): number {
    return Math.max(Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])), Math.abs(Number(from[1]) - Number(to[1])));
}

export interface DistanceQuestion {
    piece: 'n' | 'k';
    from: string;
    to: string;
    answer: number;
}

export function distanceQuestion(seed: number, index: number): DistanceQuestion {
    const next = rng(seed * 131 + index * 17 + 5);
    const square = () => `${FILES[Math.floor(next() * 8)]}${Math.floor(next() * 8) + 1}`;
    const piece = next() < 0.6 ? 'n' : 'k';
    let from = square();
    let to = square();
    while (to === from) to = square();
    if (piece === 'n') return {piece, from, to, answer: knightDistance(from, to)};
    from = square();
    return {piece, from, to, answer: kingDistance(from, to)};
}

// ---- Правило квадрата ----

export interface SquareQuestion {
    /** Белая пешка без поддержки против чёрного короля; кто ходит. */
    pawn: string;
    king: string;
    toMove: 'w' | 'b';
    answer: boolean;
}

/**
 * Успевает ли король догнать пешку (правило квадрата; король своего цвета и другие фигуры не мешают). Король ловит
 * пешку, если успевает взять её не позже, чем на поле превращения: пешке нужно pawnMoves ходов (со второй
 * горизонтали — на один меньше, через двойной шаг), а королю — дойти до поля превращения и побить там нового ферзя.
 * При ходе белых у чёрных за это время pawnMoves ходов (последний — взятие), при ходе чёрных — на один больше.
 * Пример: пешка f6, король d6, ход белых — 1.f7 Ke7 2.f8=Ф+ Kxf8: догоняет (до 18.11.2026 правило было на ход строже
 * и здесь отвечало «не успеет»).
 */
export function kingCatchesPawn(pawn: string, king: string, toMove: 'w' | 'b'): boolean {
    const rank = Number(pawn[1]);
    const pawnMoves = 8 - rank - (rank === 2 ? 1 : 0);
    const promotion = `${pawn[0]}8`;
    const kingMoves = kingDistance(king, promotion);
    return kingMoves <= pawnMoves + (toMove === 'b' ? 1 : 0);
}

export function squareQuestion(seed: number, index: number): SquareQuestion {
    const next = rng(seed * 733 + index * 29 + 11);
    const file = () => FILES[Math.floor(next() * 8)];
    const pawn = `${file()}${2 + Math.floor(next() * 5)}`;
    let king = `${file()}${4 + Math.floor(next() * 5)}`;
    while (king === pawn || kingDistance(king, pawn) <= 1) king = `${file()}${4 + Math.floor(next() * 5)}`;
    const toMove = next() < 0.5 ? 'w' : 'b';
    return {pawn, king, toMove, answer: kingCatchesPawn(pawn, king, toMove)};
}

export function squareFen(q: SquareQuestion): string {
    // Белый король — в углу, далеко от пешки и чёрного короля (не мешает и не под шахом).
    const placement: Record<string, string> = {[q.pawn]: 'P', [q.king]: 'k'};
    const whiteKing = ['a1', 'h1', 'a3', 'h3'].find((s) => !placement[s] && kingDistance(s, q.king) > 1 && kingDistance(s, q.pawn) > 0) ?? 'a1';
    placement[whiteKing] = 'K';
    const rows: string[] = [];
    for (let rank = 8; rank >= 1; rank--) {
        let row = '';
        let empty = 0;
        for (const f of FILES) {
            const piece = placement[`${f}${rank}`];
            if (piece) {
                row += (empty || '') + piece;
                empty = 0;
            } else {
                empty++;
            }
        }
        rows.push(row + (empty || ''));
    }
    return `${rows.join('/')} ${q.toMove} - - 0 1`;
}

// ---- Оценка позиции ----

export type EvalAnswer = 'white' | 'equal' | 'black';

/** Однозначная оценка: перевес от 1,5 пешки, равенство — в пределах 0,6; между — вопрос не задаётся. */
export function evalVerdict(cp: number): EvalAnswer | null {
    if (cp >= 150) return 'white';
    if (cp <= -150) return 'black';
    if (Math.abs(cp) <= 60) return 'equal';
    return null;
}

export interface EvalQuestion {
    fen: string;
    cp: number;
    answer: EvalAnswer;
}

/** «Сравни два хода» (27.9): ход мастера на остановке классики против другой линии движка, слабее ≥ 1 пешки. */
export interface CompareQuestion {
    fen: string;
    best: string;
    other: string;
    bestCp: number;
    otherCp: number;
    /** Порядок вариантов на экране (UCI). */
    options: [string, string];
}

export function compareQuestion(
    games: { moves: string[]; stops: { ply: number; move: string; lines: [string, number][] }[] }[], seed: number,
): CompareQuestion | null {
    const next = rng(seed);
    for (let attempt = 0; attempt < 300; attempt++) {
        const game = games[Math.floor(next() * games.length)];
        const stop = game?.stops[Math.floor(next() * (game?.stops.length ?? 0))];
        if (!stop || stop.lines.length < 2) continue;
        const [best, bestCp] = stop.lines[0];
        const others = stop.lines.slice(1).filter(([, cp]) => bestCp - cp >= 100);
        if (best !== stop.move || others.length === 0) continue;
        const [other, otherCp] = others[Math.floor(next() * others.length)];
        const board = new Chess();
        for (const uci of game.moves.slice(0, stop.ply)) board.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
        const options: [string, string] = next() < 0.5 ? [best, other] : [other, best];
        return {fen: board.fen(), best, other, bestCp, otherCp, options};
    }
    return null;
}

/** SAN хода UCI в позиции FEN. */
export function sanOf(fen: string, uci: string): string {
    return new Chess(fen).move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]}).san;
}

export function evalQuestion(games: { moves: string[]; evals: number[] }[], seed: number): EvalQuestion | null {
    const next = rng(seed);
    for (let attempt = 0; attempt < 300; attempt++) {
        const game = games[Math.floor(next() * games.length)];
        if (!game || game.moves.length < 12) continue;
        const ply = 10 + Math.floor(next() * (game.moves.length - 10));
        const answer = evalVerdict(game.evals[ply - 1]);
        if (!answer) continue;
        const board = new Chess();
        for (const uci of game.moves.slice(0, ply)) board.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
        return {fen: board.fen(), cp: game.evals[ply - 1], answer};
    }
    return null;
}
