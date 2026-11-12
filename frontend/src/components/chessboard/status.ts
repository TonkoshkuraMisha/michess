// --- FILE: frontend/src/components/chessboard/status.ts ---
// Строка статуса партии («Соперник предлагает ничью», «Партия окончена…»). Хранится не готовым текстом,
// а сообщением каталога с параметрами (общий тип UiMessage из i18n); параметр сам может быть сообщением
// (причина окончания, имя бота, ошибка сервера). Текст собирается при показе, поэтому смена языка переводит
// и уже показанный статус, а логика («есть ли предложение ничьей») не зависит от формулировок.

import {renderUiMessage, uiMessage} from '../../i18n';
import type {I18n, MessageKey, MessageParam, UiMessage} from '../../i18n';

export type GameStatus = UiMessage;
export type StatusParam = MessageParam;

export function status(key: MessageKey, params?: Record<string, StatusParam>): GameStatus {
    return uiMessage(key, params);
}

/** Параметр-сообщение: переводится при показе, на текущем языке. */
export function messageParam(key: MessageKey, params?: Record<string, StatusParam>): StatusParam {
    return uiMessage(key, params);
}

export function hasStatusKey(value: GameStatus | null, key: MessageKey): boolean {
    return value !== null && 'key' in value && value.key === key;
}

export function renderStatus(value: GameStatus, t: I18n['t']): string {
    return renderUiMessage(value, t);
}

const GAME_OVER_REASONS = new Set([
    'checkmate', 'stalemate', 'timeout', 'resignation', 'agreement', 'draw_agreement', 'repetition',
    '50_move_rule', 'insufficient_material', 'timeout_vs_insufficient_material', 'abandoned',
    'abandoned_vs_insufficient_material',
] as const);

type GameOverReason = typeof GAME_OVER_REASONS extends Set<infer R> ? R : never;

function isKnownReason(reason: string): reason is GameOverReason {
    return (GAME_OVER_REASONS as Set<string>).has(reason);
}

/** Итог партии: «Партия окончена. Результат: 1-0 (мат)»; отменённая на 1-м ходу — своё сообщение. */
export function describeGameOver(result: string | null | undefined, reason?: string | null): GameStatus | null {
    if (reason === 'aborted' || result === '*') return status('status.aborted');
    if (!result) return null;
    if (reason && isKnownReason(reason)) {
        return status('status.gameOverReason', {result, reason: messageParam(`status.reasons.${reason}`)});
    }
    return status('status.gameOver', {result});
}
