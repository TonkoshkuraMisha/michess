// --- FILE: frontend/src/services/miniGames.ts ---
// Мини-игры тренера (пешечные бои и т. п.): ход игрока и первый ход бота за белых.
// Эндпоинты POST /api/v1/mini-games/{игра}/move и /bot-first (src/api/mini_games.py, правила — src/services/mini_games.py);
// работают без входа. Использует MiniGames.tsx. Запрос и ошибки — apiRequest (http.ts). Комнаты «по сети» — miniGameRooms.ts.

import {apiRequest} from './http';

/** Ответ сервера на ход: новая позиция, итог (1-0, 0-1, 1/2-1/2 или null) и ответный ход бота (uci), если он был. */
export interface MoveReply {
    fen: string;
    result: string | null;
    bot_move: string | null;
}

/** POST на /api/v1/mini-games{path}; отказ сервера — UiError с кодом ошибки. */
export const postMiniGame = (path: string, body: object) =>
    apiRequest<MoveReply>(`/mini-games${path}`, {method: 'POST', body: JSON.stringify(body)});
