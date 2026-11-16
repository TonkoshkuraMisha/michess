// Большой курс (таск 27.6): /learn/course — уровни 0–5 по разрядам, модули по ветвям (тактика, мат, эндшпиль,
// стратегия, дебют, расчёт, партии). Шаги модуля ведут в готовые разделы; модуль без шагов — место в каркасе под
// наполнение: игроку не показывается, виден в режиме «каркас курса». Прогресс модуля — запись урока course-<код>.

import {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {CheckCircle2, Circle, Layers, Trophy} from 'lucide-react';
import {useI18n} from '../../i18n';
import {getToken} from '../../services/authToken';
import {fetchLessonProgress, saveLessonProgress} from '../../services/lessonProgress';
import {BRANCHES, COURSE, courseProgressId, LEVEL_COUNT, LEVEL_EXAM_TARGET, levelExamPassed, moduleTitleKey} from '../../content/supercourse';
import {fetchExamSummary} from '../ExamPage';
import {activityLink} from '../../content/programs';
import {activityLabel} from '../ProgramsPage';

export function SupercoursePage() {
    const {t, language} = useI18n();
    const navigate = useNavigate();
    const [level, setLevel] = useState(0);
    const [skeleton, setSkeleton] = useState(false);
    const [done, setDone] = useState<Set<string>>(new Set());
    const [examPassed, setExamPassed] = useState<Set<number>>(new Set());
    const logged = Boolean(getToken());

    useEffect(() => {
        const token = getToken();
        if (!token) return;
        fetchLessonProgress(token).then((rows) => {
            const ids = new Set(rows.filter((r) => r.completed).map((r) => r.lesson_id));
            setDone((prev) => new Set([...prev, ...COURSE.filter((m) => ids.has(courseProgressId(m.code))).map((m) => m.code)]));
        }).catch(() => undefined);
        fetchExamSummary().then((summary) => {
            const passed = Array.from({length: LEVEL_COUNT}, (_, n) => n).filter((n) => levelExamPassed(n, summary.results));
            setExamPassed(new Set(passed));
            setDone((prev) => new Set([...prev, ...passed.map((n) => `X${n}`)]));
        }).catch(() => undefined);
    }, []);

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
            {BRANCHES.map((branch) => {
                const items = modules.filter((m) => m.branch === branch);
                if (items.length === 0) return null;
                return (
                    <section key={branch} className="flex flex-col gap-1.5" data-testid={`course-branch-${branch}`}>
                        <h2 className="font-bold text-amber-200">{t(`supercourse.branches.${branch}`)}</h2>
                        <ul className="flex flex-col gap-1.5">
                            {items.map((module) => (
                                <li key={module.code} data-testid={`course-module-${module.code}`}
                                    className={`rounded-lg p-2.5 flex flex-col gap-1 text-sm border ${module.steps.length ? 'bg-acacia border-acacia-dark' : 'bg-black/20 border-dashed border-amber-900/50 opacity-70'}`}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {done.has(module.code) ? <CheckCircle2 size={16} className="text-emerald-400"/> : <Circle size={16} className="text-amber-700"/>}
                                        <span className="font-mono text-xs text-amber-300">{module.code}</span>
                                        <span className="font-bold text-amber-100 min-w-0 break-words">{t(moduleTitleKey(module.code) as 'supercourse.title')}</span>
                                        {module.steps.length === 0 && <span className="text-xs text-boxwood/60">{t('supercourse.soon')}</span>}
                                        {module.code.startsWith('X') && (
                                            <span className="text-xs text-boxwood/70" data-testid={`course-exam-target-${module.level}`}>
                                                {t(examPassed.has(module.level) ? 'supercourse.levelPassed' : 'supercourse.examTarget', {rating: LEVEL_EXAM_TARGET[module.level]})}
                                            </span>
                                        )}
                                        {module.steps.length > 0 && logged && !done.has(module.code) && !module.code.startsWith('X') && (
                                            <button type="button" onClick={() => void markDone(module.code)} data-testid={`course-done-${module.code}`}
                                                    className="ml-auto px-2 py-0.5 rounded bg-amber-700 text-white text-xs font-bold">{t('supercourse.markDone')}</button>
                                        )}
                                    </div>
                                    {module.steps.length > 0 && (
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6">
                                            {module.steps.map((step, i) => {
                                                const link = activityLink(step);
                                                return (
                                                    <button key={i} type="button" onClick={() => navigate(link.to, {state: link.state})}
                                                            className="text-left text-xs text-amber-200 hover:underline">
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
