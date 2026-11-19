// --- FILE: frontend/src/services/chess960.ts ---
// Шахматы Фишера против бота: GET /api/v1/chess960/new[номер] — расстановка, POST /move — ход игрока и ответ бота,
// POST /bot-move — первый ход бота за белых (src/api/chess960.py, правила — src/services/chess960.py). Сервер не хранит
// партию: позиция и ходы каждый раз присылаются целиком. Ход бота — помощь движка: во время своей партии с человеком
// сервер его не даёт (src/api/fair_play.py). Использует chess960/Chess960Page.tsx. Запрос и ошибки — http.ts.

import {apiRequest} from './http';

/** Состояние партии 960 из ответа сервера. */
export interface State960 {
    number: number;
    fen: string;
    moves: string[];
    sans: string[];
    result: string | null;
    termination: string | null;
    bot_move: string | null;
    check: boolean;
}

/** Запрос к /chess960{path}: без тела — GET (новая позиция), с телом — POST (ход или ход бота). */
export const chess960Call = (path: string, body?: object) =>
    apiRequest<State960>(`/chess960${path}`, body ? {method: 'POST', body: JSON.stringify(body)} : {});
