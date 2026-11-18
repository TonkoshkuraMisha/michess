// --- FILE: frontend/src/config/blindfold.ts ---
// Игра вслепую (таск 19.5). Ступени: 1 — видны только свои фигуры; 2 — фигура исчезает через FADE_PLIES полуходов
// после своего последнего хода; 3 — видны только пешки; 4 — полностью вслепую. «Подсмотреть» показывает всё на
// PEEK_MS (подсмотры считаются в итогах). Только нерейтинговые партии.

import {useSyncExternalStore} from 'react';

export type BlindfoldLevel = 0 | 1 | 2 | 3 | 4;
export const BLINDFOLD_LEVELS: BlindfoldLevel[] = [1, 2, 3, 4];
export const FADE_PLIES = 4;
export const PEEK_MS = 3000;

interface BoardPiece {
    type: string;
    color: 'w' | 'b';
}

/** Поля, фигуры на которых видны на данной ступени. `history` — ходы партии (verbose), `board` — chess.js board(). */
export function visibleSquares(level: BlindfoldLevel, board: (BoardPiece | null)[][], history: { to: string }[], myColor: 'w' | 'b'): Set<string> {
    const visible = new Set<string>();
    const recent = new Set(history.slice(-FADE_PLIES).map((m) => m.to));
    board.forEach((row, r) => row.forEach((piece, f) => {
        if (!piece) return;
        const square = `${'abcdefgh'[f]}${8 - r}`;
        const show = level === 0 || (level === 1 && piece.color === myColor) || (level === 2 && recent.has(square))
            || (level === 3 && piece.type === 'p');
        if (show) visible.add(square);
    }));
    return visible;
}

export interface BlindfoldState {
    /** Ступень, выбранная для следующей партии (0 — обычная игра). */
    armed: BlindfoldLevel;
    /** Ступень текущей партии (0 — партия обычная). */
    level: BlindfoldLevel;
    peeks: number;
    peekUntil: number;
    hideMoves: boolean;
}

const KEY = 'regence_blindfold_level';

function readArmed(): BlindfoldLevel {
    try {
        const saved = Number(localStorage.getItem(KEY));
        return ([0, 1, 2, 3, 4] as number[]).includes(saved) ? saved as BlindfoldLevel : 0;
    } catch {
        return 0;
    }
}

let state: BlindfoldState = {armed: readArmed(), level: 0, peeks: 0, peekUntil: 0, hideMoves: false};
const listeners = new Set<() => void>();

function update(patch: Partial<BlindfoldState>): void {
    state = {...state, ...patch};
    listeners.forEach((listener) => listener());
}

export function getBlindfold(): BlindfoldState {
    return state;
}

export function armBlindfold(level: BlindfoldLevel): void {
    try {
        localStorage.setItem(KEY, String(level));
    } catch {
        // без хранилища выбор действует до перезагрузки
    }
    update({armed: level});
}

/** Новая партия: вслепую, если выбрана ступень и партия может быть вслепую (без рейтинга). */
export function startBlindfold(allowed: boolean): void {
    update({level: allowed ? state.armed : 0, peeks: 0, peekUntil: 0, hideMoves: false});
}

export function stopBlindfold(): void {
    update({level: 0, peeks: 0, peekUntil: 0, hideMoves: false});
}

export function peek(now = Date.now()): void {
    if (state.level === 0 || state.peekUntil > now) return;
    update({peeks: state.peeks + 1, peekUntil: now + PEEK_MS});
    setTimeout(() => update({}), PEEK_MS + 20);
}

export function setHideMoves(hide: boolean): void {
    update({hideMoves: hide});
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useBlindfold(): BlindfoldState {
    return useSyncExternalStore(subscribe, getBlindfold, getBlindfold);
}

/** Ход нотацией (SAN или «e2e4»): from/to/promotion по текущей позиции; null — нелегальный ход. */
export function parseMoveInput(moves: { san: string; from: string; to: string; promotion?: string }[], input: string):
    { from: string; to: string; promotion?: string } | null {
    const text = input.trim().replace(/[+#!?]+$/, '').replace(/0/g, 'O');
    if (!text) return null;
    const uci = /^([a-h][1-8])-?([a-h][1-8])([qrbn])?$/i.exec(text);
    const found = uci
        ? moves.find((m) => m.from === uci[1].toLowerCase() && m.to === uci[2].toLowerCase()
            && (m.promotion ?? '') === (uci[3]?.toLowerCase() ?? (m.promotion ? 'q' : '')))
        : moves.find((m) => m.san.replace(/[+#]$/, '') === text) ?? moves.find((m) => m.san.replace(/[+#]$/, '').toLowerCase() === text.toLowerCase());
    return found ? {from: found.from, to: found.to, promotion: found.promotion} : null;
}
