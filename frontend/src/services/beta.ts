// --- FILE: frontend/src/services/beta.ts ---
// Программа беты (таск 24.4): настройки сайта (закрыта ли регистрация, ссылка на сообщество, версия), проверка
// кода-приглашения, «Сообщить о проблеме» и работа модератора с приглашениями и сообщениями.
// Все запросы — к /api/v1/beta (маршруты src/api/beta.py, правила — src/services/beta.py). Без входа доступны
// /config, /invites/check и отправка сообщения (POST /feedback); остальное сервер отдаёт только модератору.

import {useEffect, useSyncExternalStore} from 'react';
import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** Настройки сайта (GET /beta/config), разобранные parseConfig: значения берутся из настроек сервера. */
export interface SiteConfig {
    /** Регистрация только по коду-приглашению. */
    inviteOnly: boolean;
    /** Ссылка на канал сообщества; null — не задана, и на сайте её нет. */
    communityUrl: string | null;
    /** Версия приложения на сервере (settings.VERSION). */
    version: string | null;
}

/** Состояние приглашения, вычисленное сервером: действует, отозвано, истёк срок, исчерпано число использований. */
export type InviteState = 'active' | 'revoked' | 'expired' | 'used_up';

/** Код-приглашение в списке модератора (GET /beta/invites). */
export interface Invite {
    id: number;
    code: string;
    /** Пометка модератора «для кого» — игрокам не показывается. */
    note: string | null;
    /** Сколько раз код можно использовать; null — без предела. */
    max_uses: number | null;
    uses: number;
    expires_at: string | null;
    revoked_at: string | null;
    created_at: string | null;
    state: InviteState;
}

/** Статусы сообщения о проблеме — те же, что проверяет сервер (FeedbackStatusIn в src/api/beta.py). */
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'done', 'rejected'] as const;
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];

/** Сообщение о проблеме в очереди модератора: текст и то, что клиент приложил при отправке (sendFeedback). */
export interface FeedbackItem {
    id: number;
    message: string;
    /** Путь страницы, с которой отправлено сообщение. */
    page: string | null;
    app_version: string | null;
    language: string | null;
    /** Размер окна браузера «ширина x высота» (screenSize). */
    screen: string | null;
    status: FeedbackStatus;
    /** Имя игрока; null — сообщение от гостя. */
    author: string | null;
    created_at: string | null;
    updated_at: string | null;
}

/** Очередь сообщений (GET /beta/feedback): сообщения и число сообщений в каждом статусе. */
export interface FeedbackQueue {
    items: FeedbackItem[];
    counts: Record<FeedbackStatus, number>;
}

/** Запрос к /api/v1/beta: токен — если игрок вошёл; отказ сервера — UiError с текстом по коду ошибки. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/beta${path}`, {
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

/** Размер окна браузера («390x844»): по нему видно, на каком экране сломалась вёрстка. */
export function screenSize(): string {
    return `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`;
}

/** Ссылка-приглашение: открывает сайт сразу с формой регистрации и вписанным кодом. */
export function inviteLink(code: string): string {
    return `${window.location.origin}/?invite=${encodeURIComponent(code)}`;
}

/** Эндпоинты беты. checkInvite и sendFeedback работают без входа; остальное — только для модератора. */
export const betaApi = {
    /** Действует ли код (подсказка в форме регистрации); сам код при проверке не тратится. */
    checkInvite: (code: string) =>
        call<{ valid: boolean }>(`/invites/check?code=${encodeURIComponent(code)}`).then((r) => r.valid === true),
    /** page — только путь страницы: в параметрах адреса бывают одноразовые ссылки (сброс пароля, приглашение). */
    sendFeedback: (body: { message: string; page: string; language: string; screen: string }) =>
        call<{ id: number }>('/feedback', {method: 'POST', body: JSON.stringify(body)}),
    invites: () => call<{ invite_only?: boolean; invites?: Invite[] }>('/invites'),
    createInvite: (body: { note?: string; max_uses?: number; expires_in_days?: number }) =>
        call<Invite>('/invites', {method: 'POST', body: JSON.stringify(body)}),
    revokeInvite: (id: number) => call<Invite>(`/invites/${id}/revoke`, {method: 'POST'}),
    feedback: (status?: FeedbackStatus) =>
        call<Partial<FeedbackQueue>>(`/feedback${status ? `?status=${status}` : ''}`),
    setFeedbackStatus: (id: number, status: FeedbackStatus) =>
        call<{ id: number; status: FeedbackStatus }>(`/feedback/${id}/status`, {method: 'POST', body: JSON.stringify({status})}),
};

// --- настройки сайта: один запрос на вкладку ---------------------------------------------------------------------

const DEFAULT_CONFIG: SiteConfig = {inviteOnly: false, communityUrl: null, version: null};
let config: SiteConfig = DEFAULT_CONFIG;
let pending: Promise<SiteConfig> | null = null;
const listeners = new Set<() => void>();

function parseConfig(raw: unknown): SiteConfig {
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const url = typeof data.community_url === 'string' && /^https?:\/\//.test(data.community_url) ? data.community_url : null;
    return {
        inviteOnly: data.invite_only === true,
        communityUrl: url,
        version: typeof data.version === 'string' ? data.version : null,
    };
}

/** Настройки сайта с сервера. Без сети или при ошибке — значения по умолчанию: регистрация открыта, ссылки нет. */
export function loadSiteConfig(): Promise<SiteConfig> {
    pending ??= (async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/beta/config`);
            if (res?.ok) {
                config = parseConfig(await res.json());
                listeners.forEach((notify) => notify());
            }
        } catch {
            // остаются значения по умолчанию
        }
        return config;
    })();
    return pending;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Хук: настройки сайта. До ответа сервера — значения по умолчанию; запрос один на вкладку на все хуки. */
export function useSiteConfig(): SiteConfig {
    const current = useSyncExternalStore(subscribe, () => config, () => config);
    useEffect(() => {
        void loadSiteConfig();
    }, []);
    return current;
}

/** Только для тестов: забыть загруженные настройки. */
export function resetSiteConfig(): void {
    config = DEFAULT_CONFIG;
    pending = null;
}

/** Площадка сообщества по адресу ссылки — для подписи. */
export function communityPlatform(url: string): 'telegram' | 'discord' | 'generic' {
    let host = '';
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return 'generic';
    }
    if (host === 't.me' || host === 'telegram.me' || host.endsWith('.t.me')) return 'telegram';
    if (host === 'discord.gg' || host === 'discord.com' || host.endsWith('.discord.com')) return 'discord';
    return 'generic';
}
