// --- FILE: frontend/src/services/arenas.ts ---
// Арены — турниры между людьми (таск 17.2): расписание, вход, «Играть» (ожидание пары), таблица.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export type ArenaStatus = 'scheduled' | 'running' | 'finished';

export interface ArenaInfo {
    id: number;
    schedule_key: string | null;
    /** arena — по времени, swiss — по турам (17.2). */
    format?: 'arena' | 'swiss';
    rounds?: number;
    current_round?: number;
    base_time_ms: number;
    increment_ms: number;
    starts_at: string;
    ends_at: string;
    status: ArenaStatus;
    players?: number;
}

export interface ArenaStanding {
    place: number;
    username: string;
    score: number;
    games: number;
    wins: number;
    fire: boolean;
    rating: number;
}

export interface ArenaDetail extends ArenaInfo {
    standings: ArenaStanding[];
    me: { joined: boolean; waiting: boolean; current_game_id: number | null } | null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/arenas${path}`, {
            ...init,
            headers: {...(token ? {Authorization: `Bearer ${token}`} : {})},
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

export const arenasApi = {
    list: () => call<{ arenas: ArenaInfo[] }>(''),
    current: () => call<{ arena: ArenaInfo | null }>('/current'),
    get: (id: number) => call<ArenaDetail>(`/${id}`),
    join: (id: number) => call<{ joined: boolean }>(`/${id}/join`, {method: 'POST'}),
    ready: (id: number) => call<{ waiting?: boolean; game_id?: number }>(`/${id}/ready`, {method: 'POST'}),
    leaveWaiting: (id: number) => call<{ waiting: boolean }>(`/${id}/leave-waiting`, {method: 'POST'}),
};

export function controlLabel(a: Pick<ArenaInfo, 'base_time_ms' | 'increment_ms'>): string {
    return `${Math.round(a.base_time_ms / 60000)}+${Math.round(a.increment_ms / 1000)}`;
}

/** Секунд до момента (не меньше нуля). */
export function secondsUntil(iso: string, now = Date.now()): number {
    return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

export function clock(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
