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

export interface QueuePlayer {
    user_id: number;
    username: string;
    rating: number;
    base_time_ms: number;
    increment_ms: number;
}
