// --- FILE: frontend/src/services/conferences.ts ---
// Конференции (таск 33.6): Кубок конференций за сезон и страна игрока в профиле. Правила и таблица стран — на
// сервере (src/services/conferences.py); клиент получает таблицу «страна → конференция» вместе со страницей.
// Названия стран не хранятся в каталогах переводов: их даёт браузер (Intl.DisplayNames) на языке интерфейса.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';
import type {ConferenceKey} from './arenas';

export interface CupRow {
    conference: ConferenceKey;
    score: number;
    /** В скольких аренах сезона конференция набрала очки. */
    arenas: number;
}

export interface Membership {
    /** Код страны ISO 3166-1 alpha-2 из профиля; null — не указана. */
    country: string | null;
    conference: ConferenceKey | null;
    /** Можно ли в этом сезоне сменить конференцию (одна смена за сезон). */
    can_change: boolean;
}

export interface ConferencesData {
    /** Сезон «ГГГГ-ММ» — календарный месяц. */
    season: string;
    /** Сколько лучших игроков конференции идёт в зачёт арены. */
    top_players: number;
    table: CupRow[];
    conferences: { key: ConferenceKey; timezone: string }[];
    /** Код страны → конференция: все страны, которые можно выбрать. */
    countries: Record<string, ConferenceKey>;
    /** Страна, которую назвал прокси перед сервером, — только подсказка. */
    suggested_country: string | null;
    me: Membership | null;
}

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
