// --- FILE: frontend/src/services/exam.ts ---
// Диагностический экзамен (таск 22.0): запросы к /api/v1/exam (src/api/exam.py) — сводка последних результатов,
// вопросы раздела, проверка хода и сдача ответов. Использует ExamPage.tsx; типы ответов описаны там же.
// Запрос и ошибки — apiRequest (http.ts).

import {apiRequest} from './http';

/** Запрос к /api/v1/exam{path}: без body — GET, с body — POST; отказ превращается в UiError с кодом. */
export const examCall = <T>(path: string, body?: object) =>
    apiRequest<T>(`/exam${path}`, body ? {method: 'POST', body: JSON.stringify(body)} : {});
