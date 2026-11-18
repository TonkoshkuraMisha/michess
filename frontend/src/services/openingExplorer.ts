// --- FILE: frontend/src/services/openingExplorer.ts ---
// Справочник дебютов (таск 16.2): POST /analysis/opening-explorer — ходы из позиции со статистикой партий, название
// дебюта и партии мастеров из архива. Под правилом честной игры: во время партии с человеком сервер отвечает 409.
// Маршрут — src/api/analysis.py, расчёт — src/services/opening_explorer.py: статистика берётся из индекса позиций
// сыгранных партий (таблицы position_stats и position_games), название — из открытой таблицы дебютов.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** Дебют по таблице дебютов: код ECO и английское название (имя собственное, не переводится). */
export interface ExplorerOpening {
    eco: string;
    name: string;
}

/** Ход из позиции и итоги партий, в которых он встретился. */
export interface ExplorerMove {
    uci: string;
    san: string;
    games: number;
    white_wins: number;
    draws: number;
    black_wins: number;
    /** Название дебюта после этого хода, если оно другое. */
    opening: ExplorerOpening | null;
}

/** Партия архива, прошедшая через позицию; id — для ссылки на просмотр партии. */
export interface ExplorerGame {
    id: number;
    white: string;
    black: string;
    year: string | null;
    result: string | null;
    eco: string | null;
}

/** Ответ справочника по позиции после присланных ходов. */
export interface ExplorerResult {
    fen: string;
    /** Дебют текущей позиции; null — позиции в таблице дебютов нет. */
    opening: ExplorerOpening | null;
    moves: ExplorerMove[];
    games: ExplorerGame[];
}

/** Справочник по позиции: moves — ходы от начальной позиции в UCI. Отказ сервера — UiError с текстом по коду. */
export async function exploreOpening(moves: string[]): Promise<ExplorerResult> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/analysis/opening-explorer`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
            body: JSON.stringify({moves}),
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<ExplorerResult>;
}

/** Доли побед белых, ничьих и побед чёрных в процентах (сумма — 100: ничьим достаётся остаток от округления). */
export function shares(move: Pick<ExplorerMove, 'games' | 'white_wins' | 'draws' | 'black_wins'>): [number, number, number] {
    if (!move.games) return [0, 0, 0];
    const white = Math.round((move.white_wins / move.games) * 100);
    const black = Math.round((move.black_wins / move.games) * 100);
    return [white, 100 - white - black, black];
}
