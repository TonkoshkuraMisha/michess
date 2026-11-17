// --- FILE: frontend/src/services/messages.ts ---
// Личные сообщения (таск 30.1): переписки, отправка текста и карточки (партия, позиция, задача, урок, турнир),
// настройка «кто может мне писать» и чёрный список.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** Вложения личных сообщений; в ленте ещё партия библиотеки и своё достижение (таск 30.2). */
export type AttachmentKind = 'game' | 'position' | 'puzzle' | 'lesson' | 'tournament' | 'library' | 'achievement';
export type DmPolicy = 'all' | 'following' | 'nobody';

/** Карточка вложения: вид, ссылка и снимок данных на момент отправки. */
export interface Attachment {
    kind: AttachmentKind;
    ref: string;
    white?: string | null;
    black?: string | null;
    result?: string | null;
    status?: string | null;
    fen?: string;
    rating?: number;
    format?: string;
    size?: number;
    owner?: string | null;
    event_key?: string | null;
    career_stage?: string | null;
    year?: number | null;
    event?: string | null;
    earned_at?: string | null;
}

export interface DirectMessage {
    id: number;
    mine: boolean;
    body: string;
    attachment: Attachment | null;
    created_at: string | null;
    read: boolean;
}

export interface Conversation {
    username: string;
    avatar: string | null;
    last: DirectMessage;
    unread: number;
    blocked: boolean;
}

export interface Thread {
    username: string;
    avatar: string | null;
    messages: DirectMessage[];
    can_write: boolean;
    reason: string | null;
    blocked: boolean;
}

export interface DmSettings {
    dm_policy: DmPolicy;
    blocked: string[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/messages${path}`, {
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

export const messagesApi = {
    conversations: () => call<{ conversations: Conversation[]; unread: number }>(''),
    unread: () => call<{ unread: number }>('/unread'),
    thread: (name: string, beforeId?: number) =>
        call<Thread>(`/with/${user(name)}${beforeId ? `?before_id=${beforeId}` : ''}`),
    send: (name: string, body: string, attachment?: { kind: AttachmentKind; ref: string } | null) =>
        call<DirectMessage>(`/with/${user(name)}`, {method: 'POST', body: JSON.stringify({body, attachment: attachment ?? null})}),
    markRead: (name: string) => call<{ unread: number }>(`/with/${user(name)}/read`, {method: 'POST'}),
    settings: () => call<DmSettings>('/settings'),
    setPolicy: (policy: DmPolicy) => call<DmSettings>('/settings', {method: 'PUT', body: JSON.stringify({dm_policy: policy})}),
    block: (name: string) => call<DmSettings>(`/block/${user(name)}`, {method: 'POST'}),
    unblock: (name: string) => call<DmSettings>(`/block/${user(name)}`, {method: 'DELETE'}),
};

const FEN_RE = /^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+(\s+[wb](\s+\S+){0,4})?$/;

/**
 * Что вставил игрок: ссылку на партию, турнир, урок или FEN позиции. Неизвестное — null (тогда вид выбирают вручную).
 */
export function detectAttachment(raw: string): { kind: AttachmentKind; ref: string } | null {
    const text = raw.trim();
    if (!text) return null;
    if (FEN_RE.test(text)) return {kind: 'position', ref: text};
    const library = text.match(/\/library\/game\/(\d+)(?:[/?#]|$)/);
    if (library) return {kind: 'library', ref: library[1]};
    const game = text.match(/\/game\/(\d+)(?:[/?#]|$)/);
    if (game) return {kind: 'game', ref: game[1]};
    const tournament = text.match(/\/tournaments\/(\d+)(?:[/?#]|$)/);
    if (tournament) return {kind: 'tournament', ref: tournament[1]};
    const lesson = text.match(/\/learn\/([A-Za-z0-9_.:-]+)(?:[/?#]|$)/);
    if (lesson) return {kind: 'lesson', ref: lesson[1]};
    return null;
}

/** Куда ведёт карточка (null — карточка без страницы: позиция и задача показываются диаграммой). */
export function attachmentLink(a: Attachment): string | null {
    if (a.kind === 'game') return `/game/${a.ref}`;
    if (a.kind === 'tournament') return `/tournaments/${a.ref}`;
    if (a.kind === 'lesson') return `/learn/${a.ref}`;
    if (a.kind === 'library') return `/library/game/${a.ref}`;
    return null;
}
