// --- FILE: frontend/src/services/puzzles.ts ---
// Задачи (таски 13.2–13.3): клиент API. Решение с сервера не приходит — только позиция, первый ход соперника и
// ответы на верные ходы.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';

export interface PuzzleView {
    id: number;
    fen: string;
    first_move: string;
    rating: number;
    themes: string[];
    color: 'white' | 'black';
    solution_length: number;
    daily?: boolean;
    run?: TimedRun;
    /** Тренировка по приёмам: ступень задачи (смешанная подборка — null). */
    stage?: number | null;
}

export interface TimedRun {
    run_id: string;
    minutes: number;
    solved: number;
    mistakes: number;
    seconds_left: number;
    over: boolean;
}

export interface TrainingProgress {
    theme: string;
    stage: number;
    recent: string;
    mastered: boolean;
    advanced: boolean;
    window: number;
    pass: number;
}

export interface ThemeOverview {
    code: string;
    section: string;
    stage: number;
    recent: string;
    solved: number;
    mastered: boolean;
    available: [number, number, number, number];
    ready: boolean;
}

export interface TrainingOverview {
    window: number;
    pass: number;
    themes: ThemeOverview[];
}

export interface DemoExample {
    fen: string;
    moves: string[];
    color: 'white' | 'black';
}

/** Что тренируем: тему (на ступени игрока) или раздел (смешанная подборка); «без названия темы». */
export interface TrainingTarget {
    theme?: string;
    section?: string;
    blind: boolean;
}

/** «Ваши ошибки» (таск 13.5): позиция перед ошибкой в партии игрока. */
export interface PersonalView {
    id: number;
    game_id: number;
    ply: number;
    fen: string;
    previous_move: string | null;
    color: 'white' | 'black';
    themes: string[];
    attempts: number;
    solved_streak: number;
}

export interface PersonalAnswer {
    correct: boolean;
    solution: string;
    played: string;
    done: boolean;
    solved_streak: number;
    next_due_at: string | null;
}

export interface PersonalSummary {
    due: number;
    active: number;
    mastered: number;
    next_due_at: string | null;
}

export interface PuzzleResult {
    solved: boolean;
    rating_before: number;
    rating_after: number;
    delta: number;
    streak: number;
    themes: string[];
    run: TimedRun | null;
    training?: TrainingProgress | null;
}

export interface MoveResponse {
    correct: boolean;
    done: boolean;
    reply: string | null;
    solution: string[] | null;
    result: PuzzleResult | null;
}

export interface HintResponse {
    from: string;
    to: string | null;
    hints_used: number;
}

export interface PuzzleProfile {
    rating: number;
    games: number;
    streak: number;
    best: { '3': number; '5': number };
    history: {
        puzzle_id: number;
        puzzle_rating: number;
        solved: boolean;
        hints_used: number;
        rating_after: number;
        created_at: string | null;
    }[];
}

export interface TimedResult {
    score: number;
    mistakes: number;
    minutes: number;
    best: number;
    new_record: boolean;
}

const BASE = `${API_BASE_URL}/api/v1/puzzles`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('token');
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

export const puzzlesApi = {
    next: (theme?: string | null) => request<PuzzleView>(`/next${theme ? `?theme=${encodeURIComponent(theme)}` : ''}`),
    daily: () => request<PuzzleView>('/daily'),
    move: (id: number, move: string) => request<MoveResponse>(`/${id}/move`, {
        method: 'POST', body: JSON.stringify({move}),
    }),
    hint: (id: number) => request<HintResponse>(`/${id}/hint`, {method: 'POST'}),
    giveUp: (id: number) => request<{ solution: string[]; result: PuzzleResult }>(`/${id}/give-up`, {method: 'POST'}),
    me: () => request<PuzzleProfile>('/me'),
    timedStart: (minutes: 3 | 5) => request<TimedRun>('/timed/start', {
        method: 'POST', body: JSON.stringify({minutes}),
    }),
    timedNext: () => request<PuzzleView & { run: TimedRun }>('/timed/next'),
    timedFinish: () => request<TimedResult>('/timed/finish', {method: 'POST'}),
    train: (target: TrainingTarget) => {
        const params = new URLSearchParams();
        if (target.theme) params.set('theme', target.theme);
        if (target.section) params.set('section', target.section);
        if (target.blind) params.set('blind', 'true');
        return request<PuzzleView>(`/train?${params.toString()}`);
    },
    training: () => request<TrainingOverview>('/training'),
    personalSummary: () => request<PersonalSummary>('/personal'),
    personalNext: () => request<PersonalView>('/personal/next'),
    personalAnswer: (id: number, move: string) => request<PersonalAnswer>(`/personal/${id}/answer`, {
        method: 'POST', body: JSON.stringify({move}),
    }),
    personalPlies: (gameId: number) => request<{ game_id: number; plies: number[] }>(`/personal/game/${gameId}`),
    demo: (theme: string) => request<{ theme: string; examples: DemoExample[] }>(
        `/demo?theme=${encodeURIComponent(theme)}`,
    ),
};
