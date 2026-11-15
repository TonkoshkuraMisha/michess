// --- FILE: frontend/src/services/moderation.ts ---
// Модерация (таск 17.4): жалобы, апелляция, очередь и решения модератора.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export type ReportReason = 'cheating' | 'abuse' | 'spam' | 'other';
export type ModerationAction = 'dismiss' | 'warn' | 'chat_ban' | 'mark_cheater' | 'clear_cheater' | 'accept';

export interface QueueItem {
    id: number;
    kind: 'player' | 'message' | 'cheat_review' | 'appeal' | 'translation';
    reason: string;
    comment: string | null;
    message_text: string | null;
    /** Для translation: «язык:ключ» и страница. */
    subject?: string | null;
    context?: string | null;
    game_id: number | null;
    created_at: string | null;
    reporter: string | null;
    target: string | null;
    target_is_cheater: boolean;
    target_trust: number | null;
    reports_on_target: number;
}

export interface ModerationMe {
    is_moderator: boolean;
    is_cheater: boolean;
    open_appeal: boolean;
    chat_banned_until: string | null;
}

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
    report: (body: { target: string; kind: 'player' | 'message'; reason: ReportReason; comment?: string; message_text?: string; game_id?: number | null }) =>
        call<{ id: number }>('/reports', {method: 'POST', body: JSON.stringify(body)}),
    suggestTranslation: (body: { language: string; key: string; current: string; suggestion: string; context: string }) =>
        call<{ id: number }>('/translations', {method: 'POST', body: JSON.stringify(body)}),
    appeal: (comment: string) => call<{ id: number }>('/appeal', {method: 'POST', body: JSON.stringify({comment})}),
    queue: () => call<{ reports: QueueItem[] }>('/queue'),
    resolve: (id: number, action: ModerationAction) =>
        call<{ id: number; action: string }>(`/reports/${id}/resolve`, {method: 'POST', body: JSON.stringify({action})}),
};
