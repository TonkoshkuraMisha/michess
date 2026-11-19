// --- FILE: frontend/src/services/guess.ts ---
// «Угадай ход мастера» (таск 14.3): позиции из партий мастеров, отобранные движком (src/api/guess.py).
// Все запросы — к /api/v1/guess, доступны и гостю. Баллы за ответ считает сервер (src/services/guess.py) по
// сохранённым при отборе строкам движка — сам движок при ответе не запускается.

import type {CoachComment} from './coach';
import {apiRequest} from './http';

/** Позиция для угадывания. Ход мастера в ней не передаётся — он приходит только в ответе (GuessAnswer). */
/** Вариант хода в режиме «выбор из вариантов». */
export interface GuessCandidate {
    uci: string;
    san: string;
}

export interface GuessPosition {
    id: number;
    /** Варианты на выбор (ход мастера среди них) — только если их попросили (режим для начинающих). */
    candidates?: GuessCandidate[];
    /** Партия архива и номер полухода мастера с нуля (столько полуходов сыграно до позиции). */
    game_id: number;
    ply: number;
    fen: string;
    /** Чей ход — за эту сторону игрок и угадывает. */
    side: 'white' | 'black';
    move_number: number;
    /** Сложность — рейтинг позиции: меняется от ответов вошедших игроков, как рейтинг задачи. */
    difficulty: number;
    /** Серия — несколько моментов одной партии подряд; null — одиночная позиция. */
    series_id: number | null;
    series_index: number;
    series_length: number;
    white: string;
    black: string;
    event: string | null;
    /** Только год партии («1927») из заголовка Date. */
    date: string | null;
    /** Последние ходы партии перед позицией (SAN) и номер полухода первого из них — для ленты ходов. */
    previous: string[];
    first_previous_ply: number;
    last_move: string | null;
}

/** Ответ сервера на ход игрока: баллы, ход мастера, строки движка и объяснение наставника (поля CoachComment). */
export interface GuessAnswer extends CoachComment {
    /** Баллы 0–100: ход мастера — 100, почти равноценный лучшему — 80, дальше — по потере в сантипешках. */
    score: number;
    loss_cp: number;
    master_move: string;
    master_san: string;
    /** До трёх лучших ходов движка с оценкой в сантипешках. */
    lines: { uci: string; san: string; cp: number }[];
    /** Коды тем реестра 13.0 (themes.<код>.name); пусто — темы не определены. */
    themes?: string[];
    /** Следующая позиция той же серии; null — серия закончилась или позиция одиночная. */
    next_id: number | null;
}

const request = <T>(path: string, init: RequestInit = {}) => apiRequest<T>(`/guess${path}`, init);

export const guessApi = {
    /** Следующая позиция около силы игрока (гостю — около 1500); null — позиции ещё не отобраны. */
    next: (series: boolean, candidates = false) =>
        request<{ position: GuessPosition | null }>(`/next?${new URLSearchParams({series: String(series), candidates: String(candidates)})}`),
    /** Позиция по id; candidates — с вариантами на выбор. */
    position: (id: number, candidates = false) => request<GuessPosition>(`/position/${id}${candidates ? '?candidates=true' : ''}`),
    answer: (id: number, move: string) => request<GuessAnswer>(`/position/${id}/answer`, {
        method: 'POST', body: JSON.stringify({move}),
    }),
    /** Партии с отобранными моментами: {id партии: id первой позиции}; сервер смотрит не больше 100 id за запрос. */
    ofGames: (gameIds: number[]) => request<{ games: Record<string, number> }>(`/games?ids=${gameIds.join(',')}`),
    /** Отобранные моменты одной партии — для кнопки «Угадай ход» в просмотре; пустой список — кнопки нет. */
    ofGame: (gameId: number) => request<{ positions: { id: number; ply: number; series_id: number | null }[] }>(`/game/${gameId}`),
};

/** «Точность понимания» сессии: средний балл за ответ (0–100); null — ответов ещё нет. */
export function understanding(scores: number[]): number | null {
    return scores.length ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null;
}
