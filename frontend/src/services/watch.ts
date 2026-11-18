// --- FILE: frontend/src/services/watch.ts ---
// «Просмотр» (таск 16.3): идущие партии (/profile/games/live), архив мастеров с фильтрами, «Партия дня» и «забавные
// подборки» (/watch/*).
// Маршруты — src/api/watch.py и src/api/profile.py (идущие партии); всё открыто без входа. Архив — исторические
// партии мастеров, загруженные из PGN (src/db/seed.py); подборки заранее считает scripts/build_collections.py
// (таблица collection_entries), сервер их только отдаёт.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import type {LiveGameItem} from '../components/chessboard/types';

/** Партия архива мастеров в списке: игроки, год, место, результат и код дебюта. */
export interface ArchiveGame {
    id: number;
    white: string;
    black: string;
    year: string | null;
    site: string | null;
    result: string | null;
    eco: string | null;
}

/** Фильтры архива (GET /watch/archive): часть имени игрока, годы, код дебюта, результат и смещение страницы. */
export interface ArchiveFilters {
    player?: string;
    year_from?: number;
    year_to?: number;
    eco?: string;
    result?: '1-0' | '0-1' | '1/2-1/2';
    offset?: number;
}

/** Ключи «забавных подборок» — те же, что на сервере (src/services/collections.py); названия — в каталоге. */
export const COLLECTIONS = ['shortest', 'checks', 'capture_streak', 'peaceful', 'promotions', 'pawn_wars', 'stalemates'] as const;
export type CollectionKey = typeof COLLECTIONS[number];

/** GET к /api/v1 без токена; отказ сервера — UiError с текстом по коду ошибки. */
async function get<T>(path: string): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1${path}`);
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

/** Размер страницы архива (параметр limit). */
export const PAGE_SIZE = 20;

export const watchApi = {
    /** Партии между людьми, идущие прямо сейчас. */
    live: () => get<LiveGameItem[]>('/profile/games/live'),
    archive: (filters: ArchiveFilters) => {
        const params = new URLSearchParams({limit: String(PAGE_SIZE)});
        for (const [key, value] of Object.entries(filters)) {
            if (value !== undefined && value !== '' && value !== null) params.set(key, String(value));
        }
        return get<{ total: number; items: ArchiveGame[] }>(`/watch/archive?${params}`);
    },
    /** «Партия дня» — одна на всех: результативная партия архива, выбранная по дате; null — архив пуст. */
    gameOfTheDay: () => get<{ date?: string; game: ArchiveGame | null }>('/watch/game-of-the-day'),
    /** Подборки: партии по местам, value — показатель подборки (число шахов, длина партии и т. п.). */
    collections: () => get<{ collections: Record<CollectionKey, (ArchiveGame & { value: number })[]> }>('/watch/collections'),
};
