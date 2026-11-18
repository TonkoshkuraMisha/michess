// --- FILE: frontend/src/components/chessboard/types.ts ---
// Типы лобби, Live-партий и чата (вынесено из Chessboard.tsx). Откуда приходят данные: списки лобби и идущих
// партий — опрос по HTTP раз в 1,5 с (GET /profile/matchmaking/queue и /profile/games/live, хук useGameSocket),
// сообщения чата — событие WebSocket chat_message.

/** Идущая партия между людьми в списке «Live» (строка ответа GET /profile/games/live). */
export interface LiveGameItem {
    game_id: number;
    white_username: string;
    white_rating: number;
    black_username: string;
    black_rating: number;
    base_time_ms: number;
    increment_ms: number;
    spectators_count: number;
    /** false — товарищеская партия (без рейтинга). */
    is_rated?: boolean;
}

/** Сообщение чата партии, как оно хранится на клиенте (собирается из события chat_message). */
export interface ChatMessageItem {
    sender: string;
    /** Текст, набранный игроком; у быстрой фразы пуст — её текст берётся из каталога по коду. */
    text: string;
    preset?: ChatPresetId;
    timestamp: number;
}

/** Коды быстрых фраз — тот же список, что CHAT_PRESETS на сервере (src/api/websockets.py). */
export const QUICK_CHAT_PRESETS = ['good_luck', 'thanks', 'nice_move', 'time_trouble'] as const;

export type ChatPresetId = typeof QUICK_CHAT_PRESETS[number];

/** Проверка кода быстрой фразы из события сервера: незнакомый код не показывается как фраза. */
export function isChatPreset(value: unknown): value is ChatPresetId {
    return typeof value === 'string' && (QUICK_CHAT_PRESETS as readonly string[]).includes(value);
}

/** Ход пешки на последнюю горизонталь, который ждёт выбора фигуры; isPremove — превращение задано предходом. */
export interface PendingPromotion {
    from: string;
    to: string;
    color: 'w' | 'b';
    isPremove?: boolean;
}

/** Открытый вызов в лобби (строка ответа GET /profile/matchmaking/queue). */
export interface QueuePlayer {
    user_id: number;
    username: string;
    rating: number;
    base_time_ms: number;
    increment_ms: number;
    /** false — вызов на товарищескую партию. */
    rated?: boolean;
}

/**
 * Коды ошибок сервера, не связанные с матчмейкингом: они не должны сбрасывать поиск соперника
 * (в отличие от «уже в партии», «вызов неактуален» и т. п.). Коды — из реестра src/core/errors.py, приходят
 * в событии WebSocket error; разбирает их handleServerError в useGameSocket.
 */
export const GAME_ACTION_ERROR_CODES: ReadonlySet<string> = new Set([
    'rate_limited',
    'message_too_large',
    'draw_offer_too_soon',
    'chat_forbidden',
    'spectate_unavailable',
    'game_not_in_progress',
    'abort_too_late',
    'berserk_unavailable',
    'berserk_too_late',
    'no_draw_offer',
    'no_rematch_offer',
]);
