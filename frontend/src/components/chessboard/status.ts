// --- FILE: frontend/src/components/chessboard/status.ts ---
// Строка статуса партии («Соперник предлагает ничью», «Партия окончена…»). Хранится не готовым текстом,
// а ключом каталога с параметрами; параметр сам может быть ключом (причина окончания, имя бота). Текст
// собирается при показе, поэтому смена языка переводит и уже показанный статус, а логика («есть ли
// предложение ничьей») не зависит от формулировок.

import type {I18n, MessageKey} from '../../i18n';

/** Параметр: готовое значение или сообщение каталога (с параметрами, в том числе вложенными). */
export type StatusParam = string | number | { key: MessageKey; params?: Record<string, StatusParam> };

export type GameStatus =
    | { key: MessageKey; params?: Record<string, StatusParam> }
    /** Текст, пришедший с сервера как есть (до таска 11.0b, где сервер отдаёт коды). */
    | { text: string };

export function status(key: MessageKey, params?: Record<string, StatusParam>): GameStatus {
    return params ? {key, params} : {key};
}

/** Параметр-ключ: переводится при показе, на текущем языке. */
export function messageParam(key: MessageKey, params?: Record<string, StatusParam>): StatusParam {
    return params ? {key, params} : {key};
}

export function hasStatusKey(value: GameStatus | null, key: MessageKey): boolean {
    return value !== null && 'key' in value && value.key === key;
}

function renderMessage(key: MessageKey, params: Record<string, StatusParam> | undefined, t: I18n['t']): string {
    if (!params) return t(key);
    const rendered: Record<string, string | number> = {};
    for (const [name, param] of Object.entries(params)) {
        rendered[name] = typeof param === 'object' ? renderMessage(param.key, param.params, t) : param;
    }
    return t(key, rendered);
}

export function renderStatus(value: GameStatus, t: I18n['t']): string {
    return 'text' in value ? value.text : renderMessage(value.key, value.params, t);
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
