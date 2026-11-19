// --- FILE: frontend/src/services/tools.ts ---
// «Найти мат» (таск 16.4): POST /analysis/find-mate — движок под правилом честной игры.
// Маршрут — src/api/analysis.py, поиск — src/services/mate_finder.py (Stockfish через пул, с лимитом времени).
// Во время партии с человеком сервер отвечает отказом; занятый пул движка — тоже отказ с кодом.

import {apiRequest} from './http';

/** Итог поиска мата: найден ли, за сколько ходов и линия мата — в UCI (line) и в SAN (san). */
export interface MateResult {
    found: boolean;
    mate_in: number | null;
    line: string[];
    san: string[];
}

/** Искать в позиции fen мат не длиннее moves ходов. Отказ сервера — UiError с текстом по коду ошибки. */
export function findMate(fen: string, moves: number): Promise<MateResult> {
    return apiRequest<MateResult>('/analysis/find-mate', {method: 'POST', body: JSON.stringify({fen, moves})});
}
