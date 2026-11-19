// --- FILE: frontend/src/services/gameImport.ts ---
// Импорт партий с lichess, chess.com и из PGN (таск 24.1): /api/v1/imports. Только с входом — партии привязаны к
// игроку; после импорта сервер сам разбирает их в фоне и делает задачи «Мои ошибки» из промахов игрока.
// Маршруты — src/api/game_import.py, правила — src/services/game_import.py. Импорт и разбор сервер закрывает на
// время партии с человеком (честная игра): иначе в «импорт» можно было бы вставить идущую партию и получить оценку.

import {apiRequest} from './http';

/** Сайт, с которого партии берутся по нику. */
export type ImportSource = 'lichess' | 'chesscom';
/** Откуда партия попала в список: с сайта или из вставленного PGN. */
export type ImportedSource = ImportSource | 'pgn';
export type ImportSpeed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily';

/** Импортированная партия в списке (game_import.view на сервере). */
export interface ImportedGameView {
    id: number;
    source: ImportedSource;
    /** Каким цветом играл сам игрок: по нику на сайте или по имени в заголовках PGN. */
    color: 'white' | 'black';
    white: string;
    black: string;
    white_rating: number | null;
    black_rating: number | null;
    result: string;
    speed: ImportSpeed | null;
    played_at: string | null;
    /** Разбор движком уже готов. */
    analyzed: boolean;
    /** Сколько задач «Мои ошибки» сделано из этой партии. */
    puzzles: number;
}

/** Итог одного импорта: что добавлено, сколько партий уже было и сколько пропущено как непригодные. */
export interface ImportResult {
    added: ImportedGameView[];
    duplicates: number;
    skipped: number;
}

/** Страница списка: total — всего партий у игрока, max — предел хранения (настройка GAME_IMPORT_MAX_STORED). */
export interface ImportedList {
    total: number;
    max: number;
    games: ImportedGameView[];
}

/** Размер страницы списка импортированных партий. */
export const IMPORT_PAGE = 20;
/** Сколько последних партий можно запросить за один импорт (выбор в форме). */
export const IMPORT_COUNTS = [5, 10, 20] as const;
const call = <T>(path: string, init: RequestInit = {}) => apiRequest<T>(`/imports${path}`, init);

/** Эндпоинты импорта; все требуют входа. */
export const importApi = {
    /** Последние партии игрока с сайта по нику (сервер сам обращается к открытому API сайта). */
    fetchSite: (source: ImportSource, username: string, max: number) =>
        call<ImportResult>('/fetch', {method: 'POST', body: JSON.stringify({source, username, max})}),
    /** Партии из вставленного PGN; player — имя игрока в заголовках, по нему определяется его цвет. */
    pastePgn: (pgn: string, player: string, max: number) =>
        call<ImportResult>('/pgn', {method: 'POST', body: JSON.stringify({pgn, player, max})}),
    list: (offset = 0) => call<ImportedList>(`/games?offset=${offset}&limit=${IMPORT_PAGE}`),
    /** Одна партия; puzzle_plies — полуходы, из которых сделаны задачи «Мои ошибки». */
    game: (id: number | string) => call<ImportedGameView & { puzzle_plies: number[] }>(`/games/${id}`),
    remove: (id: number) => call<void>(`/games/${id}`, {method: 'DELETE'}),
};

/** Итог с точки зрения игрока: win / loss / draw; unknown — результат в партии не записан («*»). */
export function outcome(game: ImportedGameView): 'win' | 'loss' | 'draw' | 'unknown' {
    if (game.result === '1/2-1/2') return 'draw';
    if (game.result === '1-0') return game.color === 'white' ? 'win' : 'loss';
    if (game.result === '0-1') return game.color === 'black' ? 'win' : 'loss';
    return 'unknown';
}

/** Соперник игрока в импортированной партии: имя и рейтинг той стороны, за которую играл не он. */
export function opponentOf(game: ImportedGameView): { name: string; rating: number | null } {
    return game.color === 'white'
        ? {name: game.black, rating: game.black_rating}
        : {name: game.white, rating: game.white_rating};
}

// Ник на сайте запоминается в браузере — удобство, не данные: без него всё работает.
// Ключи localStorage: regence_import_nick_lichess и regence_import_nick_chesscom.
const NICK_KEY = 'regence_import_nick';

/** Ник, с которым игрок импортировал партии с этого сайта в прошлый раз; пусто — не запомнен. */
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
