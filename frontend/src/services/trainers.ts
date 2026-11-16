// --- FILE: frontend/src/services/trainers.ts ---
// Тренажёры (таск 19.1): результаты попыток, личные рекорды и история для графика (/api/v1/trainers). Без входа
// тренажёры работают, но результаты не сохраняются.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export const TRAINER_IDS = ['quiet_path', 'knight_route', 'double_strike', 'tail',
    'coord_find', 'coord_name', 'coord_color', 'coord_diagonal', 'memory_position', 'memory_game',
    'board_placement', 'knight_tour', 'blind_move', 'blind_where',
    'calc_checks', 'calc_exchange', 'calc_distance', 'calc_square', 'calc_eval', 'structure_quiz', 'miniatures'] as const;
export type TrainerId = typeof TRAINER_IDS[number];

export interface TrainerAttempt {
    trainer: TrainerId;
    level: number;
    score: number;
    time_ms: number;
    mistakes: number;
}

export interface TrainerRecord {
    best: number;
    max_level: number;
    attempts: number;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/trainers${path}`, {
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

export const trainersApi = {
    save: (attempt: TrainerAttempt) => call<{ record: boolean; best: number }>('/results', {
        method: 'POST', body: JSON.stringify(attempt),
    }),
    records: () => call<{ records: Partial<Record<TrainerId, TrainerRecord>> }>('/records'),
    history: (trainer: TrainerId) =>
        call<{ results: { level: number; score: number; time_ms: number; mistakes: number; created_at: string }[] }>(`/history/${trainer}`),
};
