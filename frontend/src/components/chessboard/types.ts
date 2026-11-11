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
}

export interface ChatMessageItem {
    sender: string;
    text: string;
    timestamp: number;
}

export const QUICK_CHAT_PRESETS = [
    '👋 Удачи!',
    '🤝 Спасибо за игру!',
    '👏 Красивый ход!',
    '⏱ Цейтнот!'
];

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
]);
