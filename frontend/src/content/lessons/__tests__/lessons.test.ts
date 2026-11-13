// Проверка контента школы в CI (таск 14.1): каждый урок проходит validateLesson — ходы легальны, у каждого
// вопроса есть верный ответ, тексты на трёх языках. Сам валидатор проверяется на заведомо испорченных уроках.

import {describe, expect, it} from 'vitest';
import {COURSES, LESSONS, lessonById, nextLesson} from '..';
import type {Lesson} from '../format';
import {validateLesson} from '../validate';

describe('контент уроков', () => {
    it('есть хотя бы один курс и урок', () => {
        expect(COURSES.length).toBeGreaterThan(0);
        expect(LESSONS.length).toBeGreaterThan(0);
    });

    it.each(LESSONS.map((lesson) => [lesson.id, lesson] as const))('урок %s корректен', (_id, lesson) => {
        expect(validateLesson(lesson, COURSES)).toEqual([]);
    });

    it('id уроков уникальны, порядок в курсе без повторов', () => {
        const ids = LESSONS.map((l) => l.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const course of COURSES) {
            const orders = LESSONS.filter((l) => l.course === course.id).map((l) => l.order);
            expect(new Set(orders).size).toBe(orders.length);
        }
    });

    it('реестр находит урок и следующий за ним', () => {
        const first = LESSONS[0];
        expect(lessonById(first.id)).toBe(first);
        expect(lessonById('no-such-lesson')).toBeUndefined();
        // Уроки отсортированы по курсу и порядку: у последнего урока следующего нет.
        expect(nextLesson(LESSONS[LESSONS.length - 1])).toBeUndefined();
    });
});

describe('валидатор ловит ошибки', () => {
    const base = (): Lesson => structuredClone(lessonById('tactics-double-attack')!);
    const problemsOf = (mutate: (l: Lesson) => void) => {
        const lesson = base();
        mutate(lesson);
        return validateLesson(lesson, COURSES).join('\n');
    };

    it('нелегальный ход показа', () => {
        expect(problemsOf((l) => {
            const demo = l.steps.find((s) => s.type === 'demo')!;
            if (demo.type === 'demo') demo.actions.unshift({do: 'move', uci: 'e1e5'});
        })).toMatch(/illegal move e1e5/);
    });

    it('нелегальный или отсутствующий верный ответ', () => {
        expect(problemsOf((l) => {
            const q = l.steps.find((s) => s.type === 'find_move')!;
            if (q.type === 'find_move') q.line[0].answers = ['a1a8'];
        })).toMatch(/correct answer a1a8 is illegal/);
        expect(problemsOf((l) => {
            const q = l.steps.find((s) => s.type === 'find_move')!;
            if (q.type === 'find_move') q.line[0].answers = [];
        })).toMatch(/no correct answer/);
    });

    it('отклик на нелегальный неверный ход и ход, который одновременно верный', () => {
        expect(problemsOf((l) => {
            const q = l.steps.find((s) => s.type === 'find_move')!;
            if (q.type === 'find_move') q.line[0].wrong = {h1h8: {en: 'x', uk: 'x', ru: 'x'}, d5e7: {en: 'x', uk: 'x', ru: 'x'}};
        })).toMatch(/h1h8 is illegal[\s\S]*d5e7 is both correct and wrong/);
    });

    it('вопрос с выбором без верного варианта', () => {
        expect(problemsOf((l) => {
            const q = l.steps.find((s) => s.type === 'choice')!;
            if (q.type === 'choice') q.options.forEach((o) => delete o.correct);
        })).toMatch(/no correct option/);
    });

    it('текст без одного из языков', () => {
        expect(problemsOf((l) => {
            (l.steps[0].text as Record<string, string>).uk = '';
        })).toMatch(/missing uk text/);
    });

    it('некорректный FEN, неизвестный курс, пустой экзамен', () => {
        const problems = problemsOf((l) => {
            l.steps[0] = {...l.steps[0], fen: 'not a fen'} as Lesson['steps'][number];
            l.course = 'nope';
            l.exam = [];
        });
        expect(problems).toMatch(/invalid FEN/);
        expect(problems).toMatch(/no course nope/);
        expect(problems).toMatch(/the exam needs 1..5 questions/);
    });

    it('линия продолжается без ответа компьютера', () => {
        expect(problemsOf((l) => {
            const q = l.exam.find((s) => s.type === 'find_move')!;
            if (q.type === 'find_move') delete q.line[0].reply;
        })).toMatch(/no computer reply/);
    });
});
