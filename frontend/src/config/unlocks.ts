// --- FILE: frontend/src/config/unlocks.ts ---
// Открываемое оформление (таск 18.4): часть досок и наборов фигур открывается за достижения (17.6). Закрытое видно
// заранее — с замком и условием; выбрать его нельзя, пока достижение не получено. Уже выбранное раньше не отбирается.

import {useSyncExternalStore} from 'react';
import {API_BASE_URL} from './api';
import {t} from '../i18n';
import type {MessageKey} from '../i18n';

export type UnlockKind = 'board' | 'pieces';

/** Что за какое достижение открывается (коды — src/services/achievements.py). */
export const UNLOCKS: Record<UnlockKind, Record<string, string>> = {
    board: {marble: 'wins_10', malachite: 'puzzles_100', ebony: 'rating_1500', neon: 'arena_10', stained: 'tournament_podium'},
    pieces: {lewis: 'tournament_win', firi: 'lessons_10'},
};

let earned = new Set<string>();
const listeners = new Set<() => void>();
let snapshot = earned;

function publish(next: Set<string>): void {
    earned = next;
    snapshot = next;
    listeners.forEach((listener) => listener());
}

/** Загрузить полученные достижения игрока (вызывается при входе); гость — пустой набор. */
export async function loadUnlocks(username: string | null): Promise<void> {
    if (!username) {
        publish(new Set());
        return;
    }
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/profile/${encodeURIComponent(username)}/achievements`);
        if (!res.ok) return;
        const data = await res.json() as { achievements?: { code: string; earned_at: string | null }[] };
        publish(new Set((data.achievements ?? []).filter((a) => a.earned_at).map((a) => a.code)));
    } catch {
        // Нет связи — оформление остаётся как было (закрытое закрыто).
    }
}

export function setEarnedForTests(codes: string[]): void {
    publish(new Set(codes));
}

/** Код достижения, которое открывает предмет, если оно ещё не получено; иначе null. */
export function lockOf(kind: UnlockKind, id: string, have: Set<string> = earned): string | null {
    const code = UNLOCKS[kind][id];
    return code && !have.has(code) ? code : null;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Хук: функция проверки замка, обновляется, когда достижения загрузились. */
export function useUnlocks(): (kind: UnlockKind, id: string) => string | null {
    const have = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
    return (kind, id) => lockOf(kind, id, have);
}

/** «Откроется за достижение «…»» — подпись закрытого предмета. */
export function unlockText(code: string): string {
    return t('settings.unlockBy', {name: t(`achievements.items.${code}.name` as MessageKey)});
}
