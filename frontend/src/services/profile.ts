// --- FILE: frontend/src/services/profile.ts ---
// Профиль игрока и таблица лидеров: GET /api/v1/profile/<имя> (профиль, лестница, кубки арен), /stats (итоги по всем
// партиям), /games (страницами; у чемпионов-мастеров — их архив из PGN), /rating-history (значения рейтинга, сохранённые
// сервером при завершении партий), /profile/leaderboard. Маршруты — src/api/profile.py; всё открыто без входа.
// Используют Profile.tsx, ChampionGames.tsx и Leaderboard.tsx. Запрос и ошибки — общий apiRequest (http.ts).

import {apiRequest} from './http';

/** Категория рейтинга по контролю времени; те же коды у сервера. */
export type RatingCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

/** Профиль игрока, как его отдаёт GET /profile/<имя>. */
export interface UserProfile {
    id: number;
    username: string;
    avatar?: string | null;
    bullet_rating: number;
    blitz_rating: number;
    rapid_rating: number;
    classical_rating: number;
    created_at: string;
    /** Клубная лестница: отдельный рейтинг партий с ботами без подсказок и возвратов хода. */
    ladder?: { rating: number; games: number; step: number; total: number };
    /** Кубки арен (таск 33.5): первые, вторые и третьи места — src/services/arena_awards.py. */
    arena_trophies?: { gold: number; silver: number; bronze: number };
}

/** Итоги игрока по всем партиям (GET /stats): считает сервер, а не клиент по загруженной странице. */
export interface PlayerStats {
    total: number;
    wins: number;
    draws: number;
    losses: number;
    rated_games: Record<RatingCategory, number>;
}

/** Партия в истории игрока или в архиве чемпиона. */
export interface ProfileGame {
    game_id: number;
    white_username: string;
    white_rating: number;
    black_username: string;
    black_rating: number;
    status: string;
    is_rated: boolean;
    /** Игрок пользовался наставником (таск 11.3). */
    assisted?: boolean;
    /** Игра вслепую (таск 19.5): ступень и подсмотры. */
    blindfold?: number | null;
    peeks?: number | null;
    result: string;
    pgn_date: string | null;
    site: string | null;
    eco: string | null;
    finished_at: string | null;
}

/** Страница партий: элементы и общее число. */
export interface ProfileGamesPage {
    items: ProfileGame[];
    total: number;
}

/** Рейтинг после партии и его изменение за неё (GET /rating-history). */
export interface RatingPoint {
    game_id: number;
    finished_at: string;
    rating: number;
    delta: number;
}

/** Строка таблицы лидеров. */
export interface LeaderboardEntry {
    rank: number;
    avatar?: string | null;
    username: string;
    rating: number;
}

/** Путь профиля игрока: имя кодируется (в именах мастеров бывают пробелы и запятые). */
const playerPath = (username: string) => `/profile/${encodeURIComponent(username)}`;

export const profileApi = {
    /** Профиль; нет игрока — UiError с текстом user_not_found, другой отказ — profile.loadFailed. */
    get: (username: string) => apiRequest<UserProfile>(playerPath(username), {}, 'profile.loadFailed'),
    stats: (username: string) => apiRequest<PlayerStats>(`${playerPath(username)}/stats`),
    /** Партии страницей; sort='asc' — от первых к последним (архив чемпиона). */
    games: (username: string, limit: number, offset: number, sort?: 'asc') => {
        const params = new URLSearchParams({limit: String(limit), offset: String(offset)});
        if (sort) params.set('sort', sort);
        return apiRequest<ProfileGamesPage>(`${playerPath(username)}/games?${params}`, {}, 'championGames.loadFailed');
    },
    ratingHistory: (username: string, category: RatingCategory) =>
        apiRequest<{ points: RatingPoint[] }>(`${playerPath(username)}/rating-history?category=${category}`),
    /** Таблица лидеров категории: первые limit игроков. */
    leaderboard: (category: RatingCategory, limit: number) =>
        apiRequest<LeaderboardEntry[]>(`/profile/leaderboard?limit=${limit}&category=${category}`, {}, 'leaderboard.loadFailed'),
};
