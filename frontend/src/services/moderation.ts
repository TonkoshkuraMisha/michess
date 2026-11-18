// --- FILE: frontend/src/services/moderation.ts ---
// Модерация (таск 17.4): жалобы, апелляция, очередь и решения модератора.
// Все запросы — к /api/v1/moderation и только с входом (маршруты src/api/moderation.py, правила —
// src/services/moderation.py). Очередь и решения сервер отдаёт только модератору; автоматика лишь ставит заявки.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** Причина жалобы: нечестная игра, оскорбления, спам, другое (REASONS на сервере). */
export type ReportReason = 'cheating' | 'abuse' | 'spam' | 'other';
/**
 * Решение модератора (ACTIONS на сервере): dismiss — отклонить; warn — предупреждение; chat_ban — отключить чат
 * на сутки; mark_cheater / clear_cheater — подтвердить или снять флаг нечестной игры; accept — принять (правку
 * перевода); hide — убрать текст; release — выпустить придержанное фильтром.
 */
export type ModerationAction = 'dismiss' | 'warn' | 'chat_ban' | 'mark_cheater' | 'clear_cheater' | 'accept' | 'hide' | 'release';

/** Заявка в очереди модератора (GET /moderation/queue). */
export interface QueueItem {
    id: number;
    /**
     * player и message — жалоба на игрока или сообщение чата партии; cheat_review — проверка флага античита;
     * appeal — апелляция; translation — правка перевода; content — жалоба на личное сообщение, публикацию или
     * комментарий; held — текст, придержанный фильтром.
     */
    kind: 'player' | 'message' | 'cheat_review' | 'appeal' | 'translation' | 'content' | 'held';
    reason: string;
    comment: string | null;
    /** Копия текста, на который жалуются (сохраняется в момент жалобы). */
    message_text: string | null;
    /** Для translation: «язык:ключ» и страница. */
    subject?: string | null;
    context?: string | null;
    game_id: number | null;
    created_at: string | null;
    reporter: string | null;
    target: string | null;
    /** Сведения об игроке, на которого заявка: флаг античита, фактор доверия (users.trust_factor), число жалоб. */
    target_is_cheater: boolean;
    target_trust: number | null;
    reports_on_target: number;
}

/** Состояние самого игрока (GET /moderation/me): роль, флаг нечестной игры, открытая апелляция, запрет чата. */
export interface ModerationMe {
    is_moderator: boolean;
    is_cheater: boolean;
    open_appeal: boolean;
    /** До какого момента отключён чат (ISO); null — чат не отключён. */
    chat_banned_until: string | null;
}

/** Запрос к /api/v1/moderation с токеном; отказ сервера — UiError с текстом по коду ошибки. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/moderation${path}`, {
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

export const moderationApi = {
    me: () => call<ModerationMe>('/me'),
    /** Жалоба на игрока или на сообщение в чате партии (message_text — копия сообщения). */
    report: (body: { target: string; kind: 'player' | 'message'; reason: ReportReason; comment?: string; message_text?: string; game_id?: number | null }) =>
        call<{ id: number }>('/reports', {method: 'POST', body: JSON.stringify(body)}),
    /** Правка перевода из режима «помощник перевода»: ключ каталога, текущий текст и предложенный. */
    suggestTranslation: (body: { language: string; key: string; current: string; suggestion: string; context: string }) =>
        call<{ id: number }>('/translations', {method: 'POST', body: JSON.stringify(body)}),
    /** Апелляция на флаг нечестной игры (одна открытая на игрока). */
    appeal: (comment: string) => call<{ id: number }>('/appeal', {method: 'POST', body: JSON.stringify({comment})}),
    queue: () => call<{ reports: QueueItem[] }>('/queue'),
    /** Жалоба на сообщение, публикацию или комментарий (таск 30.3): subject — «dm:12», «post:5», «comment:7». */
    reportText: (subject: string, reason: ReportReason) =>
        call<{ id: number }>('/reports/text', {method: 'POST', body: JSON.stringify({subject, reason})}),
    resolve: (id: number, action: ModerationAction) =>
        call<{ id: number; action: string }>(`/reports/${id}/resolve`, {method: 'POST', body: JSON.stringify({action})}),
};
