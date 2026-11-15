// --- FILE: frontend/src/services/tools.ts ---
// «Найти мат» (таск 16.4): POST /analysis/find-mate — движок под правилом честной игры.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export interface MateResult {
    found: boolean;
    mate_in: number | null;
    line: string[];
    san: string[];
}

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
