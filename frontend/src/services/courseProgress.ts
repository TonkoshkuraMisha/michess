// --- FILE: frontend/src/services/courseProgress.ts ---
// Автозачёт шагов Большого курса (план владельца 18.11, задача 6): GET /learn/course-progress отдаёт выполненное по
// видам упражнений (нормативы считает сервер — src/services/course_progress.py), здесь оно сопоставляется с шагами
// модуля. Ключи записей прогресса — те же функции, которыми их пишут разделы (азбука, курс матов, эндшпиль, мини-игры).
// Шаг без объективного итога (библиотека, репертуар, партии мастеров, «угадай ход», разминка, игра) не проверяется:
// модуль из одних таких шагов игрок отмечает сам, как раньше.

import {API_BASE_URL} from '../config/api';
import {LEVEL_EXAM_TARGET} from '../content/supercourse';
import type {CourseModule} from '../content/supercourse';
import type {Activity} from '../content/programs';
import {progressId as basicsProgressId} from '../content/basics/levels';
import {mateProgressId} from '../components/learn/MateCourse';
import {progressId as endgameProgressId} from '../components/learn/EndgameTrainer';
import {miniProgressId} from '../components/trainers/MiniGames';
import {getToken} from './authToken';

export interface CourseFacts {
    /** id выполненных записей lesson_progress (уроки, азбука, маты, эндшпиль, мини-игры). */
    lessons: string[];
    /** Темы задач, засчитанные по нормативу ступени. */
    themes: string[];
    /** Тренажёры, в которых есть законченная попытка. */
    trainers: string[];
    /** Последняя оценка силы по разделу экзамена. */
    exams: Record<string, number>;
}

/** Выполненное игроком; без входа — null (автозачёта нет). */
export async function fetchCourseFacts(): Promise<CourseFacts | null> {
    const token = getToken();
    if (!token) return null;
    const res = await fetch(`${API_BASE_URL}/api/v1/learn/course-progress`, {headers: {Authorization: `Bearer ${token}`}});
    if (!res.ok) throw new Error(`course progress ${res.status}`);
    // Недостающие поля (ответ сервера другой версии) — пустые: автозачёт тогда просто ничего не отмечает.
    const body = (await res.json()) as Partial<CourseFacts> | null;
    return {
        lessons: Array.isArray(body?.lessons) ? body.lessons : [],
        themes: Array.isArray(body?.themes) ? body.themes : [],
        trainers: Array.isArray(body?.trainers) ? body.trainers : [],
        exams: body?.exams && typeof body.exams === 'object' && !Array.isArray(body.exams) ? body.exams : {},
    };
}

const NO_FACTS: CourseFacts = {lessons: [], themes: [], trainers: [], exams: {}};

/** Есть ли в модуле проверяемые шаги: если нет, модуль отмечает сам игрок (кнопка «пройдено»). */
export function moduleCheckable(module: CourseModule): boolean {
    return module.steps.some((step) => activityDone(step, NO_FACTS) !== null);
}

const LEVEL_EXAM = /^level(\d)$/;

/** Выполнен ли шаг: true / false; null — у шага нет объективного итога, он не проверяется. */
export function activityDone(activity: Activity, facts: CourseFacts): boolean | null {
    const lessons = new Set(facts.lessons);
    switch (activity.kind) {
        case 'lesson': return lessons.has(activity.id);
        case 'basics': return lessons.has(basicsProgressId(activity.id));
        case 'mates': return lessons.has(mateProgressId(activity.id));
        case 'endgame': return lessons.has(endgameProgressId(activity.id));
        case 'mini': return lessons.has(miniProgressId(activity.id));
        case 'theme': return facts.themes.includes(activity.id);
        case 'trainer': return facts.trainers.includes(activity.id);
        case 'exam': {
            const estimate = facts.exams[activity.id];
            if (estimate === undefined) return false;
            // Экзамен уровня сдан при оценке не ниже цели уровня; диагностический раздел — когда пройден.
            const level = LEVEL_EXAM.exec(activity.id);
            return level ? estimate >= LEVEL_EXAM_TARGET[Number(level[1])] : true;
        }
        default: return null;
    }
}

/**
 * Модуль закрыт сам: в нём есть проверяемые шаги и все они выполнены. Непроверяемые шаги закрытию не мешают;
 * модуль только из непроверяемых шагов автоматически не закрывается.
 */
export function moduleAutoDone(module: CourseModule, facts: CourseFacts): boolean {
    const checked = module.steps.map((step) => activityDone(step, facts)).filter((done) => done !== null);
    return checked.length > 0 && checked.every(Boolean);
}
