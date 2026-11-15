// --- FILE: frontend/src/trainers/tail.ts ---
// «Хвост» (таск 16.5): своя фигура (голова) собирает чёрные пешки; за каждой съеденной вырастает хвост из её копий,
// который тянется по пройденным полям. Вставать на свой хвост нельзя, дальнобойные фигуры сквозь хвост не ходят.
// Каждые SPAWN_EVERY ходов появляется фигура соперника (не нападающая на голову в момент появления): если она бьёт
// голову — игра окончена, если бьёт поле хвоста — откусывает хвост с этого места. Вставать под бой нельзя (ход не
// принимается). Всё — чистые функции с генератором по seed, без chess.js: на доске нет королей.

import {rng} from './vision';

export type HeroPiece = 'N' | 'B' | 'R' | 'Q';
export type EnemyPiece = 'n' | 'b' | 'r';

export interface TailState {
    hero: HeroPiece;
    head: string;
    /** Хвост: от поля сразу за головой к кончику. */
    tail: string[];
    food: string;
    enemies: Record<string, EnemyPiece>;
    eaten: number;
    moves: number;
    over: boolean;
    seed: number;
    level: number;
}

const FILES = 'abcdefgh';
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const xy = (square: string): [number, number] => [FILES.indexOf(square[0]), Number(square[1]) - 1];
const name = (x: number, y: number) => `${FILES[x]}${y + 1}`;
const inside = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8;

export function heroFor(level: number): HeroPiece {
    return level <= 3 ? 'N' : level <= 5 ? 'B' : level <= 7 ? 'R' : 'Q';
}

export function spawnEvery(level: number): number {
    return Math.max(2, 7 - Math.floor(level / 2));
}

export function maxEnemies(level: number): number {
    return Math.min(2 + Math.floor(level / 2), 6);
}

function occupied(state: TailState): Set<string> {
    return new Set([state.head, ...state.tail, ...Object.keys(state.enemies)]);
}

/** Поля, куда бьёт (или ходит) фигура piece с поля from; blockers — что останавливает дальнобойную фигуру. */
function reach(piece: string, from: string, blockers: Set<string>): string[] {
    const [x, y] = xy(from);
    const kind = piece.toLowerCase();
    if (kind === 'n') return KNIGHT.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => inside(a, b)).map(([a, b]) => name(a, b));
    const dirs = kind === 'r' ? ROOK : kind === 'b' ? BISHOP : [...ROOK, ...BISHOP];
    const result: string[] = [];
    for (const [dx, dy] of dirs) {
        for (let a = x + dx, b = y + dy; inside(a, b); a += dx, b += dy) {
            result.push(name(a, b));
            if (blockers.has(name(a, b))) break;
        }
    }
    return result;
}

/** Поля, которые бьют фигуры соперника (голова, хвост и пешка-еда их останавливают). */
export function attacked(state: TailState): Set<string> {
    const blockers = new Set([...occupied(state), state.food]);
    const result = new Set<string>();
    for (const [square, piece] of Object.entries(state.enemies)) {
        for (const target of reach(piece, square, blockers)) result.add(target);
    }
    return result;
}

/** Ходы головы: не на хвост и не на фигуры соперника, не под бой. */
export function legalMoves(state: TailState): string[] {
    if (state.over) return [];
    const blockers = new Set([...state.tail, ...Object.keys(state.enemies), state.food]);
    const danger = attacked(state);
    return reach(state.hero, state.head, blockers)
        .filter((to) => !state.tail.includes(to) && !state.enemies[to] && !danger.has(to));
}

function freeSquare(state: TailState, random: () => number, avoid: Set<string> = new Set()): string | null {
    const taken = new Set([...occupied(state), state.food, ...avoid]);
    const free = Array.from({length: 64}, (_, i) => name(i % 8, Math.floor(i / 8))).filter((s) => !taken.has(s));
    return free.length ? free[Math.floor(random() * free.length)] : null;
}

export function newGame(level: number, seed: number): TailState {
    const random = rng(seed * 31 + level);
    const state: TailState = {hero: heroFor(level), head: 'e4', tail: [], food: '', enemies: {}, eaten: 0, moves: 0,
        over: false, seed, level};
    state.head = name(Math.floor(random() * 8), Math.floor(random() * 8));
    state.food = freeSquare(state, random)!;
    return state;
}

/** Ход головы на поле to; null — ход невозможен (состояние не меняется). */
export function step(state: TailState, to: string): TailState | null {
    if (!legalMoves(state).includes(to)) return null;
    const random = rng(state.seed * 131 + state.moves * 7 + state.level);
    const ate = to === state.food;
    const length = state.tail.length + (ate ? 1 : 0);
    const next: TailState = {
        ...state, head: to, tail: [state.head, ...state.tail].slice(0, length), enemies: {...state.enemies},
        eaten: state.eaten + (ate ? 1 : 0), moves: state.moves + 1,
    };
    if (ate) next.food = freeSquare(next, random) ?? '';
    if (next.moves % spawnEvery(state.level) === 0) spawn(next, random);
    bite(next);
    if (!next.food || legalMoves(next).length === 0) next.over = true;
    return next;
}

function spawn(state: TailState, random: () => number): void {
    const keys = Object.keys(state.enemies);
    if (keys.length >= maxEnemies(state.level)) delete state.enemies[keys[0]];
    const types: EnemyPiece[] = state.level <= 2 ? ['n'] : state.level <= 5 ? ['n', 'b'] : ['n', 'b', 'r'];
    for (let attempt = 0; attempt < 40; attempt++) {
        const square = freeSquare(state, random);
        if (!square) return;
        const piece = types[Math.floor(random() * types.length)];
        const blockers = new Set([...occupied(state), state.food]);
        // Появившаяся фигура не нападает на голову: поражение — только из-за собственного хода игрока.
        if (reach(piece, square, blockers).includes(state.head)) continue;
        state.enemies[square] = piece;
        return;
    }
}

/** Фигуры соперника откусывают хвост с ближайшего к голове побитого поля. */
function bite(state: TailState): void {
    const danger = attacked(state);
    const cut = state.tail.findIndex((square) => danger.has(square));
    if (cut >= 0) state.tail = state.tail.slice(0, cut);
}

/** Позиция для показа на доске: голова и хвост — фигуры игрока, еда — пешка, соперники — чёрные фигуры. */
export function boardFen(state: TailState): string {
    const pieces: Record<string, string> = {[state.head]: state.hero, ...state.enemies};
    for (const square of state.tail) pieces[square] = state.hero;
    if (state.food) pieces[state.food] = 'p';
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
