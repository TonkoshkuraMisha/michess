// --- FILE: frontend/src/services/feed.ts ---
// Лента и публикации (таск 30.2): лента подписок, публикации игрока, одна публикация с комментариями, «нравится».
// Все запросы — к /api/v1/feed (маршруты src/api/feed.py, правила — src/services/feed.py). Лента игрока
// (/feed/user/{имя}) видна и гостю, остальное требует входа.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';
import type {Attachment, AttachmentKind} from './messages';

/** Публикация, как её отдаёт сервер. */
export interface Post {
    id: number;
    author: string | null;
    avatar: string | null;
    body: string;
    /** Карточка-вложение (партия, позиция, задача…): снимок данных, сохранённый сервером при публикации. */
    attachment: Attachment | null;
    created_at: string | null;
    likes: number;
    /** Отметил ли публикацию тот, кто смотрит. */
    liked: boolean;
    comments: number;
    mine: boolean;
    /** Скрыта модератором: такую публикацию сервер отдаёт только автору. */
    hidden: boolean;
    /** Придержана фильтром уважительного общения (30.3): ждёт решения модератора. */
    held?: boolean;
}

/** Комментарий к публикации. */
export interface PostComment {
    id: number;
    author: string | null;
    body: string;
    created_at: string | null;
    mine: boolean;
    /** Право удалить решает сервер (src/services/feed.py). */
    can_delete: boolean;
    held?: boolean;
}

/** Страница ленты. page — размер страницы сервера (feed.PAGE): пришло меньше — дальше публикаций нет. */
export interface FeedPage {
    posts: Post[];
    page: number;
}

/** Запрос к /api/v1/feed: токен — если игрок вошёл; отказ сервера — UiError с текстом по коду ошибки. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/feed${path}`, {
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

/** Параметр подгрузки: публикации старше той, чей id передан (лента листается назад по id). */
const before = (id?: number) => (id ? `?before_id=${id}` : '');

/**
 * Эндпоинты ленты. sendAnyway (send_anyway): фильтр уважительного общения отклонил текст (код text_flagged), игрок
 * настаивает — текст уходит на проверку модератору и до его решения остаётся придержанным (held).
 */
export const feedApi = {
    following: (beforeId?: number) => call<FeedPage>(before(beforeId)),
    ofUser: (name: string, beforeId?: number) => call<FeedPage>(`/user/${encodeURIComponent(name)}${before(beforeId)}`),
    create: (body: string, attachment?: { kind: AttachmentKind; ref: string } | null, sendAnyway = false) =>
        call<Post>('', {method: 'POST', body: JSON.stringify({body, attachment: attachment ?? null, send_anyway: sendAnyway})}),
    get: (id: number) => call<{ post: Post; comments: PostComment[] }>(`/posts/${id}`),
    remove: (id: number) => call<{ deleted: boolean }>(`/posts/${id}`, {method: 'DELETE'}),
    like: (id: number, liked: boolean) => call<Post>(`/posts/${id}/like`, {method: liked ? 'POST' : 'DELETE'}),
    comment: (id: number, body: string, sendAnyway = false) =>
        call<PostComment>(`/posts/${id}/comments`, {method: 'POST', body: JSON.stringify({body, send_anyway: sendAnyway})}),
    removeComment: (id: number) => call<{ deleted: boolean }>(`/comments/${id}`, {method: 'DELETE'}),
};
