// --- FILE: frontend/src/services/arenas.ts ---
// Арены — турниры между людьми (таск 17.2): расписание, вход, «Играть» (ожидание пары), таблица.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** closing (33.1): пар больше нет — доигрываются последние партии или идёт время до конца; итоги — в finished. */
export type ArenaStatus = 'scheduled' | 'running' | 'closing' | 'finished';

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
    /** В партиях арены доступен «берсерк» (33.3): половина времени без добавки ради лишнего очка за победу. */
    berserk?: boolean;
    /** Последний старт: до него создаются пары (только у формата arena). */
    last_start_at?: string;
    /** Идущих партий арены — итоги ждут их. */
    open_games?: number;
    /** Группа по силе (33.2): потолок рейтинга; null — открытая арена. */
    max_rating?: number | null;
    /** Деление при переполнении (33.2): 1 — основное. */
    division?: number;
    parent_id?: number | null;
    /** Конференция, по расписанию которой идёт арена (33.4): central | western | northern | southern | eastern. */
    conference?: string | null;
    /** Вечерняя арена 5+3 — главная арена дня своей конференции (33.4). */
    evening?: boolean;
}

export const CONFERENCES = ['central', 'western', 'northern', 'southern', 'eastern'] as const;
export type ConferenceKey = typeof CONFERENCES[number];

export function conferenceKey(value: string | null | undefined): ConferenceKey | null {
    return (CONFERENCES as readonly string[]).includes(value ?? '') ? value as ConferenceKey : null;
}

export interface ArenaStanding {
    place: number;
    username: string;
    score: number;
    games: number;
    wins: number;
    fire: boolean;
    rating: number;
    /** Перформанс в арене — первый показатель при равенстве очков. */
    performance?: number | null;
    /** Конференция игрока на момент входа в арену (33.6); null — страна в профиле не указана. */
    conference?: string | null;
}

/** Строка зачёта конференций арены (33.6): сумма очков лучших участников конференции. */
export interface ArenaConferenceRow {
    conference: string;
    score: number;
    /** Сколько игроков вошло в зачёт и сколько игроков конференции в арене всего. */
    counted: number;
    players: number;
}

export interface ArenaDetail extends ArenaInfo {
    standings: ArenaStanding[];
    conferences?: ArenaConferenceRow[];
    /** division_arena_id: игрок в другом делении этой арены — клиент переходит туда (33.2). */
    /** reminder: игрок просил напомнить о начале этой арены (33.4). */
    me: {
        joined: boolean; waiting: boolean; current_game_id: number | null; division_arena_id?: number | null;
        reminder?: boolean;
    } | null;
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
    /** arena_id — деление, куда попал игрок (при переполнении — не та арена, что запрошена). */
    join: (id: number) => call<{ joined: boolean; arena_id?: number }>(`/${id}/join`, {method: 'POST'}),
    ready: (id: number) => call<{ waiting?: boolean; game_id?: number }>(`/${id}/ready`, {method: 'POST'}),
    leaveWaiting: (id: number) => call<{ waiting: boolean }>(`/${id}/leave-waiting`, {method: 'POST'}),
    /** «Напомнить»: незадолго до начала арены придёт уведомление; forgetReminder — отменить. */
    remind: (id: number) => call<{ reminder: boolean }>(`/${id}/remind`, {method: 'POST'}),
    forgetReminder: (id: number) => call<{ reminder: boolean }>(`/${id}/remind`, {method: 'DELETE'}),
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
