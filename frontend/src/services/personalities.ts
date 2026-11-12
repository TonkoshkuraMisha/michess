// --- FILE: frontend/src/services/personalities.ts ---

/**
 * Мастерская соперников: персоналии, собранные игроком (таск 10.2).
 *
 * Один источник правды за раз: у гостя — localStorage этого браузера, у вошедшего игрока —
 * сервер (/api/v1/bots/personalities). После входа гостевые персоналии предлагается перенести
 * в профиль; перенесённые удаляются из браузера, не поместившиеся (лимит, совпадение имени)
 * остаются в нём, и игрок видит причину.
 */

import {API_BASE_URL} from '../config/api';
import {UiError, readApiErrorOr} from './apiErrors';
import {tp, uiMessage} from '../i18n';
import type {MessageKey} from '../i18n';

export interface PieceValues {
    pawn: number;
    knight: number;
    bishop: number;
    rook: number;
    queen: number;
}

export interface PersonalityConfig {
    aggression: number;
    center_control: number;
    mobility: number;
    king_safety: number;
    pawn_structure: number;
    piece_values: PieceValues;
    randomness: number;
    blunder_guard_cp: number;
    target_elo: number;
}

export interface PersonalityDraft {
    name: string;
    config: PersonalityConfig;
}

export interface Personality extends PersonalityDraft {
    /** Число — id на сервере; строка — локальный id гостевой персоналии. */
    id: number | string;
    created_at: string;
    updated_at: string;
}

export interface ImportResult {
    created: Personality[];
    /** reason — код ошибки сервера (serverErrors), params — его параметры. */
    skipped: { name: string; reason: string; params?: Record<string, string | number> }[];
}

export const MAX_PERSONALITIES = 20;
export const GUEST_STORAGE_KEY = 'michess_guest_personalities';

export const DEFAULT_CONFIG: PersonalityConfig = {
    aggression: 0,
    center_control: 100,
    mobility: 100,
    king_safety: 100,
    pawn_structure: 100,
    piece_values: {pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9},
    randomness: 20,
    blunder_guard_cp: 120,
    target_elo: 1500,
};

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

// --- Гость: localStorage ----------------------------------------------------------------------

export function readGuestPersonalities(): Personality[] {
    try {
        const raw = localStorage.getItem(GUEST_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.name === 'string' && p.config) : [];
    } catch {
        return [];
    }
}

function writeGuestPersonalities(items: Personality[]): void {
    try {
        if (items.length) localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(items));
        else localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
        // Хранилище недоступно (приватный режим) — гостевые персоналии живут до перезагрузки.
    }
}

export function saveGuestPersonality(draft: PersonalityDraft, id?: string): Personality {
    const items = readGuestPersonalities();
    if (items.some((p) => p.id !== id && sameName(p.name, draft.name))) {
        throw new UiError(uiMessage('serverErrors.personality_duplicate'));
    }
    const now = new Date().toISOString();
    const existing = id ? items.find((p) => p.id === id) : undefined;
    if (!existing && items.length >= MAX_PERSONALITIES) {
        throw new UiError(uiMessage('serverErrors.personality_limit', {max: MAX_PERSONALITIES}));
    }
    const saved: Personality = existing
        ? {...existing, ...draft, updated_at: now}
        : {...draft, id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, created_at: now, updated_at: now};
    writeGuestPersonalities(existing ? items.map((p) => (p.id === id ? saved : p)) : [...items, saved]);
    return saved;
}

export function deleteGuestPersonality(id: string): void {
    writeGuestPersonalities(readGuestPersonalities().filter((p) => p.id !== id));
}

// --- Вошедший игрок: сервер ------------------------------------------------------------------

const BASE = `${API_BASE_URL}/api/v1/bots/personalities`;

async function request<T>(token: string, url: string, init: RequestInit, fallback: MessageKey): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: {Authorization: `Bearer ${token}`, ...(init.body ? {'Content-Type': 'application/json'} : {})},
    });
    if (!res.ok) throw new UiError(await readApiErrorOr(res, fallback));
    return (res.status === 204 ? undefined : await res.json()) as T;
}

export const listPersonalities = (token: string) =>
    request<Personality[]>(token, BASE, {method: 'GET'}, 'workshop.loadFailed');

export const createPersonality = (token: string, draft: PersonalityDraft) =>
    request<Personality>(token, BASE, {method: 'POST', body: JSON.stringify(draft)}, 'workshop.saveFailed');

export const updatePersonality = (token: string, id: number, draft: Partial<PersonalityDraft>) =>
    request<Personality>(token, `${BASE}/${id}`, {method: 'PUT', body: JSON.stringify(draft)}, 'workshop.saveFailed');

export const deletePersonality = (token: string, id: number) =>
    request<void>(token, `${BASE}/${id}`, {method: 'DELETE'}, 'workshop.deleteFailed');

/** Переносит гостевые персоналии в профиль; в браузере остаются только непоместившиеся. */
export async function importGuestPersonalities(token: string): Promise<ImportResult> {
    const guests = readGuestPersonalities();
    if (!guests.length) return {created: [], skipped: []};
    const result = await request<ImportResult>(token, `${BASE}/import`, {
        method: 'POST',
        body: JSON.stringify({items: guests.map(({name, config}) => ({name, config}))}),
    }, 'workshop.importFailed');
    const moved = new Set(result.created.map((p) => p.name.toLocaleLowerCase()));
    writeGuestPersonalities(guests.filter((p) => !moved.has(p.name.toLocaleLowerCase())));
    return result;
}

/**
 * После входа: если в браузере есть гостевые персоналии — предлагает перенести их в профиль.
 * Возвращает итог переноса или null, если переносить нечего или игрок отказался.
 */
export async function offerGuestPersonalityTransfer(
    token: string,
    confirm: (message: string) => boolean = (message) => window.confirm(message),
): Promise<ImportResult | null> {
    const count = readGuestPersonalities().length;
    if (!count || !confirm(tp('auth.importConfirm', count))) {
        return null;
    }
    return importGuestPersonalities(token);
}
