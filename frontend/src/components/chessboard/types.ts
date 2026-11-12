// --- FILE: frontend/src/components/chessboard/types.ts ---
// Типы лобби, Live-партий и чата (вынесено из Chessboard.tsx).

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

export function isChatPreset(value: unknown): value is ChatPresetId {
    return typeof value === 'string' && (QUICK_CHAT_PRESETS as readonly string[]).includes(value);
}

export interface PendingPromotion {
    from: string;
    to: string;
    color: 'w' | 'b';
    isPremove?: boolean;
}

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
 * (в отличие от «уже в партии», «вызов неактуален» и т. п.).
 */
export const GAME_ACTION_ERROR_CODES: ReadonlySet<string> = new Set([
    'rate_limited',
    'message_too_large',
    'draw_offer_too_soon',
    'chat_forbidden',
    'spectate_unavailable',
    'game_not_in_progress',
    'abort_too_late',
    'no_draw_offer',
    'no_rematch_offer',
]);
