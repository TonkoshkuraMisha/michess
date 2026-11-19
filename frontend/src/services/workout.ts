// --- FILE: frontend/src/services/workout.ts ---
// Ежедневная разминка (таск 22.2): план на сегодня — задачи по слабым темам, тренажёр, повторения.
// Эндпоинт GET /api/v1/workout (src/api/workout.py); шаги засчитывает сервер по самим тренировкам за сегодня.
// Использует WorkoutPage.tsx. Запрос и ошибки — apiRequest (http.ts).

import {apiRequest} from './http';

/** Шаг плана разминки; вид (kind) задаёт, какие поля пришли и куда ведёт кнопка. */
export type WorkoutStep =
    | { kind: 'puzzles'; themes: string[]; target: number; done: number }
    | { kind: 'trainer'; trainer: string; done: boolean }
    | { kind: 'repertoire'; due: number; repertoire_id: number | null; done: boolean }
    | { kind: 'mistake'; due: number; done: boolean };

/** План на сегодня: дата, выполнен ли целиком, серия дней подряд и шаги. */
export interface WorkoutPlan {
    date: string;
    complete: boolean;
    streak: number;
    steps: WorkoutStep[];
}

/** Загружает план на сегодня; отказ сервера — UiError с текстом по коду ошибки. */
export const fetchWorkoutPlan = () => apiRequest<WorkoutPlan>('/workout');
