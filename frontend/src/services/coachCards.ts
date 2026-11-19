// --- FILE: frontend/src/services/coachCards.ts ---
// «Клубный тренер» после партии (план владельца 18.11, задача 5): GET /learn/after-game/{id} — сервер собирает
// самую дорогую личную задачу партии, отклонение от репертуара и темы ошибки (src/services/coach_cards.py). Модуль
// Большого курса для урока выбирает клиент — курс его данные (content/supercourse.ts): первый по уровню модуль,
// в шагах которого есть тренировка по теме ошибки.

import {COURSE} from '../content/supercourse';
import type {CourseModule} from '../content/supercourse';
import type {PersonalView} from './puzzles';
import type {Deviation} from './repertoire';
import {apiRequest} from './http';

export interface AfterGameCards {
    game_id: number;
    /** Разбор партии готов; личные задачи появляются чуть позже него (та же фоновая задача). */
    analysed: boolean;
    puzzle: PersonalView | null;
    deviation: Deviation | null;
    /** Темы самой дорогой ошибки по значимости; пусто — ошибки-задачи нет. */
    lesson_themes: string[];
}

/** Сколько раз переспросить карточки, пока задача из партии ещё не готова, и пауза между вопросами. */
export const POLL_ATTEMPTS = 3;
export const POLL_DELAY_MS = 5000;

/** Карточки по своей законченной партии; отказ — UiError с текстом по коду. */
export function fetchAfterGame(gameId: number): Promise<AfterGameCards> {
    return apiRequest<AfterGameCards>(`/learn/after-game/${gameId}`);
}

/** Ждать ли ещё задачу из партии: разбор готов, а задачи нет — фоновая задача могла её ещё не сделать. */
export function shouldPoll(cards: AfterGameCards | null, attempt: number): boolean {
    return cards !== null && cards.puzzle === null && attempt < POLL_ATTEMPTS;
}

/**
 * Модуль курса для урока по ошибке: по темам в порядке значимости — первый модуль с наполнением, где есть
 * тренировка по этой теме; среди таких — самого раннего уровня. null — подходящего модуля нет.
 */
export function lessonModuleFor(themes: string[], course: CourseModule[] = COURSE): { module: CourseModule; theme: string } | null {
    for (const theme of themes) {
        const found = course
            .filter((m) => m.steps.some((s) => s.kind === 'theme' && s.id === theme))
            .sort((a, b) => a.level - b.level)[0];
        if (found) return {module: found, theme};
    }
    return null;
}
