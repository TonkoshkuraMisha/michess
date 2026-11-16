// --- FILE: frontend/src/services/guess.ts ---
// «Угадай ход мастера» (таск 14.3): позиции из партий мастеров, отобранные движком (src/api/guess.py).

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';
import type {CoachComment} from './coach';

export interface GuessPosition {
    id: number;
    game_id: number;
    ply: number;
    fen: string;
    side: 'white' | 'black';
    move_number: number;
    difficulty: number;
    series_id: number | null;
    series_index: number;
    series_length: number;
    white: string;
    black: string;
    event: string | null;
    date: string | null;
    previous: string[];
    first_previous_ply: number;
    last_move: string | null;
}

export interface GuessAnswer extends CoachComment {
    score: number;
    loss_cp: number;
    master_move: string;
    master_san: string;
    lines: { uci: string; san: string; cp: number }[];
    /** Коды тем реестра 13.0 (themes.<код>.name); пусто — темы не определены. */
    themes?: string[];
    next_id: number | null;
}

const BASE = `${API_BASE_URL}/api/v1/guess`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${BASE}${path}`, {
            ...init,
            headers: {
                ...(init.body ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

export const guessApi = {
    next: (series: boolean) => request<{ position: GuessPosition | null }>(`/next${series ? '?series=true' : ''}`),
    position: (id: number) => request<GuessPosition>(`/position/${id}`),
    answer: (id: number, move: string) => request<GuessAnswer>(`/position/${id}/answer`, {
        method: 'POST', body: JSON.stringify({move}),
    }),
    /** Партии с отобранными моментами: {id партии: id первой позиции}. */
    ofGames: (gameIds: number[]) => request<{ games: Record<string, number> }>(`/games?ids=${gameIds.join(',')}`),
    ofGame: (gameId: number) => request<{ positions: { id: number; ply: number; series_id: number | null }[] }>(`/game/${gameId}`),
};

/** «Точность понимания» сессии: набранные баллы от возможных. */
export function understanding(scores: number[]): number | null {
    return scores.length ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null;
}
