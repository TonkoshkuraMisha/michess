// --- FILE: frontend/src/services/beta.ts ---
// Программа беты (таск 24.4): настройки сайта (закрыта ли регистрация, ссылка на сообщество, версия), проверка
// кода-приглашения, «Сообщить о проблеме» и работа модератора с приглашениями и сообщениями.

import {useEffect, useSyncExternalStore} from 'react';
import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export interface SiteConfig {
    /** Регистрация только по коду-приглашению. */
    inviteOnly: boolean;
    /** Ссылка на канал сообщества; null — не задана, и на сайте её нет. */
    communityUrl: string | null;
    version: string | null;
}

export type InviteState = 'active' | 'revoked' | 'expired' | 'used_up';

export interface Invite {
    id: number;
    code: string;
    note: string | null;
    max_uses: number | null;
    uses: number;
    expires_at: string | null;
    revoked_at: string | null;
    created_at: string | null;
    state: InviteState;
}

export const FEEDBACK_STATUSES = ['new', 'in_progress', 'done', 'rejected'] as const;
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];

export interface FeedbackItem {
    id: number;
    message: string;
    page: string | null;
    app_version: string | null;
    language: string | null;
    screen: string | null;
    status: FeedbackStatus;
    author: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface FeedbackQueue {
    items: FeedbackItem[];
    counts: Record<FeedbackStatus, number>;
}

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

export const betaApi = {
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
