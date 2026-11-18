// --- FILE: frontend/src/services/lessonProgress.ts ---
// Прогресс уроков школы на сервере (таск 14.1): GET /api/v1/learn/progress и PUT /api/v1/learn/progress/{id урока}
// (src/api/learn.py, таблица lesson_progress). Без входа прогресс не хранится. Сами уроки — данные клиента
// (content/lessons/*.json), поэтому сервер принимает любой id урока и хранит по нему только числа.
// Этим же хранилищем под своими id пользуются «Основы», «Классика», эндшпильный тренажёр, курс матов, Большой курс
// и программы тренировок: у каждого раздела своя функция, строящая id записи (progressId, courseProgressId).

import {API_BASE_URL} from '../config/api';

/** Прогресс одного урока, как его хранит сервер. Прогресс только растёт: повторное прохождение его не сбрасывает. */
export interface LessonProgress {
    lesson_id: string;
    /** Дальний пройденный шаг (с нуля) и число шагов урока. */
    step: number;
    steps_total: number;
    completed: boolean;
    /** Лучший результат контрольных вопросов; null — урок без них или они ещё не пройдены. */
    exam_score: number | null;
    exam_total: number | null;
}

/** Тело PUT: то, что клиент сообщает после шага или завершения урока. */
export interface ProgressUpdate {
    step: number;
    steps_total: number;
    completed?: boolean;
    exam_score?: number;
    exam_total?: number;
}

const BASE = `${API_BASE_URL}/api/v1/learn/progress`;

/** Все записи прогресса игрока. Ошибка — обычное исключение без текста для игрока: что с ней делать, решает раздел. */
export async function fetchLessonProgress(token: string): Promise<LessonProgress[]> {
    const res = await fetch(BASE, {headers: {Authorization: `Bearer ${token}`}});
    if (!res.ok) throw new Error(`progress ${res.status}`);
    return res.json();
}

/** Сохранить прогресс урока; в ответе — запись сервера после слияния с прежней (шаг и результат не уменьшаются). */
export async function saveLessonProgress(token: string, lessonId: string, update: ProgressUpdate): Promise<LessonProgress> {
    const res = await fetch(`${BASE}/${encodeURIComponent(lessonId)}`, {
        method: 'PUT',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error(`progress ${res.status}`);
    return res.json();
}
