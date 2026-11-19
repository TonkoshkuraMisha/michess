// --- FILE: frontend/src/services/library.ts ---
// Библиотека партий (таск 27.1): /api/v1/library — дерево коллекций, партии коллекции, поиск и PGN для просмотра.
// Без входа видны публичные коллекции; с токеном — ещё свои закрытые (и служебные у модераторов).
// Маршруты — src/api/library.py, правила видимости и поиск — src/services/library.py. Отсюда же берутся данные
// тренажёров «Миниатюры» и «Узнай структуру» (/library/miniatures, /library/structure-quiz).

import type {CoachComment} from './coach';
import {apiRequest} from './http';

/** Коллекция библиотеки. Сервер отдаёт их плоским списком; дерево клиент собирает по parent_id (childrenOf). */
export interface LibraryCollection {
    id: number;
    parent_id: number | null;
    name: string;
    /** public — видна всем, owner — только владельцу, staff — служебная, только модераторам. */
    visibility: 'public' | 'owner' | 'staff';
    /** Партий непосредственно в этой коллекции, без вложенных (с вложенными — totalGames). */
    games: number;
}

/** Строка списка партий: заголовки PGN и длина партии в полуходах. */
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

/** Коды пешечных структур — те же, что размечает сервер (src/services/pawn_structures.py); названия — в каталоге. */
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

/** Страница списка партий: total — всего найдено, games — не больше LIBRARY_PAGE строк. */
export interface LibraryPage {
    total: number;
    games: LibraryGameRow[];
}

/** Фильтры поиска (GET /library/games); пустые и незаданные в запрос не попадают (searchQuery). */
export interface LibrarySearch {
    /** Часть имени игрока. */
    player?: string;
    /** Начало кода дебюта: «B9» найдёт B90–B99. */
    eco?: string;
    year_from?: number;
    year_to?: number;
    result?: string;
    max_plies?: number;
    structure?: string;
    /** Метка «миниатюра» (27.5): только решающие партии до 25 ходов. */
    miniature?: boolean;
    /** Начало партии в UCI через пробел (узел репертуара, 27.10). */
    moves?: string;
    offset?: number;
}

/** Аннотация партии (таск 27.4): комментарии наставника кодами coach.* по полуходам. */
export interface LibraryAnnotation {
    /** auto и approved сервер показывает всем, draft и review — только модераторам. */
    status: 'auto' | 'draft' | 'review' | 'approved';
    version: number;
    /** Ключ — номер полухода строкой. */
    comments: Record<string, CoachComment>;
    /** Оценки позиций по ходу партии, сохранённые вместе с аннотацией. */
    evals: number[];
}

/** Размер страницы списка партий (параметр limit запросов). */
export const LIBRARY_PAGE = 50;

/** Запрос к /api/v1/library через общую обёртку http.ts (токен, JSON, ошибки). */
const call = <T>(path: string) => apiRequest<T>(`/library${path}`);

/** Строка запроса поиска: заданные фильтры плюс limit = LIBRARY_PAGE. */
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
    /** Аннотация партии из ответа GET /library/games/{id}; null — её нет или она не для этого посетителя. */
    annotation: (id: number | string) =>
        call<{ annotation: LibraryAnnotation | null }>(`/games/${id}`).then((body) => body.annotation ?? null),
    /** seed делает набор воспроизводимым: тот же seed — те же партии и вопросы. */
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
