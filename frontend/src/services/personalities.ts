// --- FILE: frontend/src/services/personalities.ts ---

/**
 * Мастерская соперников: персоналии, собранные игроком (таск 10.2).
 *
 * Один источник правды за раз: у гостя — localStorage этого браузера, у вошедшего игрока —
 * сервер (/api/v1/bots/personalities). После входа гостевые персоналии предлагается перенести
 * в профиль; перенесённые удаляются из браузера, не поместившиеся (лимит, совпадение имени)
 * остаются в нём, и игрок видит причину.
 *
 * Сервер: маршруты src/api/personalities.py (таблица bot_personalities), поиск дебютов — GET /api/v1/bots/openings
 * (src/api/bots.py). Формат характера и допустимые границы ползунков задаёт BotPersonalityConfig
 * (src/services/bots/personality.py); здесь его зеркало — PersonalityConfig.
 */

import {API_BASE_URL} from '../config/api';
import {UiError, readApiErrorOr} from './apiErrors';
import {tp, uiMessage} from '../i18n';
import type {MessageKey} from '../i18n';

/** Как персоналия ценит фигуры (в пешках): влияет на выбор разменов, а не на оценку движка. */
export interface PieceValues {
    pawn: number;
    knight: number;
    bishop: number;
    rook: number;
    queen: number;
}

/** Характер соперника — зеркало BotPersonalityConfig сервера (границы значений проверяет сервер). */
export interface PersonalityConfig {
    /** −100…100: плюс — шахи, жертвы, игра против короля; минус — профилактика и тихие ходы. */
    aggression: number;
    /** Веса признаков 0…200: 100 — обычный вес, 0 — признак не учитывается, 200 — удвоенный. */
    center_control: number;
    mobility: number;
    king_safety: number;
    pawn_structure: number;
    piece_values: PieceValues;
    /**
     * Ползунки силы: randomness (0…100) — случайный разброс между близкими кандидатами; blunder_guard_cp — окно
     * от лучшего хода в сантипешках, внутри которого стиль выбирает ход; target_elo — целевой рейтинг.
     */
    randomness: number;
    blunder_guard_cp: number;
    target_elo: number;
    /** Любимые дебюты (таск 21.2): позиции (EPD) записей таблицы дебютов, до трёх за каждый цвет. */
    openings_white?: string[];
    openings_black?: string[];
    /**
     * Таск 21.4: привычки новичков, дебютный характер, отношение к ничьей (−100 — никогда не соглашается, +100 —
     * охотно) и вес проходных пешек (0…200, 100 — как у всех).
     */
    habits?: Habit[];
    opening_style?: OpeningStyle;
    draw_attitude?: number;
    passed_pawns?: number;
}

/** Коды привычек и дебютных характеров — те же, что на сервере; подписи — каталог workshop.habits / openingStyles. */
export const HABITS = ['hangs_pieces', 'early_queen', 'pawn_grabber', 'knight_lover', 'no_castling', 'trades_all'] as const;
export type Habit = typeof HABITS[number];
export const OPENING_STYLES = ['normal', 'trapper', 'trap_victim', 'gambit', 'early_queen', 'drawish', 'capture_lover', 'offbeat'] as const;
export type OpeningStyle = typeof OPENING_STYLES[number];
/** Пределы формы — такие же, как в проверке сервера (не больше трёх привычек и трёх дебютов за цвет). */
export const MAX_HABITS = 3;

export const MAX_FAVORITE_OPENINGS = 3;

/** Запись открытой таблицы дебютов: позиция (EPD) — то, что хранится в openings_white / openings_black. */
export interface OpeningEntry {
    eco: string;
    /** Английское имя собственное из открытой таблицы дебютов — не переводится. */
    name: string;
    epd: string;
    moves: string[];
}

/** Поиск дебютов по названию или коду ECO, либо записи по позициям (чтобы показать названия выбранных). */
export async function fetchOpenings(params: { q?: string; epds?: string[] }): Promise<OpeningEntry[]> {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    for (const epd of params.epds ?? []) query.append('epd', epd);
    const res = await fetch(`${API_BASE_URL}/api/v1/bots/openings?${query.toString()}`);
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return ((await res.json()) as { openings: OpeningEntry[] }).openings;
}

/** То, что игрок собрал в форме: имя и характер. Имя попадает в PGN, поэтому сервер проверяет его как имя игрока. */
export interface PersonalityDraft {
    name: string;
    config: PersonalityConfig;
}

/** Сохранённая персоналия — с сервера или из localStorage гостя. */
export interface Personality extends PersonalityDraft {
    /** Число — id на сервере; строка — локальный id гостевой персоналии. */
    id: number | string;
    created_at: string;
    updated_at: string;
}

/** Итог переноса гостевых персоналий (POST /bots/personalities/import). */
export interface ImportResult {
    created: Personality[];
    /** reason — код ошибки сервера (serverErrors), params — его параметры. */
    skipped: { name: string; reason: string; params?: Record<string, string | number> }[];
}

/** Предел числа персоналий — тот же, что на сервере (MAX_PERSONALITIES_PER_USER); гостю он же в браузере. */
export const MAX_PERSONALITIES = 20;
/** Ключ localStorage с персоналиями гостя (JSON-массив Personality). */
export const GUEST_STORAGE_KEY = 'michess_guest_personalities';

/** Характер новой персоналии — те же значения по умолчанию, что у BotPersonalityConfig на сервере. */
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
    draw_attitude: 0,
    passed_pawns: 100,
};

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

// --- Гость: localStorage ----------------------------------------------------------------------

/** Персоналии гостя из localStorage; испорченные записи и недоступное хранилище дают пустой список. */
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

/**
 * Создать (без id) или изменить гостевую персоналию. Правила те же, что у сервера, и с теми же текстами ошибок:
 * имя не повторяется, персоналий не больше MAX_PERSONALITIES. Зарезервированные имена гостю не проверяются — их
 * проверит сервер при переносе в профиль.
 */
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

/** Запрос с токеном; отказ — UiError с текстом по коду сервера, а если кода нет — с запасным сообщением fallback. */
async function request<T>(token: string, url: string, init: RequestInit, fallback: MessageKey): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: {Authorization: `Bearer ${token}`, ...(init.body ? {'Content-Type': 'application/json'} : {})},
    });
    if (!res.ok) throw new UiError(await readApiErrorOr(res, fallback));
    return (res.status === 204 ? undefined : await res.json()) as T;
}

// Четыре запроса к /api/v1/bots/personalities: список (GET), создание (POST), правка (PUT /{id}), удаление
// (DELETE /{id}). Сервер отдаёт и меняет только персоналии самого игрока.
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
