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

/** Наименьшее число ходов, чтобы собрать все звёзды; null — уровень нерешаем. */
export function starsPar(level: { fen: string; hero: string; stars: string[] }): number | null {
    const index = new Map(level.stars.map((square, i) => [square, i]));
    const full = (1 << level.stars.length) - 1;
    type State = { square: string; fen: string; mask: number; depth: number };
    const queue: State[] = [{square: level.hero, fen: whiteToMove(level.fen), mask: 0, depth: 0}];
    const seen = new Set([`${level.hero}:0`]);
    for (let head = 0; head < queue.length; head++) {
        const state = queue[head];
        if (state.mask === full) return state.depth;
        // Один объект на позицию: ход — проверка — откат (поиск перебирает тысячи позиций).
        const game = new Chess(state.fen);
        for (const move of game.moves({square: state.square as Square, verbose: true})) {
            if (move.captured && !(index.has(move.to) && !(state.mask & (1 << index.get(move.to)!)))) continue;
            game.move({from: move.from, to: move.to, promotion: move.promotion ? 'q' : undefined});
            const safe = !game.isAttacked(move.to as Square, 'b');
            const fen = safe ? whiteToMove(game.fen()) : '';
            game.undo();
            if (!safe) continue;
            const mask = index.has(move.to) ? state.mask | (1 << index.get(move.to)!) : state.mask;
            const key = `${move.to}:${mask}`;
            if (seen.has(key)) continue;
            seen.add(key);
            queue.push({square: move.to, fen, mask, depth: state.depth + 1});
        }
    }
    return null;
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
