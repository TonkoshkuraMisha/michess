// --- FILE: frontend/src/content/lessons/index.ts ---
// Реестр курсов и уроков школы: каждый JSON-файл этой папки (кроме courses.json) — урок в формате format.ts.

import type {Language} from '../../i18n';
import coursesData from './courses.json';
import type {CourseInfo, Lesson, LocalizedText} from './format';

const lessonModules = import.meta.glob<Lesson>('./*.json', {eager: true, import: 'default'});

export const COURSES: CourseInfo[] = [...(coursesData as CourseInfo[])].sort((a, b) => a.order - b.order);

export const LESSONS: Lesson[] = Object.entries(lessonModules)
    .filter(([path]) => !path.endsWith('/courses.json'))
    .map(([, lesson]) => lesson)
    .sort((a, b) => a.course.localeCompare(b.course) || a.order - b.order);

export function lessonById(id: string): Lesson | undefined {
    return LESSONS.find((lesson) => lesson.id === id);
}

export function lessonsOfCourse(courseId: string): Lesson[] {
    return LESSONS.filter((lesson) => lesson.course === courseId);
}

/** Следующий урок того же курса — для кнопки «Следующий урок». */
export function nextLesson(lesson: Lesson): Lesson | undefined {
    const list = lessonsOfCourse(lesson.course);
    return list[list.findIndex((l) => l.id === lesson.id) + 1];
}

export function localized(text: LocalizedText | undefined, language: Language): string {
    return text ? text[language] ?? text.en : '';
}
