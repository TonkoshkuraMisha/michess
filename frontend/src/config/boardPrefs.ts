// --- FILE: frontend/src/config/boardPrefs.ts ---
// Настройки доски (таск 18.4): как показывать ход соперника, как ходить, «быстрый ход», анимация хода соперника и
// порядок взятых фигур. Хранятся в браузере; компоненты подписываются на изменения.

import {useSyncExternalStore} from 'react';

export interface BoardPrefs {
    /** Ход соперника: подсветка полей, стрелка или и то и другое. */
    lastMove: 'highlight' | 'arrow' | 'both';
    /** Ввод хода: перетаскивание и щелчки, или только два щелчка (удобно на тачпаде и телефоне). */
    moveInput: 'both' | 'click';
    /** «Быстрый ход»: щелчок по полю, куда может пойти только одна ваша фигура, сразу делает ход. */
    quickMove: boolean;
    /** Анимация хода соперника. */
    animateOpponent: boolean;
    /** Взятые фигуры: по ценности, по видам (от пешек) или по порядку взятия. */
    captured: 'value' | 'kind' | 'order';
}

export const DEFAULT_BOARD_PREFS: BoardPrefs = {lastMove: 'highlight', moveInput: 'both', quickMove: false, animateOpponent: true, captured: 'value'};

const KEY = 'regence_board_prefs';
const ALLOWED: { [K in keyof BoardPrefs]: readonly BoardPrefs[K][] } = {
    lastMove: ['highlight', 'arrow', 'both'],
    moveInput: ['both', 'click'],
    quickMove: [true, false],
    animateOpponent: [true, false],
    captured: ['value', 'kind', 'order'],
};

function read(): BoardPrefs {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof BoardPrefs, unknown>>;
        const prefs = {...DEFAULT_BOARD_PREFS};
        for (const key of Object.keys(ALLOWED) as (keyof BoardPrefs)[]) {
            if ((ALLOWED[key] as readonly unknown[]).includes(saved[key])) (prefs as Record<string, unknown>)[key] = saved[key];
        }
        return prefs;
    } catch {
        return {...DEFAULT_BOARD_PREFS};
    }
}

let current: BoardPrefs = read();
const listeners = new Set<() => void>();

export function getBoardPrefs(): BoardPrefs {
    return current;
}

export function setBoardPref<K extends keyof BoardPrefs>(key: K, value: BoardPrefs[K]): void {
    current = {...current, [key]: value};
    try {
        localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
        // Хранилище недоступно — настройка действует до перезагрузки.
    }
    listeners.forEach((listener) => listener());
}

/** Перечитать из хранилища (тесты, другая вкладка). */
export function reloadBoardPrefs(): void {
    current = read();
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useBoardPrefs(): BoardPrefs {
    return useSyncExternalStore(subscribe, getBoardPrefs, getBoardPrefs);
}

const GLYPHS: Record<string, string> = {q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'};
const VALUE_ORDER = ['q', 'r', 'b', 'n', 'p'];
const KIND_ORDER = ['p', 'n', 'b', 'r', 'q'];

/**
 * Взятые фигуры каждой стороной в нужном порядке. `byValue` — уже посчитанные по материалу символы (как раньше);
 * для порядка взятия нужна история ходов партии (chess.js, verbose).
 */
export function orderCaptured(mode: BoardPrefs['captured'], byValue: { white: string[]; black: string[] },
                              history: { color: string; captured?: string }[]): { white: string[]; black: string[] } {
    if (mode === 'value') return byValue;
    if (mode === 'kind') {
        const sort = (list: string[]) => [...list].sort((a, b) => KIND_ORDER.indexOf(glyphType(a)) - KIND_ORDER.indexOf(glyphType(b)));
        return {white: sort(byValue.white), black: sort(byValue.black)};
    }
    const white: string[] = [];
    const black: string[] = [];
    for (const move of history) {
        if (!move.captured || !GLYPHS[move.captured]) continue;
        (move.color === 'w' ? white : black).push(GLYPHS[move.captured]);
    }
    return {white, black};
}

function glyphType(glyph: string): string {
    return VALUE_ORDER.find((type) => GLYPHS[type] === glyph) ?? 'p';
}

/** «Быстрый ход»: единственный ход своей фигуры на поле `to`; иначе null (нет ходов или выбор неоднозначен). */
export function quickMoveFrom(moves: { from: string; to: string; promotion?: string }[], to: string): string | null {
    const sources = new Set(moves.filter((m) => m.to === to).map((m) => m.from));
    return sources.size === 1 ? [...sources][0] : null;
}
