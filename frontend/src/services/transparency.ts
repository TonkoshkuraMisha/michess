// --- FILE: frontend/src/services/transparency.ts ---
// Прозрачность и открытые данные (таск 24.3): журналы калибровки ботов, сведения об открытом API и выгрузка своих
// партий одним PGN-файлом.
// Эндпоинты: GET /api/v1/bots/calibration/runs, /bots/calibration/runs/{имя} и /bots/tuning-log (src/api/bots.py),
// GET /api/v1/public (src/api/public.py) — все открыты без входа, с лимитом открытого API; свои партии —
// GET /api/v1/account/games.pgn (src/api/account.py), только с входом.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** Сведения о последней калибровке (раздел meta файла src/services/bots/calibration.json). */
export interface CalibrationMeta {
    date: string;
    games: number;
    /** Рейтинги эталонов Stockfish, с которыми играли боты, и время эталона на ход в секундах. */
    anchors?: number[];
    anchor_movetime_s?: number;
}

/** Журнал прогона калибровки: log — протокол матчей, pgn — сами партии; size — размер файла в байтах. */
export interface CalibrationRun {
    name: string;
    date: string;
    title: string;
    kind: 'log' | 'pgn';
    size: number;
}

/** Описание открытого API (GET /api/v1/public): версия, список адресов и лимит запросов. */
export interface PublicApiInfo {
    version: number;
    endpoints: string[];
    rate_limit: { requests: number; window_s: number };
}

/** GET без токена; отказ сервера — UiError с текстом по коду ошибки. */
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

/**
 * Журнал подстройки характера самоигрой (таск 32.3, таблица bot_tuning_log): что измерено (measured) против
 * заявленной силы (target) и как сдвинуты ползунки силы — пары «было, стало».
 */
export interface TuningEntry {
    key: string;
    created_at: string | null;
    games: number;
    measured: number;
    target: number;
    randomness: [number, number];
    blunder_guard_cp: [number, number];
}

/** Журнал и правила подстройки: сколько партий в замере (games) и порог расхождения (drift). */
export interface TuningLog {
    entries: TuningEntry[];
    rules: { games: number; drift: number };
}

/** Прямая ссылка на файл журнала прогона — для скачивания. */
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

/**
 * Все свои завершённые партии одним PGN; возвращает число партий (0 — выгружать нечего, файл не создаётся).
 * Число сервер сообщает заголовком X-Total-Count; если заголовка нет — считается по тегам [Event в тексте.
 */
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
    saveTextFile(text, `regence-${username ?? 'games'}.pgn`, 'application/x-chess-pgn');
    return total || text.split('[Event ').length - 1;
}
