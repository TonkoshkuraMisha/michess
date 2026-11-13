// --- FILE: frontend/src/services/lessonProgress.ts ---
// Прогресс уроков школы на сервере (таск 14.1): GET/PUT /api/v1/learn/progress. Без входа прогресс не хранится.

import {API_BASE_URL} from '../config/api';

export interface LessonProgress {
    lesson_id: string;
    step: number;
    steps_total: number;
    completed: boolean;
    exam_score: number | null;
    exam_total: number | null;
}

export interface ProgressUpdate {
    step: number;
    steps_total: number;
    completed?: boolean;
    exam_score?: number;
    exam_total?: number;
}

const BASE = `${API_BASE_URL}/api/v1/learn/progress`;

export async function fetchLessonProgress(token: string): Promise<LessonProgress[]> {
    const res = await fetch(BASE, {headers: {Authorization: `Bearer ${token}`}});
    if (!res.ok) throw new Error(`progress ${res.status}`);
    return res.json();
}

export async function saveLessonProgress(token: string, lessonId: string, update: ProgressUpdate): Promise<LessonProgress> {
    const res = await fetch(`${BASE}/${encodeURIComponent(lessonId)}`, {
        method: 'PUT',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error(`progress ${res.status}`);
    return res.json();
}
