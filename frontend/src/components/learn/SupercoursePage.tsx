// --- FILE: frontend/src/components/learn/SupercoursePage.tsx ---
// Большой курс (таск 27.6): /learn/course — уровни 0–5 по разрядам, модули по ветвям (тактика, мат, эндшпиль,
// стратегия, дебют, расчёт, партии). Шаги модуля ведут в готовые разделы; модуль без шагов — место в каркасе под
// наполнение: игроку не показывается, виден в режиме «каркас курса». В каркасе для автора — шаги в работе (draft) с
// пометкой и таблица покрытия: сколько модулей готово, в работе и пусто по уровням и ветвям. Модуль закрывается сам,
// когда выполнены все его проверяемые шаги (автозачёт — services/courseProgress.ts, нормативы на сервере),
// выполненный шаг помечен галочкой;
// модуль из непроверяемых шагов (библиотека, репертуар…) игрок отмечает сам — запись урока course-<код>.
// Ссылка ?level=N&module=КОД (карточка «Урок по теме ошибки» в итоге партии) открывает уровень N и подсвечивает
// модуль, прокручивая к нему.
// Данные: content/supercourse.ts (COURSE, BRANCHES, пороги экзаменов уровней), content/programs.ts (ссылки шагов); экзамены уровней (модули X<n>) —
// fetchExamSummary из ExamPage.tsx; темы без задач — puzzlesApi.training(). Подключено в App.tsx.

import {useEffect, useMemo, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {Check, CheckCircle2, Circle, Layers, Trophy} from 'lucide-react';
import {activityDone, fetchCourseFacts, moduleAutoDone, moduleCheckable} from '../../services/courseProgress';
import type {CourseFacts} from '../../services/courseProgress';
import {useI18n} from '../../i18n';
import {getToken} from '../../services/authToken';
import {fetchLessonProgress, saveLessonProgress} from '../../services/lessonProgress';
import {
    BRANCHES, COURSE, courseProgressId, coverage, LEVEL_COUNT, LEVEL_EXAM_TARGET, levelExamPassed, moduleStatus, moduleTitleKey,
} from '../../content/supercourse';
import {fetchExamSummary} from '../ExamPage';
import {puzzlesApi} from '../../services/puzzles';
import {activityLink} from '../../content/programs';
import {activityLabel} from '../ProgramsPage';

/**
 * Большой курс: вкладки уровней, модули по ветвям. Множество done складывается из четырёх источников: записи уроков, автозачёт
 * по фактам, пройденные экзамены уровней и ручная отметка непроверяемых модулей (markDone).
 */
export function SupercoursePage() {
    const {t, language} = useI18n();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const focusModule = params.get('module');
    const [level, setLevel] = useState(() => {
        const asked = Number(params.get('level'));
        return Number.isInteger(asked) && asked >= 0 && asked < LEVEL_COUNT ? asked : 0;
    });
    const [skeleton, setSkeleton] = useState(false);
    const [done, setDone] = useState<Set<string>>(new Set());
    const [examPassed, setExamPassed] = useState<Set<number>>(new Set());
    // Темы, в которых пока нет ни одной задачи: шаг не ведёт в пустую тренировку, а помечен «задач пока нет».
    const [emptyThemes, setEmptyThemes] = useState<Set<string>>(new Set());
    // Выполненное игроком по видам упражнений (автозачёт): модуль закрывается сам, когда сделаны все его проверяемые шаги.
    const [facts, setFacts] = useState<CourseFacts | null>(null);
    const logged = Boolean(getToken());

    useEffect(() => {
        const token = getToken();
        if (!token) return;
        fetchLessonProgress(token).then((rows) => {
            const ids = new Set(rows.filter((r) => r.completed).map((r) => r.lesson_id));
            setDone((prev) => new Set([...prev, ...COURSE.filter((m) => ids.has(courseProgressId(m.code))).map((m) => m.code)]));
        }).catch(() => undefined);
        puzzlesApi.training().then((overview) => {
            setEmptyThemes(new Set(overview.themes.filter((th) => th.available.every((n) => n === 0)).map((th) => th.code)));
        }).catch(() => undefined);
        fetchCourseFacts().then((next) => {
            if (!next) return;
            setFacts(next);
            setDone((prev) => new Set([...prev, ...COURSE.filter((m) => moduleAutoDone(m, next)).map((m) => m.code)]));
        }).catch(() => undefined);
        fetchExamSummary().then((summary) => {
            const passed = Array.from({length: LEVEL_COUNT}, (_, n) => n).filter((n) => levelExamPassed(n, summary.results));
            setExamPassed(new Set(passed));
            setDone((prev) => new Set([...prev, ...passed.map((n) => `X${n}`)]));
        }).catch(() => undefined);
    }, []);

    // Модуль из ссылки — в видимую часть страницы (scrollIntoView есть не везде, например в jsdom тестов).
    useEffect(() => {
        if (focusModule) document.querySelector(`[data-testid="course-module-${focusModule}"]`)?.scrollIntoView?.({block: 'center'});
    }, [focusModule]);

    const filled = COURSE.filter((m) => m.steps.length > 0).length;
    const modules = useMemo(() => COURSE.filter((m) => m.level === level && (skeleton || m.steps.length > 0)), [level, skeleton]);
    const levelDone = (n: number) => COURSE.filter((m) => m.level === n && m.steps.length > 0 && done.has(m.code)).length;
    const levelTotal = (n: number) => COURSE.filter((m) => m.level === n && m.steps.length > 0).length;

    const markDone = async (code: string) => {
        const token = getToken();
        if (!token) return;
        await saveLessonProgress(token, courseProgressId(code), {step: 0, steps_total: 1, completed: true});
        setDone((set) => new Set(set).add(code));
    };

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="supercourse-page">
            <header className="flex items-center gap-2">
                <Layers className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('supercourse.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('supercourse.intro')}</p>
            <div className="flex flex-wrap gap-1.5" role="tablist">
                {Array.from({length: LEVEL_COUNT}, (_, n) => (
                    <button key={n} type="button" role="tab" aria-selected={level === n} onClick={() => setLevel(n)} data-testid={`course-level-${n}`}
                            className={`px-3 py-1.5 rounded text-sm border ${level === n ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`}>
                        {examPassed.has(n) && <Trophy size={13} className="inline mr-1 text-amber-300" aria-label={t('supercourse.levelPassed')}/>}
                        {t(`supercourse.levels.l${n}` as 'supercourse.levels.l0')} <span className="text-xs opacity-70">{levelDone(n)}/{levelTotal(n)}</span>
                    </button>
                ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-boxwood/80 self-start cursor-pointer">
                <input type="checkbox" checked={skeleton} onChange={(e) => setSkeleton(e.target.checked)} className="accent-amber-600" data-testid="course-skeleton"/>
                {t('supercourse.skeleton', {filled, total: COURSE.length})}
            </label>
            {skeleton && <CoverageTable/>}
            {BRANCHES.map((branch) => {
                const items = modules.filter((m) => m.branch === branch);
                if (items.length === 0) return null;
                return (
                    <section key={branch} className="flex flex-col gap-1.5" data-testid={`course-branch-${branch}`}>
                        <h2 className="font-bold text-amber-200">{t(`supercourse.branches.${branch}`)}</h2>
                        <ul className="flex flex-col gap-1.5">
                            {items.map((module) => (
                                <li key={module.code} data-testid={`course-module-${module.code}`}
                                    aria-current={focusModule === module.code ? 'true' : undefined}
                                    className={`rounded-lg p-2.5 flex flex-col gap-1 text-sm border ${module.steps.length ? 'bg-acacia border-acacia-dark' : 'bg-black/20 border-dashed border-amber-900/50 opacity-70'} ${focusModule === module.code ? 'ring-2 ring-amber-400' : ''}`}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {done.has(module.code) ? <CheckCircle2 size={16} className="text-emerald-400"/> : <Circle size={16} className="text-amber-700"/>}
                                        <span className="font-mono text-xs text-amber-300">{module.code}</span>
                                        <span className="font-bold text-amber-100 min-w-0 break-words">{t(moduleTitleKey(module.code) as 'supercourse.title')}</span>
                                        {moduleStatus(module) === 'empty' && <span className="text-xs text-boxwood/60">{t('supercourse.soon')}</span>}
                                        {module.code.startsWith('X') && (
                                            <span className="text-xs text-boxwood/70" data-testid={`course-exam-target-${module.level}`}>
                                                {t(examPassed.has(module.level) ? 'supercourse.levelPassed' : 'supercourse.examTarget', {rating: LEVEL_EXAM_TARGET[module.level]})}
                                            </span>
                                        )}
                                        {module.steps.length > 0 && logged && !done.has(module.code) && !moduleCheckable(module) && (
                                            <button type="button" onClick={() => void markDone(module.code)} data-testid={`course-done-${module.code}`}
                                                    className="ml-auto px-2 py-0.5 rounded bg-amber-700 text-white text-xs font-bold">{t('supercourse.markDone')}</button>
                                        )}
                                    </div>
                                    {skeleton && module.draft && module.draft.length > 0 && (
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6" data-testid={`course-draft-${module.code}`}>
                                            {module.draft.map((step, i) => (
                                                <span key={i} className="text-xs text-boxwood/60 italic">
                                                    {activityLabel(t as never, language, step)} · {t('supercourse.draftStep')}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {module.steps.length > 0 && (
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6">
                                            {module.steps.map((step, i) => {
                                                const link = activityLink(step);
                                                if ((step.kind === 'theme' || step.kind === 'mates') && emptyThemes.has(step.id)) {
                                                    return (
                                                        <span key={i} className="text-xs text-boxwood/50" title={t('supercourse.noPuzzlesYet')}
                                                              data-testid={`course-step-empty-${step.id}`}>
                                                            {activityLabel(t as never, language, step)} · {t('supercourse.noPuzzlesYet')}
                                                        </span>
                                                    );
                                                }
                                                const stepDone = facts ? activityDone(step, facts) === true : false;
                                                return (
                                                    <button key={i} type="button" onClick={() => navigate(link.to, {state: link.state})}
                                                            data-testid={stepDone ? `course-step-done-${module.code}-${i}` : undefined}
                                                            className={`text-left text-xs hover:underline ${stepDone ? 'text-emerald-300' : 'text-amber-200'}`}>
                                                        {stepDone && <Check size={11} className="inline mr-0.5" aria-label={t('supercourse.stepDone')}/>}
                                                        {activityLabel(t as never, language, step)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}

/**
 * Покрытие курса для автора (режим «каркас»): строки — уровни, столбцы — ветви, в ячейке — сколько модулей готово, в
 * работе и пусто (content/supercourse.ts, coverage). Ячейка без модулей — прочерк.
 */
function CoverageTable() {
    const {t} = useI18n();
    const table = coverage(COURSE);
    return (
        <div className="overflow-x-auto" data-testid="course-coverage">
            <table className="text-xs border-collapse">
                <caption className="text-left font-bold text-amber-200 pb-1">{t('supercourse.coverage.title')}</caption>
                <thead>
                    <tr>
                        <th className="px-2 py-1 text-left">{t('supercourse.coverage.level')}</th>
                        {BRANCHES.map((branch) => <th key={branch} className="px-2 py-1 text-left">{t(`supercourse.branches.${branch}`)}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {table.map((row, level) => (
                        <tr key={level} className="border-t border-amber-900/40">
                            <th className="px-2 py-1 text-left font-normal">{level}</th>
                            {row.map((cell, i) => (
                                <td key={BRANCHES[i]} className="px-2 py-1" data-testid={`coverage-${level}-${BRANCHES[i]}`}>
                                    {cell.ready + cell.draft + cell.empty === 0 ? '—' : t('supercourse.coverage.cell', cell)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
