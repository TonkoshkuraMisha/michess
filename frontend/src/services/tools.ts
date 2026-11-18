// --- FILE: frontend/src/services/tools.ts ---
// «Найти мат» (таск 16.4): POST /analysis/find-mate — движок под правилом честной игры.
// Маршрут — src/api/analysis.py, поиск — src/services/mate_finder.py (Stockfish через пул, с лимитом времени).
// Во время партии с человеком сервер отвечает отказом; занятый пул движка — тоже отказ с кодом.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** Итог поиска мата: найден ли, за сколько ходов и линия мата — в UCI (line) и в SAN (san). */
export interface MateResult {
    found: boolean;
    mate_in: number | null;
    line: string[];
    san: string[];
}

/** Искать в позиции fen мат не длиннее moves ходов. Отказ сервера — UiError с текстом по коду ошибки. */
export async function findMate(fen: string, moves: number): Promise<MateResult> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/analysis/find-mate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
            body: JSON.stringify({fen, moves}),
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<MateResult>;
}
