// --- FILE: frontend/src/services/timeMachine.ts ---
// «Машина времени» (таск 28.3): знаменитые турниры прошлого, в которые игрок входит дополнительным участником.
// Сервер отдаёт ключи и числа (состав, сила, настоящий итог); названия, рассказы и имена — из каталога.

import {API_BASE_URL} from '../config/api';
import {UiError, readApiErrorOr} from './apiErrors';
import {ladderOpponentName} from '../config/players';
import {hasMessage} from '../i18n';
import type {I18n, MessageKey} from '../i18n';
import {getToken} from './authToken';
import type {Tournament, TournamentFormat} from './tournaments';

export const GUEST_PREFIX = 'guest:';

/** Участник исторического турнира и его настоящий итог. */
export interface FieldEntry {
    id: string;
    /** bot — исторический мастер с книгой и портретом; guest — мастер прошлого (участник турниров). */
    kind: 'bot' | 'guest';
    rating: number;
    /** Место в настоящем турнире; null — выбыл без места (турнир на выбывание). */
    place: number | null;
    score: number | null;
}

export interface HistoricEvent {
    key: string;
    year: number;
    format: TournamentFormat;
    cycles: number;
    /** Участников вместе с игроком. */
    size: number;
    rounds: number;
    /** Сколько партий сыграет игрок; null — зависит от него самого (на выбывание). */
    player_games: number | null;
    field: FieldEntry[];
    active_id: number | null;
    best_place: number | null;
    played: number;
}

const BASE = `${API_BASE_URL}/api/v1/tournaments/time-machine`;

async function call<T>(url: string, init: RequestInit, fallback: MessageKey): Promise<T> {
    const token = getToken();
    const res = await fetch(url, {
        ...init,
        headers: {
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
            ...(init.body ? {'Content-Type': 'application/json'} : {}),
        },
    });
    if (!res.ok) throw new UiError(await readApiErrorOr(res, fallback));
    return res.json() as Promise<T>;
}

export const getTimeMachine = () =>
    call<{ events?: HistoricEvent[] }>(BASE, {method: 'GET'}, 'timeMachine.loadFailed').then((r) => r.events ?? []);

export const startHistoricEvent = (key: string, baseTimeMs: number, incrementMs: number) =>
    call<Tournament>(`${BASE}/${encodeURIComponent(key)}`, {
        method: 'POST', body: JSON.stringify({base_time_ms: baseTimeMs, increment_ms: incrementMs}),
    }, 'timeMachine.startFailed');

/** Полное имя мастера прошлого на языке игрока; id без перевода показывается как есть. */
export function guestName(id: string, t: I18n['t']): string {
    const key = `bots.guests.${id}.name`;
    return hasMessage(key) ? t(key as MessageKey) : id;
}

/** Короткое имя (фамилия) — для таблиц и сетки турнира, как у исторических ботов. */
export function guestShortName(id: string, t: I18n['t']): string {
    const key = `bots.guests.${id}.shortName`;
    return hasMessage(key) ? t(key as MessageKey) : guestName(id, t);
}

/** Одна строка о мастере прошлого: кто он и как играл. */
export function guestAbout(id: string, t: I18n['t']): string | null {
    const key = `bots.guests.${id}.about`;
    return hasMessage(key) ? t(key as MessageKey) : null;
}

/** Полное имя участника исторического турнира: у мастера с портретом — из каталога ботов, у мастера прошлого — своё. */
export function fieldName(entry: Pick<FieldEntry, 'id' | 'kind'>, t: I18n['t']): string {
    if (entry.kind === 'guest') return guestName(entry.id, t);
    const key = `bots.profiles.${entry.id}.name`;
    return hasMessage(key) ? t(key as MessageKey) : ladderOpponentName('historical', entry.id, t);
}

/** Короткое имя участника — там, где мало места. */
export function fieldShortName(entry: Pick<FieldEntry, 'id' | 'kind'>, t: I18n['t']): string {
    return entry.kind === 'guest' ? guestShortName(entry.id, t) : ladderOpponentName('historical', entry.id, t);
}

/** Очки в привычной записи: 16.5 → «16½», 0.5 → «½». */
export function scoreText(score: number): string {
    const whole = Math.floor(score);
    const half = score - whole >= 0.5;
    return `${whole || !half ? whole : ''}${half ? '½' : ''}`;
}

/** Название турнира на языке игрока; неизвестный ключ — как есть. */
export function eventTitle(key: string, t: I18n['t']): string {
    const message = `timeMachine.events.${key}.title`;
    return hasMessage(message) ? t(message as MessageKey) : key;
}
