// --- FILE: frontend/src/services/skills.ts ---
// Карта навыков игрока: сводка по разделам задач, ошибкам, дебютам, курсам и диагностическому экзамену.
// Эндпоинт GET /api/v1/skills (src/api/skills.py) — только с входом. Используют SkillMap.tsx (профиль).
// Запрос и ошибки — apiRequest (http.ts).

import {apiRequest} from './http';
import {getToken} from './authToken';

/** Ответ GET /skills: сводка по разделам задач, ошибкам, дебютам, курсам и диагностическому экзамену. */
export interface SkillMapData {
    username: string;
    puzzle_rating: number;
    sections: { section: string; attempts: number; score: number | null }[];
    weakest_themes: { theme: string; section: string; attempts: number; score: number }[];
    mistakes: { total: number; fixed: number; themes: { theme: string; count: number }[] };
    trainers: { trainer: string; attempts: number; best: number; max_level: number }[];
    openings: { repertoires: number; new: number; learning: number; learned: number };
    endgames: { done: number; total: number };
    mates: { done: number; total: number };
    /** Диагностический экзамен (22.0). */
    exam?: { overall: number | null; level: string | null; passed: number; of: number };
}

/** Карта навыков текущего игрока; без токена или при любом отказе (сервер, сеть) — null: блок просто не рисуется. */
export async function fetchSkillMap(): Promise<SkillMapData | null> {
    if (!getToken()) return null;
    return apiRequest<SkillMapData>('/skills').catch(() => null);
}
