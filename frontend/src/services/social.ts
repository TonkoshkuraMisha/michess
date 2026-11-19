// --- FILE: frontend/src/services/social.ts ---
// Игроки и уведомления (таск 17.1): поиск, подписки и «друзья», кто в сети, прямой вызов, центр уведомлений.
// Все запросы — к /api/v1/social и только с входом (маршруты src/api/social.py; уведомления —
// src/services/notifications.py). Новое уведомление сервер, кроме записи в базу, доставляет в открытые вкладки по
// WebSocket — список здесь нужен для первой загрузки и на случай, если событие не дошло.

import {apiRequest} from './http';

/** Игрок в результатах поиска и в списке подписок. */
export interface PlayerCard {
    username: string;
    online: boolean;
    blitz_rating: number;
    rapid_rating: number;
    /** Взаимная подписка; поле есть только в списке подписок (GET /social/following). */
    friend?: boolean;
}

/** Отношение смотрящего к игроку: подписан ли он, подписан ли игрок на него; вместе — «друзья». */
export interface Relation {
    username: string;
    /** Это сам смотрящий. */
    self: boolean;
    following: boolean;
    followed_by: boolean;
    friends: boolean;
    online: boolean;
}

/** Виды уведомлений; текст собирается на клиенте из каталога по виду и полям payload. */
export type NotificationKind = 'challenge' | 'rematch' | 'tournament_round' | 'report_answer' | 'workout_reminder' | 'post_comment'
    | 'arena_reminder' | 'arena_podium';

/** Уведомление центра уведомлений (таблица notifications). Поля payload зависят от вида — см. notificationLink. */
export interface AppNotification {
    id: number;
    kind: NotificationKind;
    payload: Record<string, string | number | boolean | null>;
    created_at: string | null;
    read: boolean;
}

/** Список уведомлений и число непрочитанных. */
export interface Inbox {
    unread: number;
    items: AppNotification[];
}

/** Запрос к /api/v1/social через общую обёртку http.ts (токен, JSON, ошибки). */
const call = <T>(path: string, init: RequestInit = {}) => apiRequest<T>(`/social${path}`, init);

const user = (name: string) => encodeURIComponent(name);

export const socialApi = {
    /** Игроки, чьё имя начинается с q (без учёта регистра); точное совпадение — первым. */
    search: (q: string) => call<{ players: PlayerCard[] }>(`/search?q=${encodeURIComponent(q)}`),
    relation: (name: string) => call<Relation>(`/relation/${user(name)}`),
    follow: (name: string) => call<Relation>(`/follow/${user(name)}`, {method: 'POST'}),
    unfollow: (name: string) => call<Relation>(`/follow/${user(name)}`, {method: 'DELETE'}),
    /** На кого подписан игрок; сначала те, кто в сети. */
    following: () => call<{ players: PlayerCard[] }>('/following'),
    /**
     * Прямой вызов: code — код приватного приглашения, которое игрок уже создал на главной доске (действие
     * WebSocket create_invite); сервер превращает его в уведомление сопернику со ссылкой /challenge/<код>.
     */
    challenge: (name: string, code: string) => call<{ sent: boolean; online: boolean }>(`/challenge/${user(name)}`, {
        method: 'POST', body: JSON.stringify({code}),
    }),
    notifications: () => call<Inbox>('/notifications'),
    /** Отметить прочитанными указанные уведомления; без ids — все. */
    markRead: (ids?: number[]) => call<Inbox>('/notifications/read', {method: 'POST', body: JSON.stringify({ids: ids ?? null})}),
};

/** Куда ведёт уведомление; виды без своей страницы (реванш, ответ на жалобу, разминка) ведут на главную. */
export function notificationLink(n: AppNotification): string {
    if (n.kind === 'challenge') return `/challenge/${n.payload.code}`;
    if (n.kind === 'tournament_round') return `/tournaments/${n.payload.tournament_id}`;
    if (n.kind === 'post_comment') return `/feed/post/${n.payload.post_id}`;
    if (n.kind === 'arena_reminder' || n.kind === 'arena_podium') return `/arenas/${n.payload.arena_id}`;
    return '/';
}
