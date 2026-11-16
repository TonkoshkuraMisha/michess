// Библиотека партий (таск 27.1): /api/v1/library — дерево коллекций, партии коллекции, поиск и PGN для просмотра.
// Без входа видны публичные коллекции; с токеном — ещё свои закрытые (и служебные у модераторов).

import type {CoachComment} from './coach';
import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export interface LibraryCollection {
    id: number;
    parent_id: number | null;
    name: string;
    visibility: 'public' | 'owner' | 'staff';
    games: number;
}

export interface LibraryGameRow {
    id: number;
    white: string;
    black: string;
    event: string;
    site: string;
    date: string;
    year: number | null;
    result: string;
    eco: string;
    opening: string;
    plies: number;
    /** Пешечная структура (таск 27.5) — код из STRUCTURES. */
    structure?: string | null;
}

export const STRUCTURES = ['hedgehog', 'maroczy', 'wedge', 'kid_chain', 'modern_benoni', 'stonewall', 'saw', 'french_chain',
    'french_exchange', 'carlsbad', 'hanging_pawns', 'isolated_pawn', 'spanish', 'symmetry'] as const;
export type StructureCode = typeof STRUCTURES[number];

/** «Миниатюра» (27.9): партия, закончившаяся матом; fen — позиция перед матом, answer — ход партии. */
export interface LibraryMiniature extends LibraryGameRow {
    fen: string;
    moves: string[];
    answer: string;
}

/** Вопрос «Узнай структуру» (27.9): game_id = null — учебный скелет. */
export interface StructureQuestion {
    fen: string;
    answer: StructureCode;
    options: StructureCode[];
    game_id: number | null;
    ply: number | null;
}

export interface LibraryPage {
    total: number;
    games: LibraryGameRow[];
}

export interface LibrarySearch {
    player?: string;
    eco?: string;
    year_from?: number;
    year_to?: number;
    result?: string;
    max_plies?: number;
    structure?: string;
    /** Начало партии в UCI через пробел (узел репертуара, 27.10). */
    moves?: string;
    offset?: number;
}

/** Аннотация партии (таск 27.4): комментарии наставника кодами coach.* по полуходам. */
export interface LibraryAnnotation {
    status: 'auto' | 'draft' | 'review' | 'approved';
    version: number;
    comments: Record<string, CoachComment>;
    evals: number[];
}

export const LIBRARY_PAGE = 50;

async function call<T>(path: string): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/library${path}`, {headers: token ? {Authorization: `Bearer ${token}`} : {}});
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

export function searchQuery(search: LibrarySearch): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
    }
    params.set('limit', String(LIBRARY_PAGE));
    return params.toString();
}

export const libraryApi = {
    collections: () => call<{ collections: LibraryCollection[] }>('/collections'),
    collectionGames: (id: number, offset = 0) =>
        call<LibraryPage & { id: number; name: string }>(`/collections/${id}/games?offset=${offset}&limit=${LIBRARY_PAGE}`),
    search: (search: LibrarySearch) => call<LibraryPage>(`/games?${searchQuery(search)}`),
    pgnUrl: (id: number | string) => `${API_BASE_URL}/api/v1/library/games/${id}/pgn`,
    annotation: (id: number | string) =>
        call<{ annotation: LibraryAnnotation | null }>(`/games/${id}`).then((body) => body.annotation ?? null),
    miniatures: (count: number, seed: number) =>
        call<{ miniatures: LibraryMiniature[] }>(`/miniatures?count=${count}&seed=${seed}`),
    structureQuiz: (count: number, seed: number) =>
        call<{ questions: StructureQuestion[] }>(`/structure-quiz?count=${count}&seed=${seed}`),
};

/** Дети коллекции по порядку сервера; корни — parent_id = null. */
export function childrenOf(list: LibraryCollection[], parent: number | null): LibraryCollection[] {
    return list.filter((c) => c.parent_id === parent);
}

/** Партий в коллекции вместе со всеми вложенными (для подписи узла дерева). */
export function totalGames(list: LibraryCollection[], id: number): number {
    const own = list.find((c) => c.id === id)?.games ?? 0;
    return own + childrenOf(list, id).reduce((sum, child) => sum + totalGames(list, child.id), 0);
}
