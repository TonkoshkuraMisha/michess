// --- FILE: frontend/src/content/basics/rules.ts ---
// Азбука (таск 14.5): правила уровней. Ход проверяет chess.js, как в настоящей партии, поэтому уровни не могут
// «разрешить» невозможное. Виды уровней:
// * stars — одна фигура игрока (hero) обходит звёзды; вставать под бой нельзя, бить нельзя, кроме звёзд-фигур
//   соперника (уровни про взятие). После каждого хода очередь снова у белых — соперник не отвечает.
//   Минимум ходов (par) считается поиском в ширину, в данных его нет — он всегда верен.
// * goal — один ход с целью: шах, мат, рокировка, взятие на проходе, превращение.
// * question — «что на доске?»: шах, мат, пат или ничего; ответ тоже считает chess.js.

import {Chess} from 'chess.js';
import type {Square} from 'chess.js';

export type Goal = 'check' | 'mate' | 'castle' | 'enpassant' | 'promote';
export type BoardState = 'check' | 'mate' | 'stalemate' | 'none';

export type Level =
    | { kind: 'stars'; fen: string; hero: string; stars: string[] }
    | { kind: 'goal'; fen: string; goal: Goal }
    | { kind: 'question'; fen: string };

export type SectionId = 'rook' | 'bishop' | 'queen' | 'knight' | 'kingPawn' | 'capture' | 'checkMate' | 'special';

export interface BasicsSection {
    id: SectionId;
    levels: Level[];
}

/** Позиция с ходом белых и без взятия на проходе: в уровнях «звёзд» ходит только игрок. */
export function whiteToMove(fen: string): string {
    const parts = fen.split(' ');
    parts[1] = 'w';
    parts[3] = '-';
    return parts.join(' ');
}

export type StarsVerdict =
    | { ok: true; fen: string; to: string }
    | { ok: false; reason: 'wrongPiece' | 'noCapture' | 'danger' | 'illegal' };

/** Ход фигуры игрока на уровне «звёзд»: targets — ещё не взятые звёзды (взять можно только фигуру на звезде). */
export function starsMove(fen: string, hero: string, uci: string, targets: ReadonlySet<string>): StarsVerdict {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    if (from !== hero) return {ok: false, reason: 'wrongPiece'};
    const game = new Chess(whiteToMove(fen));
    const move = game.moves({square: from as Square, verbose: true}).find((m) => m.to === to);
    if (!move) return {ok: false, reason: 'illegal'};
    if (move.captured && !targets.has(to)) return {ok: false, reason: 'noCapture'};
    game.move({from, to, promotion: move.promotion ? 'q' : undefined});
    if (game.isAttacked(to as Square, 'b')) return {ok: false, reason: 'danger'};
    return {ok: true, fen: whiteToMove(game.fen()), to};
}

// Поиск минимума — на своём лёгком генераторе ходов: фигуры соперника на уровне неподвижны, ходит только hero, поэтому
// бьющиеся поля зависят лишь от того, какие звёзды-фигуры уже взяты. Тест переигрывает найденный путь через chess.js
// (starsMove) — так минимум проверен настоящими правилами.

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const sq = (file: number, rank: number) => String.fromCharCode(97 + file) + (rank + 1);
const onBoard = (file: number, rank: number) => file >= 0 && file < 8 && rank >= 0 && rank < 8;

function placement(fen: string): Map<string, string> {
    const pieces = new Map<string, string>();
    fen.split(' ')[0].split('/').forEach((row, i) => {
        let file = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) file += Number(ch);
            else pieces.set(sq(file++, 7 - i), ch);
        }
    });
    return pieces;
}

/** Поля, куда фигура type (буква, регистр — цвет) с поля from ходит или бьёт на доске occupied. */
function reach(type: string, from: string, occupied: (square: string) => boolean): string[] {
    const file = from.charCodeAt(0) - 97;
    const rank = Number(from[1]) - 1;
    const kind = type.toLowerCase();
    const result: string[] = [];
    const steps = kind === 'n' ? KNIGHT_STEPS : kind === 'k' ? KING_STEPS : null;
    if (steps) {
        for (const [df, dr] of steps) if (onBoard(file + df, rank + dr)) result.push(sq(file + df, rank + dr));
        return result;
    }
    const dirs = kind === 'r' ? ROOK_DIRS : kind === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [df, dr] of dirs) {
        for (let f = file + df, r = rank + dr; onBoard(f, r); f += df, r += dr) {
            result.push(sq(f, r));
            if (occupied(sq(f, r))) break;
        }
    }
    return result;
}

/** Наименьшее число ходов, чтобы собрать все звёзды; null — уровень нерешаем. path — сами ходы (UCI). */
export function starsSolution(level: { fen: string; hero: string; stars: string[] }): { par: number; path: string[] } | null {
    const pieces = placement(level.fen);
    const heroStart = pieces.get(level.hero)!;
    pieces.delete(level.hero);
    const index = new Map(level.stars.map((square, i) => [square, i]));
    const full = (1 << level.stars.length) - 1;
    const present = (square: string, mask: number) =>
        pieces.has(square) && !(index.has(square) && (mask & (1 << index.get(square)!)));
    const attackedCache = new Map<number, Set<string>>();
    const attacked = (mask: number): Set<string> => {
        let set = attackedCache.get(mask);
        if (set) return set;
        set = new Set();
        for (const [square, piece] of pieces) {
            if (piece !== piece.toLowerCase() || !present(square, mask)) continue;
            if (piece === 'p') {
                const f = square.charCodeAt(0) - 97, r = Number(square[1]) - 1;
                for (const df of [-1, 1]) if (onBoard(f + df, r - 1)) set.add(sq(f + df, r - 1));
            } else {
                // Фигура игрока поле под собой не прикрывает, поэтому линии считаются без неё.
                for (const target of reach(piece, square, (s) => present(s, mask))) set.add(target);
            }
        }
        attackedCache.set(mask, set);
        return set;
    };
    type State = { square: string; type: string; mask: number; path: string[] };
    const queue: State[] = [{square: level.hero, type: heroStart, mask: 0, path: []}];
    const seen = new Set([`${level.hero}:${heroStart}:0`]);
    for (let head = 0; head < queue.length; head++) {
        const state = queue[head];
        if (state.mask === full) return {par: state.path.length, path: state.path};
        const occupied = (s: string) => present(s, state.mask);
        const free = (s: string) => !occupied(s);
        const enemy = (s: string) => occupied(s) && pieces.get(s) === pieces.get(s)!.toLowerCase();
        const targetHere = (s: string) => index.has(s) && occupied(s);
        let moves: string[];
        if (state.type === 'P') {
            const f = state.square.charCodeAt(0) - 97, r = Number(state.square[1]) - 1;
            moves = [];
            if (onBoard(f, r + 1) && free(sq(f, r + 1))) {
                moves.push(sq(f, r + 1));
                if (r === 1 && free(sq(f, r + 2))) moves.push(sq(f, r + 2));
            }
            for (const df of [-1, 1]) if (onBoard(f + df, r + 1) && enemy(sq(f + df, r + 1))) moves.push(sq(f + df, r + 1));
        } else {
            moves = reach(state.type, state.square, occupied);
        }
        for (const to of moves) {
            if (occupied(to) && !(enemy(to) && targetHere(to))) continue;
            const mask = index.has(to) ? state.mask | (1 << index.get(to)!) : state.mask;
            if (attacked(mask).has(to)) continue;
            const type = state.type === 'P' && to[1] === '8' ? 'Q' : state.type;
            const key = `${to}:${type}:${mask}`;
            if (seen.has(key)) continue;
            seen.add(key);
            queue.push({square: to, type, mask, path: [...state.path, state.square + to]});
        }
    }
    return null;
}

export function starsPar(level: { fen: string; hero: string; stars: string[] }): number | null {
    return starsSolution(level)?.par ?? null;
}

/** Оценка прохождения: 3 звезды — за минимум ходов, 2 — до двух лишних, иначе 1. */
export function rating(moves: number, par: number): 1 | 2 | 3 {
    if (moves <= par) return 3;
    return moves <= par + 2 ? 2 : 1;
}

export type GoalVerdict = { ok: true; fen: string } | { ok: false; reason: 'illegal' | 'stalemate' | 'notGoal'; fen?: string };

/** Ход на уровне с целью. */
export function goalMove(fen: string, goal: Goal, uci: string): GoalVerdict {
    const game = new Chess(fen);
    let move;
    try {
        move = game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q'});
    } catch {
        return {ok: false, reason: 'illegal'};
    }
    const reached = {
        check: game.inCheck(),
        mate: game.isCheckmate(),
        castle: move.isKingsideCastle() || move.isQueensideCastle(),
        enpassant: move.isEnPassant(),
        promote: move.isPromotion(),
    }[goal];
    if (reached) return {ok: true, fen: game.fen()};
    return {ok: false, reason: game.isStalemate() ? 'stalemate' : 'notGoal', fen: game.fen()};
}

/** Есть ли в позиции ход, достигающий цели (проверка данных уровня). */
export function goalReachable(fen: string, goal: Goal): boolean {
    return new Chess(fen).moves({verbose: true}).some((m) => goalMove(fen, goal, m.from + m.to + (m.promotion ?? '')).ok);
}

/** Что на доске для стороны, которая ходит. */
export function boardState(fen: string): BoardState {
    const game = new Chess(fen);
    if (game.isCheckmate()) return 'mate';
    if (game.isStalemate()) return 'stalemate';
    return game.inCheck() ? 'check' : 'none';
}
