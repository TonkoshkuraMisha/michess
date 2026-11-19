// --- FILE: frontend/src/components/learn/LearnPage.tsx ---
// Школа (таск 14.1): /learn — курсы и уроки с прогрессом игрока; /learn/:lessonId — урок в проигрывателе.
// Прогресс хранится на сервере только у вошедших; без входа урок проходится, но не запоминается.
// Раскладка (план владельца 18.11, общие компоненты): «Большой курс» — главная карточка, курсы и тренажёры —
// сетка карточек (SCHOOL_CARDS), уроки — по курсам с полосой «пройдено N из M» у вошедших.
// Данные: курсы и уроки — content/lessons (COURSES, lessonById, lessonsOfCourse, nextLesson); прогресс — services/lessonProgress.ts. Подключено в App.tsx.

import {useEffect, useRef, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {BookOpen, Castle, CheckCircle2, Compass, Crown, GraduationCap, Layers, Lightbulb, ScrollText} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {MessageKey} from '../../i18n';
import {ButtonLink, Card, CardGrid, Page, PageHeader, ProgressBar, Section} from '../ui';
import {useI18n} from '../../i18n';
import {COURSES, lessonById, lessonsOfCourse, localized, nextLesson} from '../../content/lessons';
import {fetchLessonProgress, saveLessonProgress} from '../../services/lessonProgress';
import type {LessonProgress} from '../../services/lessonProgress';
import {LessonPlayer} from './LessonPlayer';
import {getToken} from '../../services/authToken';

/** Прогресс уроков вошедшего по lesson_id и признак «загружено»; у гостя запроса нет, loaded сразу true. */
function useProgress(): [Record<string, LessonProgress>, boolean] {
    const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        const token = getToken();
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

/** Курсы и тренажёры школы: адрес, заголовок, описание и иконка карточки. Новый раздел — строка здесь. */
const SCHOOL_CARDS: { id: string; to: string; title: MessageKey; text: MessageKey; icon: LucideIcon }[] = [
    {id: 'basics', to: '/learn/basics', title: 'basics.title', text: 'basics.card', icon: BookOpen},
    {id: 'mates', to: '/learn/mates', title: 'mateCourse.title', text: 'mateCourse.card', icon: Crown},
    {id: 'endgames', to: '/learn/endgames', title: 'endgames.title', text: 'endgames.card', icon: Castle},
    {id: 'classics', to: '/learn/classics', title: 'classics.title', text: 'classics.card', icon: ScrollText},
    {id: 'guess', to: '/guess', title: 'guess.title', text: 'guess.fromLearn', icon: Lightbulb},
    {id: 'explorer', to: '/tools', title: 'explorer.title', text: 'explorer.card', icon: Compass},
];

/** Главная школы: карточка большого курса, карточки разделов и уроки по курсам с полосой прогресса. */
export function LearnPage() {
    const {t, tp, language} = useI18n();
    const [progress] = useProgress();
    return (
        <Page testId="learn-page">
            <PageHeader title={t('learn.title')} icon={<GraduationCap size={24}/>} description={t('learn.intro')}/>
            {!getToken() && <p className="text-sm text-amber-300">{t('learn.loginToSave')}</p>}
            <Card variant="hero" to="/learn/course" testId="learn-course-link" icon={<Layers size={24}/>}
                  title={t('supercourse.title')} description={t('supercourse.card')}/>
            <Section title={t('learn.trainers')}>
                <CardGrid>
                    {SCHOOL_CARDS.map(({id, to, title, text, icon: Icon}) => (
                        <Card key={id} to={to} testId={`learn-${id}-link`} icon={<Icon size={20}/>}
                              title={t(title)} description={t(text)}/>
                    ))}
                </CardGrid>
            </Section>
            <Section title={t('learn.lessons')}>
                {COURSES.map((course) => {
                    const lessons = lessonsOfCourse(course.id);
                    const done = lessons.filter((lesson) => progress[lesson.id]?.completed).length;
                    return (
                        <section key={course.id} data-testid={`learn-course-${course.id}`}
                                 className="bg-acacia p-4 rounded-lg border border-amber-900/50 flex flex-col gap-2">
                            <div className="flex items-baseline justify-between gap-2">
                                <h3 className="text-lg font-bold text-amber-200">{localized(course.title, language)}</h3>
                                <span className="text-xs text-boxwood/70">{tp('learn.lessonsCount', lessons.length)}</span>
                            </div>
                            <p className="text-sm text-boxwood/80">{localized(course.summary, language)}</p>
                            {getToken() && <ProgressBar value={done} max={lessons.length} label={t('learn.lessonsDone')}/>}
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
                                            <ButtonLink to={`/learn/${lesson.id}`} size="sm" variant={p?.completed ? 'secondary' : 'primary'}>
                                                {action}
                                            </ButtonLink>
                                        </li>
                                    );
                                })}
                            </ol>
                        </section>
                    );
                })}
            </Section>
        </Page>
    );
}

/**
 * Урок в проигрывателе: незаконченный открывается с дальнего шага, пройденный — сначала. Дальний шаг и итог экзамена
 * сохраняются на сервере; сбой записи показывается пометкой, урок при этом продолжается.
 */
export function LessonPage() {
    const {lessonId = ''} = useParams();
    const {t, language} = useI18n();
    const lesson = lessonById(lessonId);
    const [progress, loaded] = useProgress();
    const [saveError, setSaveError] = useState(false);
    const furthest = useRef(-1);

    const token = getToken();
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
