// Программы тренировок (таск 22.3): /programs — четыре программы по уровням с прогрессом; /programs/:id — 8 недель
// по 5 занятий, текущее занятие отмечено, упражнения ведут в готовые разделы. Прогресс — запись урока
// «program-<id>» (шаг — последнее пройденное занятие), без входа план виден, но не сохраняется.
// Автозачёт (план владельца 18.11, по правилам Большого курса — services/courseProgress.ts): по фактам
// GET /learn/course-progress выполненные упражнения отмечены галочкой, а подряд идущие занятия, где сделаны все
// проверяемые упражнения, засчитываются сами (programAutoCount). Занятие без проверяемых упражнений (репертуар,
// библиотека, «угадай ход», партия, разминка) отмечается кнопкой, как раньше.

import {examTitle} from './ExamPage';
import {useEffect, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, CalendarCheck, Check, CheckCircle2, Circle} from 'lucide-react';
import {hasMessage, useI18n} from '../i18n';
import type {Language} from '../i18n/core';
import {getToken} from '../services/authToken';
import {fetchLessonProgress, saveLessonProgress} from '../services/lessonProgress';
import {activityDone, fetchCourseFacts, programAutoCount} from '../services/courseProgress';
import type {CourseFacts} from '../services/courseProgress';
import {activityLink, PROGRAMS, programById, SESSIONS_PER_PROGRAM} from '../content/programs';
import type {Activity} from '../content/programs';
import {lessonById, localized} from '../content/lessons';

/** Код записи урока, в которой хранится прогресс программы (таблица прогресса уроков, services/lessonProgress.ts). */
export const progressId = (programId: string) => `program-${programId}`;

/** Подпись упражнения — из каталогов самих разделов. */
export function activityLabel(t: (key: never) => string, language: Language, activity: Activity): string {
    const tr = t as unknown as (key: string, params?: Record<string, string | number>) => string;
    const safe = (key: string, fallback: string) => (hasMessage(key) ? tr(key) : fallback);
    switch (activity.kind) {
        case 'basics': return `${tr('basics.title')}: ${safe(`basics.sections.${activity.id}.title`, activity.id)}`;
        case 'lesson': return localized(lessonById(activity.id)?.title, language) || activity.id;
        case 'mates': return `${tr('programs.activities.mate')}: ${safe(`themes.${activity.id}.name`, activity.id)}`;
        case 'endgame': return `${tr('programs.activities.endgame')}: ${safe(`endgames.items.${activity.id}`, activity.id)}`;
        case 'theme': return `${tr('programs.activities.puzzles')}: ${safe(`themes.${activity.id}.name`, activity.id)}`;
        case 'trainer': return `${tr('programs.activities.trainer')}: ${safe(`trainers.${activity.id}.title`, activity.id)}`;
        case 'mini': return safe(`miniGames.games.${activity.id}.title`, activity.id);
        case 'exam': return examTitle(tr, activity.id);
        case 'library': return activity.structure
            ? `${tr('library.title')}: ${safe(`structures.${activity.structure}`, activity.structure)}`
            : activity.moves ? `${tr('library.title')}: ${activity.moves}` : tr('library.title');
        case 'workout': return tr('workout.title');
        case 'repertoire': return tr('repertoire.title');
        case 'classics': return tr('programs.activities.classics');
        case 'guess': return tr('programs.activities.guess');
        case 'play': return tr('programs.activities.play');
    }
}

/**
 * Пройденные занятия программ (запись урока program-<id>) и отметка нового счёта. loaded — сохранённый прогресс уже
 * прочитан: до этого автозачёт не пишет, иначе ранний ответ затёр бы сохранённое.
 */
function useProgramProgress(): [Record<string, number>, (programId: string, done: number) => Promise<void>, boolean] {
    const [done, setDone] = useState<Record<string, number>>({});
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        const token = getToken();
        if (!token) return;
        fetchLessonProgress(token).then((rows) => {
            const map: Record<string, number> = {};
            for (const program of PROGRAMS) {
                const row = rows.find((r) => r.lesson_id === progressId(program.id));
                if (row) map[program.id] = row.completed ? SESSIONS_PER_PROGRAM : row.step + 1;
            }
            setDone(map);
            setLoaded(true);
        }).catch(() => undefined);
    }, []);
    const mark = async (programId: string, count: number) => {
        const token = getToken();
        if (!token) return;
        await saveLessonProgress(token, progressId(programId), {
            step: count - 1, steps_total: SESSIONS_PER_PROGRAM, completed: count >= SESSIONS_PER_PROGRAM,
        });
        setDone((d) => ({...d, [programId]: count}));
    };
    return [done, mark, loaded];
}

/** Список программ тренировок с прогрессом по каждой (занятий пройдено из SESSIONS_PER_PROGRAM). */
export function ProgramsPage() {
    const {t} = useI18n();
    const [done] = useProgramProgress();
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="programs-page">
            <header className="flex items-center gap-2">
                <CalendarCheck className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('programs.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('programs.intro')}</p>
            {!getToken() && <p className="text-amber-300 text-sm">{t('programs.loginToSave')}</p>}
            <div className="grid sm:grid-cols-2 gap-3">
                {PROGRAMS.map((program) => (
                    <Link key={program.id} to={`/programs/${program.id}`} data-testid={`program-${program.id}`}
                          className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark hover:border-amber-500 flex flex-col gap-1">
                        <span className="font-bold text-amber-200">{t(`programs.items.${program.id}.name`)}</span>
                        <span className="text-xs text-amber-300">{t('programs.range', {from: program.range[0], to: program.range[1]})}</span>
                        <span className="text-sm text-boxwood/85">{t(`programs.items.${program.id}.intro`)}</span>
                        <span className="text-xs text-boxwood/70">{t('programs.progress', {done: done[program.id] ?? 0, total: SESSIONS_PER_PROGRAM})}</span>
                    </Link>
                ))}
            </div>
        </div>
    );
}

/**
 * Одна программа: недели и занятия. Автозачёт (programAutoCount) запускается, когда известны и сохранённый
 * прогресс, и факты о курсе. Индекс занятия = неделя * 5 + номер в неделе (пять занятий в неделе).
 */
export function ProgramPage() {
    const {t, language} = useI18n();
    const navigate = useNavigate();
    const {programId = ''} = useParams<{ programId: string }>();
    const program = programById(programId);
    const [done, mark, loaded] = useProgramProgress();
    const [facts, setFacts] = useState<CourseFacts | null>(null);
    const count = program ? done[program.id] ?? 0 : 0;
    const logged = Boolean(getToken());

    useEffect(() => {
        if (logged) fetchCourseFacts().then(setFacts).catch(() => undefined);
    }, [logged]);
    // Автозачёт: подряд идущие занятия, закрытые сами, — когда известны и сохранённый прогресс, и факты.
    useEffect(() => {
        if (!program || !facts || !loaded) return;
        const next = programAutoCount(program.weeks.flat(), count, facts);
        if (next > count) void mark(program.id, next);
    }, [program, facts, loaded, count]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!program) return <p className="p-4 text-rose-300">{t('programs.notFound')}</p>;

    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="program-page">
            <Link to="/programs" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('programs.title')}</Link>
            <h1 className="text-2xl font-bold text-amber-200">{t(`programs.items.${program.id}.name`)}</h1>
            <p className="text-boxwood/85">{t(`programs.items.${program.id}.intro`)}</p>
            <p className="font-bold text-amber-300" data-testid="program-progress">
                {count >= SESSIONS_PER_PROGRAM ? t('programs.finished') : t('programs.progress', {done: count, total: SESSIONS_PER_PROGRAM})}
            </p>
            {program.weeks.map((week, w) => (
                <section key={w} className="flex flex-col gap-1.5">
                    <h2 className="font-bold text-amber-200">{t('programs.week', {n: w + 1})}</h2>
                    <ol className="flex flex-col gap-1">
                        {week.map((session, s) => {
                            const index = w * 5 + s;
                            const isDone = index < count;
                            const isCurrent = index === count;
                            return (
                                <li key={s} data-testid={`session-${index}`}
                                    className={`rounded p-2 flex flex-wrap items-center gap-2 text-sm ${isCurrent ? 'bg-amber-900/40 border border-amber-600' : 'bg-black/25'}`}>
                                    {isDone ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0"/> : <Circle size={16} className="text-amber-700 shrink-0"/>}
                                    <span className="text-xs text-boxwood/60 shrink-0">{t('programs.session', {n: s + 1})}</span>
                                    {session.map((activity, a) => {
                                        const link = activityLink(activity);
                                        const checked = facts ? activityDone(activity, facts) : null;
                                        return (
                                            <button key={a} type="button" onClick={() => navigate(link.to, {state: link.state})}
                                                    data-testid={checked ? `activity-done-${index}-${a}` : undefined}
                                                    className="text-left hover:underline text-amber-100 min-w-0 break-words inline-flex items-center gap-1">
                                                {checked && <Check size={13} className="text-emerald-400 shrink-0" aria-label={t('programs.activityDone')}/>}
                                                {activityLabel(t as never, language, activity)}
                                            </button>
                                        );
                                    })}
                                    {isCurrent && logged && (
                                        <button type="button" onClick={() => void mark(program.id, count + 1)} data-testid="session-done"
                                                className="ml-auto px-2 py-1 rounded bg-amber-700 text-white text-xs font-bold">
                                            {t('programs.markDone')}
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                </section>
            ))}
        </div>
    );
}
