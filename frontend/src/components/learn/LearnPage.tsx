// --- FILE: frontend/src/components/learn/LearnPage.tsx ---
// Школа (таск 14.1): /learn — курсы и уроки с прогрессом игрока; /learn/:lessonId — урок в проигрывателе.
// Прогресс хранится на сервере только у вошедших; без входа урок проходится, но не запоминается.

import {useEffect, useRef, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {CheckCircle2, GraduationCap} from 'lucide-react';
import {useI18n} from '../../i18n';
import {COURSES, lessonById, lessonsOfCourse, localized, nextLesson} from '../../content/lessons';
import {fetchLessonProgress, saveLessonProgress} from '../../services/lessonProgress';
import type {LessonProgress} from '../../services/lessonProgress';
import {LessonPlayer} from './LessonPlayer';

function useProgress(): [Record<string, LessonProgress>, boolean] {
    const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            setLoaded(true);
            return;
        }
        let alive = true;
        fetchLessonProgress(token)
            .then((items) => alive && setProgress(Object.fromEntries(items.map((p) => [p.lesson_id, p]))))
            .catch(() => undefined)
            .finally(() => alive && setLoaded(true));
        return () => {
            alive = false;
        };
    }, []);
    return [progress, loaded];
}

export function LearnPage() {
    const {t, tp, language} = useI18n();
    const [progress] = useProgress();
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="learn-page">
            <header className="flex items-center gap-2">
                <GraduationCap className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('learn.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('learn.intro')}</p>
            {!localStorage.getItem('token') && <p className="text-sm text-amber-300">{t('learn.loginToSave')}</p>}
            {COURSES.map((course) => {
                const lessons = lessonsOfCourse(course.id);
                return (
                    <section key={course.id} className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark flex flex-col gap-2">
                        <div className="flex items-baseline justify-between gap-2">
                            <h2 className="text-lg font-bold text-amber-200">{localized(course.title, language)}</h2>
                            <span className="text-xs text-boxwood/70">{tp('learn.lessonsCount', lessons.length)}</span>
                        </div>
                        <p className="text-sm text-boxwood/80">{localized(course.summary, language)}</p>
                        <ol className="flex flex-col gap-1.5">
                            {lessons.map((lesson) => {
                                const p = progress[lesson.id];
                                const action = p?.completed ? t('learn.review') : p ? t('learn.continue') : t('learn.start');
                                return (
                                    <li key={lesson.id} className="flex items-center gap-2 bg-black/30 rounded px-3 py-2">
                                        {p?.completed && <CheckCircle2 size={16} className="text-emerald-400" aria-label={t('learn.completed')}/>}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold truncate">{localized(lesson.title, language)}</div>
                                            <div className="text-xs text-boxwood/70">{localized(lesson.summary, language)}</div>
                                        </div>
                                        {p?.exam_total != null && p.exam_score != null && (
                                            <span className="text-xs font-mono text-amber-300">
                                                {t('learn.examScore', {score: p.exam_score, total: p.exam_total})}
                                            </span>
                                        )}
                                        <Link to={`/learn/${lesson.id}`}
                                              className="px-3 py-1 rounded-md bg-amber-700 text-white text-sm font-bold hover:bg-amber-600">
                                            {action}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ol>
                    </section>
                );
            })}
        </div>
    );
}

export function LessonPage() {
    const {lessonId = ''} = useParams();
    const {t, language} = useI18n();
    const lesson = lessonById(lessonId);
    const [progress, loaded] = useProgress();
    const [saveError, setSaveError] = useState(false);
    const furthest = useRef(-1);

    const token = localStorage.getItem('token');
    const saved = progress[lessonId];

    const save = (update: Parameters<typeof saveLessonProgress>[2]) => {
        if (!token) return;
        saveLessonProgress(token, lessonId, update)
            .then(() => setSaveError(false))
            .catch(() => setSaveError(true));
    };

    if (!lesson) {
        return (
            <div className="p-6 text-center text-boxwood-light">
                <p>{t('learn.notFound')}</p>
                <Link to="/learn" className="underline text-amber-300">{t('learn.toCourses')}</Link>
            </div>
        );
    }
    if (!loaded) return null;

    const following = nextLesson(lesson);
    // Пройденный урок начинается сначала; незаконченный — с дальнего шага.
    const initialStep = saved && !saved.completed ? Math.min(saved.step, lesson.steps.length - 1) : 0;

    return (
        <div className="w-full p-3 flex flex-col gap-3" data-testid="lesson-page">
            <nav className="text-sm">
                <Link to="/learn" className="underline text-amber-300">{t('learn.toCourses')}</Link>
            </nav>
            {saveError && <p role="alert" className="text-sm text-rose-300">{t('learn.saveFailed')}</p>}
            <LessonPlayer
                key={`${lesson.id}-${language}`}
                lesson={lesson}
                initialStep={initialStep}
                onStep={(step) => {
                    if (step <= furthest.current) return;
                    furthest.current = step;
                    save({step, steps_total: lesson.steps.length});
                }}
                onFinish={({examScore, examTotal}) => save({
                    step: lesson.steps.length - 1, steps_total: lesson.steps.length, completed: true,
                    exam_score: examScore, exam_total: examTotal,
                })}
                finishActions={following ? (
                    <Link to={`/learn/${following.id}`}
                          className="px-4 py-2 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600">
                        {t('learn.nextLesson')}
                    </Link>
                ) : (
                    <Link to="/learn" className="px-4 py-2 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600">
                        {t('learn.toCourses')}
                    </Link>
                )}
            />
        </div>
    );
}
