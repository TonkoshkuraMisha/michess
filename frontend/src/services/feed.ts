// --- FILE: frontend/src/services/feed.ts ---
// Лента и публикации (таск 30.2): лента подписок, публикации игрока, одна публикация с комментариями, «нравится».

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';
import type {Attachment, AttachmentKind} from './messages';

export interface Post {
    id: number;
    author: string | null;
    avatar: string | null;
    body: string;
    attachment: Attachment | null;
    created_at: string | null;
    likes: number;
    liked: boolean;
    comments: number;
    mine: boolean;
    hidden: boolean;
}

export interface PostComment {
    id: number;
    author: string | null;
    body: string;
    created_at: string | null;
    mine: boolean;
    can_delete: boolean;
}

export interface FeedPage {
    posts: Post[];
    page: number;
}

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

const before = (id?: number) => (id ? `?before_id=${id}` : '');

export const feedApi = {
    following: (beforeId?: number) => call<FeedPage>(before(beforeId)),
    ofUser: (name: string, beforeId?: number) => call<FeedPage>(`/user/${encodeURIComponent(name)}${before(beforeId)}`),
    create: (body: string, attachment?: { kind: AttachmentKind; ref: string } | null) =>
        call<Post>('', {method: 'POST', body: JSON.stringify({body, attachment: attachment ?? null})}),
    get: (id: number) => call<{ post: Post; comments: PostComment[] }>(`/posts/${id}`),
    remove: (id: number) => call<{ deleted: boolean }>(`/posts/${id}`, {method: 'DELETE'}),
    like: (id: number, liked: boolean) => call<Post>(`/posts/${id}/like`, {method: liked ? 'POST' : 'DELETE'}),
    comment: (id: number, body: string) =>
        call<PostComment>(`/posts/${id}/comments`, {method: 'POST', body: JSON.stringify({body})}),
    removeComment: (id: number) => call<{ deleted: boolean }>(`/comments/${id}`, {method: 'DELETE'}),
};
