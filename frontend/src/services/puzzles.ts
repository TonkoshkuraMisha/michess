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
}

export interface TimedRun {
    run_id: string;
    minutes: number;
    solved: number;
    mistakes: number;
    seconds_left: number;
    over: boolean;
}

export interface PuzzleResult {
    solved: boolean;
    rating_before: number;
    rating_after: number;
    delta: number;
    streak: number;
    themes: string[];
    run: TimedRun | null;
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
};
