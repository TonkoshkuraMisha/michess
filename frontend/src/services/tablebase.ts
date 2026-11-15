// --- FILE: frontend/src/services/tablebase.ts ---
// Эндшпильные таблицы (таск 14.4): POST /analysis/tablebase — результат позиции для стороны, которая ходит, и её
// лучший ход (им отвечает идеальный защитник). Под правилом честной игры.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export interface TablebaseMove {
    uci: string;
    san: string;
    category: string | null;
    dtm: number | null;
    dtz: number | null;
}

export interface TablebaseProbe {
    /** win | loss | draw | cursed-win | blessed-loss | maybe-win | maybe-loss | unknown — для стороны, которая ходит. */
    category: string | null;
    dtm: number | null;
    dtz: number | null;
    best: TablebaseMove | null;
}

export async function probeTablebase(fen: string): Promise<TablebaseProbe> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/analysis/tablebase`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
            body: JSON.stringify({fen}),
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<TablebaseProbe>;
}
