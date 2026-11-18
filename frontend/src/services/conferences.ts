// --- FILE: frontend/src/services/conferences.ts ---
// Конференции (таск 33.6): Кубок конференций за сезон и страна игрока в профиле. Правила и таблица стран — на
// сервере (src/services/conferences.py); клиент получает таблицу «страна → конференция» вместе со страницей.
// Названия стран не хранятся в каталогах переводов: их даёт браузер (Intl.DisplayNames) на языке интерфейса.
// Эндпоинты (src/api/conferences.py): GET /api/v1/conferences — страница, PUT /api/v1/conferences/me — страна.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';
import type {ConferenceKey} from './arenas';

/** Строка Кубка конференций: сумма зачётов конференции по аренам сезона. */
export interface CupRow {
    conference: ConferenceKey;
    score: number;
    /** В скольких аренах сезона конференция набрала очки. */
    arenas: number;
}

/** Матч конференций в списке страницы (conferences.matches на сервере): счёт — победа 1, ничья ½. */
export interface MatchRow {
    arena_id: number;
    home: ConferenceKey;
    guest: ConferenceKey;
    starts_at: string;
    status: 'scheduled' | 'running' | 'closing' | 'finished';
    home_score: number;
    guest_score: number;
    /** Сколько игроков обеих конференций записалось. */
    players: number;
}

/** Страна и конференция вошедшего игрока (users.country на сервере; конференцию определяет страна). */
export interface Membership {
    /** Код страны ISO 3166-1 alpha-2 из профиля; null — не указана. */
    country: string | null;
    conference: ConferenceKey | null;
    /** Можно ли в этом сезоне сменить конференцию (одна смена за сезон). */
    can_change: boolean;
}

/** Ответ GET /api/v1/conferences: Кубок за сезон, справочники для выбора страны и данные вошедшего игрока. */
export interface ConferencesData {
    /** Сезон «ГГГГ-ММ» — календарный месяц. */
    season: string;
    /** Сколько лучших игроков конференции идёт в зачёт арены. */
    top_players: number;
    table: CupRow[];
    /** Матчи конференций сезона и ближайшие. */
    matches?: MatchRow[];
    /** Пять конференций и зона времени (IANA), по местному времени которой составлено расписание её арен. */
    conferences: { key: ConferenceKey; timezone: string }[];
    /** Код страны → конференция: все страны, которые можно выбрать. */
    countries: Record<string, ConferenceKey>;
    /** Страна, которую назвал прокси перед сервером, — только подсказка. */
    suggested_country: string | null;
    /** null — запрос без входа. */
    me: Membership | null;
}

/** Запрос к /api/v1/conferences: токен — если игрок вошёл; отказ сервера — UiError с текстом по коду ошибки. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/conferences${path}`, {
            ...init,
            headers: {
                ...(init.body ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

export const conferencesApi = {
    /** Страница конференций за текущий сезон (параметр season сервер принимает, но клиент его не передаёт). */
    page: () => call<ConferencesData>(''),
    /** null — убрать страну из профиля. */
    setCountry: (country: string | null) => call<Membership>('/me', {method: 'PUT', body: JSON.stringify({country})}),
};

/** Название страны на языке интерфейса; если браузер его не знает — сам код. */
export function countryName(code: string, language: string): string {
    try {
        return new Intl.DisplayNames([language], {type: 'region'}).of(code) ?? code;
    } catch {
        return code;
    }
}

/** Страна из языка браузера («uk-UA» → UA) — запасная подсказка, когда сервер страну не назвал. */
export function localeCountry(languages: readonly string[] = navigator.languages ?? [navigator.language ?? '']): string | null {
    for (const tag of languages) {
        const region = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(tag)?.[1];
        if (region) return region.toUpperCase();
    }
    return null;
}
