// --- FILE: frontend/src/services/social.ts ---
// Игроки и уведомления (таск 17.1): поиск, подписки и «друзья», кто в сети, прямой вызов, центр уведомлений.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export interface PlayerCard {
    username: string;
    online: boolean;
    blitz_rating: number;
    rapid_rating: number;
    friend?: boolean;
}

export interface Relation {
    username: string;
    self: boolean;
    following: boolean;
    followed_by: boolean;
    friends: boolean;
    online: boolean;
}

export type NotificationKind = 'challenge' | 'rematch' | 'tournament_round' | 'report_answer';

export interface AppNotification {
    id: number;
    kind: NotificationKind;
    payload: Record<string, string | number | boolean | null>;
    created_at: string | null;
    read: boolean;
}

export interface Inbox {
    unread: number;
    items: AppNotification[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/social${path}`, {
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

const user = (name: string) => encodeURIComponent(name);

export const socialApi = {
    search: (q: string) => call<{ players: PlayerCard[] }>(`/search?q=${encodeURIComponent(q)}`),
    relation: (name: string) => call<Relation>(`/relation/${user(name)}`),
    follow: (name: string) => call<Relation>(`/follow/${user(name)}`, {method: 'POST'}),
    unfollow: (name: string) => call<Relation>(`/follow/${user(name)}`, {method: 'DELETE'}),
    following: () => call<{ players: PlayerCard[] }>('/following'),
    challenge: (name: string, code: string) => call<{ sent: boolean; online: boolean }>(`/challenge/${user(name)}`, {
        method: 'POST', body: JSON.stringify({code}),
    }),
    notifications: () => call<Inbox>('/notifications'),
    markRead: (ids?: number[]) => call<Inbox>('/notifications/read', {method: 'POST', body: JSON.stringify({ids: ids ?? null})}),
};

/** Куда ведёт уведомление. */
export function notificationLink(n: AppNotification): string {
    if (n.kind === 'challenge') return `/challenge/${n.payload.code}`;
    if (n.kind === 'tournament_round') return `/tournaments/${n.payload.tournament_id}`;
    return '/';
}
