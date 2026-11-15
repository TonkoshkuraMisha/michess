// --- FILE: frontend/src/services/watch.ts ---
// «Просмотр» (таск 16.3): идущие партии (/profile/games/live), архив мастеров с фильтрами, «Партия дня» и «забавные
// подборки» (/watch/*).

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import type {LiveGameItem} from '../components/chessboard/types';

export interface ArchiveGame {
    id: number;
    white: string;
    black: string;
    year: string | null;
    site: string | null;
    result: string | null;
    eco: string | null;
}

export interface ArchiveFilters {
    player?: string;
    year_from?: number;
    year_to?: number;
    eco?: string;
    result?: '1-0' | '0-1' | '1/2-1/2';
    offset?: number;
}

export const COLLECTIONS = ['shortest', 'checks', 'capture_streak', 'peaceful', 'promotions', 'pawn_wars', 'stalemates'] as const;
export type CollectionKey = typeof COLLECTIONS[number];

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

export const PAGE_SIZE = 20;

export const watchApi = {
    live: () => get<LiveGameItem[]>('/profile/games/live'),
    archive: (filters: ArchiveFilters) => {
        const params = new URLSearchParams({limit: String(PAGE_SIZE)});
        for (const [key, value] of Object.entries(filters)) {
            if (value !== undefined && value !== '' && value !== null) params.set(key, String(value));
        }
        return get<{ total: number; items: ArchiveGame[] }>(`/watch/archive?${params}`);
    },
    gameOfTheDay: () => get<{ date?: string; game: ArchiveGame | null }>('/watch/game-of-the-day'),
    collections: () => get<{ collections: Record<CollectionKey, (ArchiveGame & { value: number })[]> }>('/watch/collections'),
};
