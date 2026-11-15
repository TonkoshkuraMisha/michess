// --- FILE: frontend/src/trainers/blindPuzzles.ts ---
// Задачи вслепую и визуализация (таск 19.6). Источник — остановки «что бы вы сыграли?» в партиях классики (14.7): у
// каждой известен лучший ход и оценки альтернатив. Показывается позиция за N полуходов до остановки, затем доска
// скрывается, N ходов объявляются нотацией, и игрок делает ход на пустой доске (оценка — как в остановках классики).
// «Где фигура?»: после тех же N ходов указать поле названной фигуры.

import {Chess} from 'chess.js';
import type {ClassicGame, ClassicStop} from '../content/classics';
import {rng} from './vision';

export interface BlindTask {
    game: ClassicGame;
    stop: ClassicStop;
    startFen: string;
    /** Объявляемые ходы в SAN, с номерами («12. Nf3», «12… e5»). */
    moves: string[];
    finalFen: string;
    /** Сторона, которая ходит в итоговой позиции. */
    side: 'white' | 'black';
}

/** N — уровень (1–10 полуходов вслепую). */
export function blindPlies(level: number): number {
    return Math.min(10, Math.max(1, level));
}

function play(game: ClassicGame, plies: number): Chess {
    const board = new Chess();
    for (const uci of game.moves.slice(0, plies)) board.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
    return board;
}

export function blindTask(games: ClassicGame[], level: number, seed: number, round: number): BlindTask | null {
    const n = blindPlies(level);
    const stops = games.flatMap((game) => game.stops.filter((stop) => stop.ply >= n).map((stop) => ({game, stop})));
    if (stops.length === 0) return null;
    const {game, stop} = stops[Math.floor(rng(seed * 31 + round * 977 + n)() * stops.length)];
    const board = play(game, stop.ply - n);
    const startFen = board.fen();
    const moves: string[] = [];
    for (const uci of game.moves.slice(stop.ply - n, stop.ply)) {
        const number = board.moveNumber();
        const white = board.turn() === 'w';
        const made = board.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
        moves.push(`${number}${white ? '.' : '…'} ${made.san}`);
    }
    return {game, stop, startFen, moves, finalFen: board.fen(), side: board.turn() === 'w' ? 'white' : 'black'};
}

export interface WhereQuestion {
    color: 'w' | 'b';
    type: 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
    square: string;
}

/** «Где фигура?»: фигура, единственная такого вида и цвета на доске, — по возможности из тех, что ходили вслепую. */
export function whereQuestion(task: BlindTask, seed: number): WhereQuestion {
    const board = new Chess(task.finalFen);
    const placed: WhereQuestion[] = [];
    board.board().forEach((row) => row.forEach((cell) => {
        if (cell) placed.push({color: cell.color, type: cell.type, square: cell.square});
    }));
    const unique = placed.filter((p) => placed.filter((o) => o.color === p.color && o.type === p.type).length === 1);
    const replay = new Chess(task.startFen);
    const moved = new Set<string>();
    for (const san of task.moves) moved.add(replay.move(san.split(' ').pop()!).to);
    const preferred = unique.filter((p) => moved.has(p.square) && p.type !== 'k');
    const pool = preferred.length ? preferred : unique;   // короли уникальны всегда — вопрос найдётся
    return pool[Math.floor(rng(seed + 7)() * pool.length)];
}
