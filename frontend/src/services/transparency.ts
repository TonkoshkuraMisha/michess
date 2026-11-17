// Прозрачность и открытые данные (таск 24.3): журналы калибровки ботов, сведения об открытом API и выгрузка своих
// партий одним PGN-файлом.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export interface CalibrationMeta {
    date: string;
    games: number;
    anchors?: number[];
    anchor_movetime_s?: number;
}

export interface CalibrationRun {
    name: string;
    date: string;
    title: string;
    kind: 'log' | 'pgn';
    size: number;
}

export interface PublicApiInfo {
    version: number;
    endpoints: string[];
    rate_limit: { requests: number; window_s: number };
}

async function get(path: string): Promise<Response> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}${path}`);
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res;
}

/** Журнал подстройки характера самоигрой (таск 32.3). */
export interface TuningEntry {
    key: string;
    created_at: string | null;
    games: number;
    measured: number;
    target: number;
    randomness: [number, number];
    blunder_guard_cp: [number, number];
}

export interface TuningLog {
    entries: TuningEntry[];
    rules: { games: number; drift: number };
}

export const runUrl = (name: string) => `${API_BASE_URL}/api/v1/bots/calibration/runs/${encodeURIComponent(name)}`;

export const transparencyApi = {
    runs: async () => (await get('/api/v1/bots/calibration/runs')).json() as Promise<{ calibration: CalibrationMeta | null; runs: CalibrationRun[] }>,
    runText: async (name: string) => (await get(`/api/v1/bots/calibration/runs/${encodeURIComponent(name)}`)).text(),
    publicApi: async () => (await get('/api/v1/public')).json() as Promise<PublicApiInfo>,
    tuningLog: async () => (await get('/api/v1/bots/tuning-log')).json() as Promise<TuningLog>,
};

/** Сохранить текст файлом (ссылка-однодневка: CSP разрешает blob:). */
export function saveTextFile(text: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

/** Все свои завершённые партии одним PGN; возвращает число партий (0 — выгружать нечего, файл не создаётся). */
export async function downloadMyGamesPgn(username: string | null): Promise<number> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/account/games.pgn`, {headers: token ? {Authorization: `Bearer ${token}`} : {}});
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'settings.exportFailed'));
    const text = await res.text();
    const total = Number(res.headers.get('X-Total-Count') ?? 0);
    if (!text.trim()) return 0;
    saveTextFile(text, `michess-${username ?? 'games'}.pgn`, 'application/x-chess-pgn');
    return total || text.split('[Event ').length - 1;
}
