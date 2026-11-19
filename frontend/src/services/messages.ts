// --- FILE: frontend/src/services/messages.ts ---
// Личные сообщения (таск 30.1): переписки, отправка текста и карточки (партия, позиция, задача, урок, турнир),
// настройка «кто может мне писать» и чёрный список.
// Все запросы — к /api/v1/messages и только с входом (маршруты src/api/messages.py, правила —
// src/services/direct_messages.py, карточки-вложения — src/services/attachments.py). Новое сообщение собеседнику
// сервер доставляет ещё и по WebSocket в его открытые вкладки.

import {apiRequest} from './http';

/** Вложения личных сообщений; в ленте ещё партия библиотеки и своё достижение (таск 30.2). */
export type AttachmentKind = 'game' | 'position' | 'puzzle' | 'lesson' | 'tournament' | 'library' | 'achievement';
/** Кто может писать игроку: все, только те, на кого он подписан, никто. */
export type DmPolicy = 'all' | 'following' | 'nobody';

/**
 * Карточка вложения: вид, ссылка и снимок данных на момент отправки. Набор заполненных полей зависит от вида:
 * сервер проверяет ссылку и сам собирает снимок, клиент присылает только {kind, ref}.
 */
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

/** Одно сообщение переписки с точки зрения смотрящего (mine — отправил он сам). */
export interface DirectMessage {
    id: number;
    mine: boolean;
    body: string;
    attachment: Attachment | null;
    created_at: string | null;
    read: boolean;
    /** Придержано фильтром оскорблений до решения модератора (таск 30.3), видно только отправителю. */
    held?: boolean;
}

/** Строка списка переписок: собеседник, последнее сообщение и число непрочитанных от него. */
export interface Conversation {
    username: string;
    avatar: string | null;
    last: DirectMessage;
    unread: number;
    /** Собеседник в чёрном списке смотрящего. */
    blocked: boolean;
}

/** Переписка с игроком (GET /messages/with/{имя}): страница сообщений, старые — первыми. */
export interface Thread {
    username: string;
    avatar: string | null;
    messages: DirectMessage[];
    /** Можно ли сейчас писать; если нет — reason: код причины от сервера (текст — из каталога). */
    can_write: boolean;
    reason: string | null;
    blocked: boolean;
}

/** Настройки личных сообщений: кто может писать и имена игроков в чёрном списке. */
export interface DmSettings {
    dm_policy: DmPolicy;
    blocked: string[];
}

/** Запрос к /api/v1/messages через общую обёртку http.ts (токен, JSON, ошибки). */
const call = <T>(path: string, init: RequestInit = {}) => apiRequest<T>(`/messages${path}`, init);

const user = (name: string) => encodeURIComponent(name);

/** Эндпоинты личных сообщений. Ответы hide и markRead несут новое общее число непрочитанных — для шапки. */
export const messagesApi = {
    conversations: () => call<{ conversations: Conversation[]; unread: number }>(''),
    unread: () => call<{ unread: number }>('/unread'),
    /** beforeId — подгрузка более ранней страницы: сообщения старше указанного. */
    thread: (name: string, beforeId?: number) =>
        call<Thread>(`/with/${user(name)}${beforeId ? `?before_id=${beforeId}` : ''}`),
    /** sendAnyway — игрок настаивает после отказа фильтра (text_flagged): сообщение придерживается до модератора. */
    send: (name: string, body: string, attachment?: { kind: AttachmentKind; ref: string } | null, sendAnyway = false) =>
        call<DirectMessage>(`/with/${user(name)}`, {
            method: 'POST', body: JSON.stringify({body, attachment: attachment ?? null, send_anyway: sendAnyway}),
        }),
    /** Скрыть переписку из списка до нового сообщения собеседника (это не блокировка). */
    hide: (name: string) => call<{ unread: number }>(`/with/${user(name)}/hide`, {method: 'POST'}),
    markRead: (name: string) => call<{ unread: number }>(`/with/${user(name)}/read`, {method: 'POST'}),
    settings: () => call<DmSettings>('/settings'),
    setPolicy: (policy: DmPolicy) => call<DmSettings>('/settings', {method: 'PUT', body: JSON.stringify({dm_policy: policy})}),
    block: (name: string) => call<DmSettings>(`/block/${user(name)}`, {method: 'POST'}),
    unblock: (name: string) => call<DmSettings>(`/block/${user(name)}`, {method: 'DELETE'}),
};

/** FEN: восемь рядов доски; очередь хода и остальные поля необязательны. Точную проверку позиции делает сервер. */
const FEN_RE = /^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+(\s+[wb](\s+\S+){0,4})?$/;

/**
 * Что вставил игрок: FEN позиции или ссылку на партию библиотеки, партию, турнир, урок. Неизвестное — null (тогда
 * вид выбирают вручную). Ссылка библиотеки проверяется раньше ссылки партии: её адрес тоже содержит «/game/».
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
