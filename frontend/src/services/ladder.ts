// --- FILE: frontend/src/services/ladder.ts ---
// Клубная лестница (партии с ботами по ступеням): GET /api/v1/bots/ladder — рейтинг лестницы и ступени,
// POST /bots/ladder/start — соперник текущей ступени и цвет (src/api/ladder.py, правила — src/services/ladder.py).
// Только со входом. Используют chessboard/LadderPanel.tsx (вкладка лестницы) и Chessboard.tsx (старт партии).
// Запрос и ошибки — apiRequest (http.ts).

import type {LadderOutcome} from '../components/chessboard/hooks/useBotGame';
import {apiRequest} from './http';
import type {PersonalityConfig} from './personalities';

/** Ступень лестницы из ответа GET /bots/ladder. */
export interface Rung {
    key: string;
    kind: 'historical' | 'archetype';
    /** id бота или архетипа — имя на языке игрока берётся из каталога. */
    id: string;
    rating: number;
    measured: boolean;
    /** skipped — слабее текущей, но не пройдена: соперник добавлен в лестницу ниже уже пройденного (сервер, ladder.py). */
    status: 'beaten' | 'current' | 'skipped' | 'locked';
}

/** Ответ GET /bots/ladder: рейтинг лестницы, номер текущей ступени (с нуля), все ступени. */
export interface LadderState {
    rating: number;
    games: number;
    step: number;
    total: number;
    rungs: Rung[];
    active_opponent: string | null;
}

/** Соперник ступени: исторический бот (bot_id) или архетип мастерской (config — его ползунки). */
export interface LadderOpponent {
    key: string;
    kind: 'historical' | 'archetype';
    id: string;
    rating: number;
    bot_id: string | null;
    config: PersonalityConfig | null;
}

/** Ответ POST /bots/ladder/start: с кем и каким цветом играть. */
export interface LadderStart {
    opponent: LadderOpponent;
    color: 'white' | 'black';
    step: number;
    /** Итог прежней партии лестницы, начатой и брошенной: сервер засчитал её поражением. */
    forfeited: LadderOutcome | null;
}

export const ladderApi = {
    state: () => apiRequest<LadderState>('/bots/ladder', {}, 'ladder.loadFailed'),
    /** Начать партию текущей ступени; random — цвет выбирает сервер. */
    start: (color: 'white' | 'black' | 'random') =>
        apiRequest<LadderStart>('/bots/ladder/start', {method: 'POST', body: JSON.stringify({color})}, 'ladder.startFailed'),
};
