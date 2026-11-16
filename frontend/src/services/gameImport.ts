// Импорт партий с lichess, chess.com и из PGN (таск 24.1): /api/v1/imports. Только с входом — партии привязаны к
// игроку; после импорта сервер сам разбирает их в фоне и делает задачи «Мои ошибки» из промахов игрока.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export type ImportSource = 'lichess' | 'chesscom';
export type ImportedSource = ImportSource | 'pgn';
export type ImportSpeed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily';

export interface ImportedGameView {
    id: number;
    source: ImportedSource;
    color: 'white' | 'black';
    white: string;
    black: string;
    white_rating: number | null;
    black_rating: number | null;
    result: string;
    speed: ImportSpeed | null;
    played_at: string | null;
    analyzed: boolean;
    puzzles: number;
}

export interface ImportResult {
    added: ImportedGameView[];
    duplicates: number;
    skipped: number;
}

export interface ImportedList {
    total: number;
    max: number;
    games: ImportedGameView[];
}

export const IMPORT_PAGE = 20;
export const IMPORT_COUNTS = [5, 10, 20] as const;
const BASE = `${API_BASE_URL}/api/v1/imports`;

function authHeaders(json = false): Record<string, string> {
    const token = getToken();
    return {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(json ? {'Content-Type': 'application/json'} : {})};
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${BASE}${path}`, {...init, headers: authHeaders(Boolean(init.body))});
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

export const importApi = {
    fetchSite: (source: ImportSource, username: string, max: number) =>
        call<ImportResult>('/fetch', {method: 'POST', body: JSON.stringify({source, username, max})}),
    pastePgn: (pgn: string, player: string, max: number) =>
        call<ImportResult>('/pgn', {method: 'POST', body: JSON.stringify({pgn, player, max})}),
    list: (offset = 0) => call<ImportedList>(`/games?offset=${offset}&limit=${IMPORT_PAGE}`),
    game: (id: number | string) => call<ImportedGameView & { puzzle_plies: number[] }>(`/games/${id}`),
    remove: (id: number) => call<void>(`/games/${id}`, {method: 'DELETE'}),
    pgnUrl: (id: number | string) => `${BASE}/games/${id}/pgn`,
    analysisUrl: (id: number | string) => `${BASE}/games/${id}/analysis`,
    headers: () => authHeaders(),
};

/** Соперник и итог с точки зрения игрока: win / loss / draw / unknown. */
export function outcome(game: ImportedGameView): 'win' | 'loss' | 'draw' | 'unknown' {
    if (game.result === '1/2-1/2') return 'draw';
    if (game.result === '1-0') return game.color === 'white' ? 'win' : 'loss';
    if (game.result === '0-1') return game.color === 'black' ? 'win' : 'loss';
    return 'unknown';
}

export function opponentOf(game: ImportedGameView): { name: string; rating: number | null } {
    return game.color === 'white'
        ? {name: game.black, rating: game.black_rating}
        : {name: game.white, rating: game.white_rating};
}

// Ник на сайте запоминается в браузере — удобство, не данные: без него всё работает.
const NICK_KEY = 'michess_import_nick';

export function savedNick(source: ImportSource): string {
    try {
        return localStorage.getItem(`${NICK_KEY}_${source}`) ?? '';
    } catch {
        return '';
    }
}

export function rememberNick(source: ImportSource, nick: string): void {
    try {
        localStorage.setItem(`${NICK_KEY}_${source}`, nick);
    } catch {
        // приватный режим — без запоминания
    }
}
