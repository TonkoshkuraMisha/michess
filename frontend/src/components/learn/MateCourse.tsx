// --- FILE: frontend/src/components/learn/MateCourse.tsx ---
// Курс матовых конструкций (таск 14.6): /learn/mates — 20 конструкций по порядку и итоговая проверка;
// /learn/mates/:theme — объяснение (текст каталога), два показа, 10 задач от лёгкой к трудной;
// /learn/mates/exam — смешанная проверка на время. Задачи решаются сервером (/puzzles/{id}/move) без рейтинга.
// После задачи доска свободна — позицию можно разыграть (usePositionExplorer).
// Прогресс — как у уроков школы: «mates-<конструкция>» и «mates-exam» (результат проверки).
// В проверке верно решённая задача сменяется сама через SOLVED_PAUSE_MS, а после ошибки остаётся с разбором до
// кнопки «Следующая задача» (отзыв владельца 18.11).
// Данные: services/puzzles.ts (puzzlesApi: mateCourse — GET /course/mates, mateTask — /course/mates/{тема}/{номер}, mateExam — /course/mates/exam,
// demo, move, giveUp); сервер — src/api/puzzles.py и src/services/mate_course.py (там же TASKS, EXAM_SIZE и EXAM_MINUTES).
// Только для вошедших (NeedLogin). Страницы подключены в App.tsx.

import {useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {Link, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {ArrowLeft, ArrowRight, Check, Timer, X} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {fetchLessonProgress, saveLessonProgress} from '../../services/lessonProgress';
import type {LessonProgress} from '../../services/lessonProgress';
import {puzzlesApi} from '../../services/puzzles';
import type {DemoExample, MateCourseOverview, PuzzleView} from '../../services/puzzles';
import {themeText} from '../../services/themes';
import {DemoViewer} from '../puzzles/TrainingPanel';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {ExplorerControls, usePositionExplorer} from '../puzzles/usePositionExplorer';
import {SolutionReplay} from '../puzzles/SolutionReplay';
import type {ReplayView} from '../puzzles/SolutionReplay';
import {sanMoves} from '../puzzles/puzzleNotation';

/** Идентификатор урока с результатом итоговой проверки; новая попытка обновляет запись на сервере. */
export const EXAM_PROGRESS_ID = 'mates-exam';

/** Идентификатор урока конструкции: «mates-<код>», подчёркивания заменены дефисами; по нему же считает автозачёт services/courseProgress.ts. */
export function mateProgressId(code: string): string {
    return `mates-${code.replace(/_/g, '-')}`;
}

/** Прогресс уроков вошедшего по lesson_id (отметки в списке конструкций). */
function useLessonProgress(): Record<string, LessonProgress> {
    const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
    useEffect(() => {
        const token = getToken();
        if (!token) return;
        let alive = true;
        fetchLessonProgress(token)
            .then((items) => alive && setProgress(Object.fromEntries(items.map((p) => [p.lesson_id, p]))))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);
    return progress;
}

/** Сохраняет прогресс вошедшему; сбой записи терпим — следующее сохранение перезапишет. */
function saveProgress(id: string, update: Parameters<typeof saveLessonProgress>[2]) {
    const token = getToken();
    if (token) saveLessonProgress(token, id, update).catch(() => undefined);
}

/** Подсказка гостю: курс матов доступен только вошедшим (эндпоинты закрыты авторизацией). */
function NeedLogin() {
    const {t} = useI18n();
    return <p className="text-amber-300" data-testid="mates-login">{t('mateCourse.loginRequired')}</p>;
}

/** Пауза перед следующей задачей проверки после верного решения: успеть увидеть мат на доске. */
const SOLVED_PAUSE_MS = 800;

/** Ссылка «назад» одного вида на всех страницах курса. */
function BackLink({to, label}: { to: string; label: string }) {
    return <Link to={to} className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {label}</Link>;
}

/**
 * Задача курса: первый ход соперника уже сделан, ходы проверяет сервер. После ошибки или «Показать решение» —
 * разбор (SolutionReplay): решение целиком и, если ошибка была в начальной позиции, опровержение сыгранного хода —
 * пошагово на доске, чтобы было видно, в чём ошибка (отзыв владельца 18.11).
 */
export function CoursePuzzle({puzzle, onDone, children}: {
    puzzle: PuzzleView;
    onDone: (solved: boolean) => void;
    /** Действия под задачей (кнопка «Следующая задача» в итоговой проверке). */
    children?: ReactNode;
}) {
    const {t} = useI18n();
    const start = useMemo(() => {
        const game = new Chess(puzzle.fen);
        const move = game.move({from: puzzle.first_move.slice(0, 2), to: puzzle.first_move.slice(2, 4), promotion: puzzle.first_move[4]});
        return {fen: game.fen(), last: {from: move.from, to: move.to}};
    }, [puzzle]);
    const [fen, setFen] = useState(start.fen);
    const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(start.last);
    const [outcome, setOutcome] = useState<boolean | null>(null);
    const [mark, setMark] = useState<{ square: string; ok: boolean } | null>(null);
    const [solution, setSolution] = useState<string[] | null>(null);
    // Неверный ход, сделанный в начальной позиции задачи, — линия «опровержение» в разборе.
    const [played, setPlayed] = useState<string | null>(null);
    const [replay, setReplay] = useState<ReplayView | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const busy = useRef(false);
    const explorer = usePositionExplorer();

    const apply = (position: string, uci: string) => {
        const game = new Chess(position);
        game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
        return game.fen();
    };

    const finish = (solved: boolean) => {
        setOutcome(solved);
        onDone(solved);
    };

    const onMove = async (uci: string) => {
        // Задача решена или не решена — доска свободна: ход игрока начинает разбор с текущей позиции (стрелку
        // решения можно сыграть самому).
        if (outcome !== null) {
            if (explorer.active) explorer.play(uci);
            else explorer.start(fen, [uci]);
            return;
        }
        if (busy.current) return;
        busy.current = true;
        try {
            const res = await puzzlesApi.move(puzzle.id, uci);
            if (!res.correct) {
                setMark({square: uci.slice(2, 4), ok: false});
                setSolution(res.solution?.length ? res.solution : null);
                if (fen === start.fen) setPlayed(uci);
                finish(false);
                return;
            }
            let next = apply(fen, uci);
            setMark({square: uci.slice(2, 4), ok: true});
            setLastMove({from: uci.slice(0, 2), to: uci.slice(2, 4)});
            if (res.reply) {
                next = apply(next, res.reply);
                setLastMove({from: res.reply.slice(0, 2), to: res.reply.slice(2, 4)});
            }
            setFen(next);
            if (res.done) finish(true);
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            busy.current = false;
        }
    };

    const giveUp = async () => {
        if (outcome !== null) return;
        try {
            const res = await puzzlesApi.giveUp(puzzle.id);
            setSolution(res.solution.length ? res.solution : null);
            finish(false);
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        }
    };

    return (
        <div className="flex flex-col md:flex-row gap-5 items-start" data-testid="course-puzzle">
            <div className="w-full max-w-[520px]">
                <PuzzleBoard fen={replay?.fen ?? explorer.fen ?? fen} orientation={puzzle.color} interactive={!replay}
                             onMove={(uci) => void onMove(uci)}
                             lastMove={replay ? replay.lastMove : explorer.active ? explorer.lastMove : lastMove}
                             mark={replay || explorer.active ? null : mark}
                             arrows={replay ? replay.arrows : solution && !explorer.active
                                 ? [{from: solution[0].slice(0, 2), to: solution[0].slice(2, 4), color: 'green'}] : []}/>
                <ExplorerControls explorer={explorer}/>
            </div>
            <div className="flex-1 flex flex-col gap-2 min-w-0">
                <p className="text-amber-200">{t(puzzle.color === 'white' ? 'mateCourse.whiteMates' : 'mateCourse.blackMates')}</p>
                {outcome === true && <p className="text-emerald-300 flex items-center gap-1" data-testid="course-solved"><Check size={16}/> {t('mateCourse.solved')}</p>}
                {outcome === false && <p className="text-rose-300 flex items-center gap-1" data-testid="course-failed"><X size={16}/> {t('mateCourse.failed')}</p>}
                {outcome === null && (
                    <button type="button" onClick={() => void giveUp()} className="self-start text-sm text-amber-400 hover:underline">
                        {t('mateCourse.showSolution')}
                    </button>
                )}
                {outcome === false && solution && (
                    <SolutionReplay startFen={start.fen} onShow={setReplay} lines={[
                        ...(played ? [{
                            id: 'played', moves: [played], color: 'red' as const,
                            label: t('puzzles.review.refutation', {move: sanMoves(start.fen, [played])[0]}),
                        }] : []),
                        {id: 'solution', moves: solution, color: 'green' as const, label: t('puzzles.review.solution')},
                    ]}/>
                )}
                {children}
                {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            </div>
        </div>
    );
}

/** Конструкции по порядку: отметка «пройдено», число доступных задач и ссылка на итоговую проверку с лучшим результатом. */
export function MateCoursePage() {
    const {t} = useI18n();
    const progress = useLessonProgress();
    const [overview, setOverview] = useState<MateCourseOverview | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const loggedIn = Boolean(getToken());
    useEffect(() => {
        if (!loggedIn) return;
        puzzlesApi.mateCourse().then(setOverview).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [loggedIn]);
    const exam = progress[EXAM_PROGRESS_ID];
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="mates-page">
            <BackLink to="/learn" label={t('learn.title')}/>
            <h1 className="text-2xl font-bold text-amber-200">{t('mateCourse.title')}</h1>
            <p className="text-boxwood/85">{t('mateCourse.intro')}</p>
            {!loggedIn && <NeedLogin/>}
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {overview && (
                <>
                    <ol className="grid sm:grid-cols-2 gap-2">
                        {overview.constructions.map((c, i) => {
                            const saved = progress[mateProgressId(c.code)];
                            const done = saved?.completed;
                            return (
                                <li key={c.code}>
                                    {c.available > 0 ? (
                                        <Link to={`/learn/mates/${c.code}`} data-testid={`mates-item-${c.code}`}
                                              className="flex items-center justify-between gap-2 bg-acacia px-3 py-2 rounded border-2 border-acacia-dark hover:border-amber-500">
                                            <span>{i + 1}. {themeText(c.code, 'name', t)}</span>
                                            {done && <Check size={16} className="text-emerald-400"/>}
                                        </Link>
                                    ) : (
                                        <span className="flex items-center justify-between gap-2 bg-black/20 px-3 py-2 rounded text-boxwood/50"
                                              data-testid={`mates-item-${c.code}`}>
                                            {i + 1}. {themeText(c.code, 'name', t)} <span className="text-xs">{t('mateCourse.soon')}</span>
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                    <Link to="/learn/mates/exam" data-testid="mates-exam-link"
                          className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold flex items-center gap-2">
                        <Timer size={16}/> {t('mateCourse.examTitle', {minutes: overview.exam_minutes})}
                    </Link>
                    {exam?.exam_score != null && (
                        <p className="text-sm">{t('mateCourse.examBest', {score: exam.exam_score, total: exam.exam_total ?? overview.exam_size})}</p>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * Конструкция: примеры показа, затем набор задач по порядку. Результат каждой задачи пишется в прогресс; последняя задача
 * набора закрывает конструкцию, число задач берётся из обзора курса (available).
 */
export function MateConstructionPage() {
    const {t} = useI18n();
    const {theme = ''} = useParams<{ theme: string }>();
    const [examples, setExamples] = useState<DemoExample[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [index, setIndex] = useState<number | null>(null);
    const [puzzle, setPuzzle] = useState<PuzzleView | null>(null);
    const [results, setResults] = useState<boolean[]>([]);
    const [error, setError] = useState<UiMessage | null>(null);
    const loggedIn = Boolean(getToken());

    useEffect(() => {
        if (!loggedIn) return;
        puzzlesApi.demo(theme).then((r) => setExamples(r.examples)).catch(() => setExamples([]));
        puzzlesApi.mateCourse()
            .then((o) => setTotal(o.constructions.find((c) => c.code === theme)?.available ?? 0))
            .catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [theme, loggedIn]);

    const open = (next: number) => {
        setIndex(next);
        setPuzzle(null);
        puzzlesApi.mateTask(theme, next).then(setPuzzle).catch((err) => setError(errorMessage(err, 'common.networkError')));
    };

    const done = (solved: boolean) => {
        if (index === null || total === null) return;
        setResults((list) => [...list, solved]);
        const last = index === total - 1;
        saveProgress(mateProgressId(theme), {step: last ? total - 1 : index + 1, steps_total: total, completed: last});
    };

    const solvedCount = results.filter(Boolean).length;
    const finished = index !== null && total !== null && index === total - 1 && results.length === total;

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="mates-construction">
            <BackLink to="/learn/mates" label={t('mateCourse.title')}/>
            <h1 className="text-2xl font-bold text-amber-200">{themeText(theme, 'name', t)}</h1>
            {!loggedIn && <NeedLogin/>}
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {loggedIn && index === null && (
                <>
                    <p className="text-boxwood/90" data-testid="mates-explain">{themeText(theme, 'explain', t)}</p>
                    {examples.length > 0 && (
                        <section className="flex flex-col gap-2 max-w-[520px]">
                            <h2 className="font-bold text-amber-200">{t('mateCourse.demos')}</h2>
                            <DemoViewer examples={examples}/>
                        </section>
                    )}
                    {total !== null && total > 0 && (
                        <button type="button" onClick={() => open(0)} data-testid="mates-start"
                                className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold flex items-center gap-2">
                            {t('mateCourse.startTasks', {total})} <ArrowRight size={16}/>
                        </button>
                    )}
                </>
            )}
            {index !== null && total !== null && (
                <>
                    <p className="text-sm text-boxwood/80" data-testid="mates-task-of">
                        {t('mateCourse.taskOf', {index: index + 1, total})} · {t('mateCourse.solvedCount', {solved: solvedCount, done: results.length})}
                    </p>
                    {puzzle && <CoursePuzzle key={puzzle.id} puzzle={puzzle} onDone={done}/>}
                    {results.length === index + 1 && !finished && (
                        <button type="button" onClick={() => open(index + 1)} data-testid="mates-next"
                                className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold flex items-center gap-2">
                            {t('mateCourse.nextTask')} <ArrowRight size={16}/>
                        </button>
                    )}
                    {finished && (
                        <div className="bg-black/40 rounded p-3 flex flex-wrap items-center gap-3" data-testid="mates-finished">
                            <span>{t('mateCourse.constructionDone', {solved: solvedCount, total})}</span>
                            <Link to="/learn/mates" className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold">{t('mateCourse.backToCourse')}</Link>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * Итоговая проверка: план задач и минуты даёт сервер, отсчёт времени ведёт клиент (deadline). Проверка кончается по времени или
 * после последней задачи; результат сохраняется один раз (saved).
 */
export function MateExamPage() {
    const {t} = useI18n();
    const [plan, setPlan] = useState<{ theme: string; index: number }[] | null>(null);
    const [deadline, setDeadline] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [current, setCurrent] = useState(0);
    const [puzzle, setPuzzle] = useState<PuzzleView | null>(null);
    const [results, setResults] = useState<boolean[]>([]);
    const [error, setError] = useState<UiMessage | null>(null);
    // После ошибки задача остаётся на экране с разбором решения, пока игрок не нажмёт «Следующая задача».
    const [reviewing, setReviewing] = useState(false);
    const saved = useRef(false);
    const loggedIn = Boolean(getToken());

    const secondsLeft = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
    const over = plan !== null && deadline !== null && (secondsLeft === 0 || (results.length >= plan.length && !reviewing));
    const score = results.filter(Boolean).length;

    useEffect(() => {
        if (deadline === null || over) return;
        const id = window.setInterval(() => setNow(Date.now()), 500);
        return () => window.clearInterval(id);
    }, [deadline, over]);

    useEffect(() => {
        if (!over || saved.current || !plan) return;
        saved.current = true;
        saveProgress(EXAM_PROGRESS_ID, {step: 0, steps_total: 1, completed: true, exam_score: score, exam_total: plan.length});
    }, [over, plan, score]);

    const load = (tasks: { theme: string; index: number }[], i: number) => {
        setPuzzle(null);
        puzzlesApi.mateTask(tasks[i].theme, tasks[i].index).then(setPuzzle).catch((err) => setError(errorMessage(err, 'common.networkError')));
    };

    const start = async () => {
        try {
            const exam = await puzzlesApi.mateExam();
            saved.current = false;
            setPlan(exam.tasks);
            setResults([]);
            setReviewing(false);
            setCurrent(0);
            setNow(Date.now());
            setDeadline(Date.now() + exam.minutes * 60_000);
            if (exam.tasks.length) load(exam.tasks, 0);
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        }
    };

    const advance = () => {
        if (plan && current + 1 < plan.length) {
            setCurrent(current + 1);
            load(plan, current + 1);
        }
    };

    const done = (solved: boolean) => {
        setResults((list) => [...list, solved]);
        if (solved) window.setTimeout(advance, SOLVED_PAUSE_MS);
        else setReviewing(true);
    };

    const next = () => {
        setReviewing(false);
        advance();
    };

    const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="mates-exam">
            <BackLink to="/learn/mates" label={t('mateCourse.title')}/>
            <h1 className="text-2xl font-bold text-amber-200">{t('mateCourse.examHeading')}</h1>
            {!loggedIn && <NeedLogin/>}
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {loggedIn && (plan === null || over) && (
                <>
                    {over && plan && (
                        <p className="text-lg text-amber-200" data-testid="mates-exam-result">
                            {t('mateCourse.examResult', {score, total: plan.length})}
                        </p>
                    )}
                    {!over && <p className="text-boxwood/85">{t('mateCourse.examIntro')}</p>}
                    <button type="button" onClick={() => void start()} data-testid="mates-exam-start"
                            className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold flex items-center gap-2">
                        <Timer size={16}/> {t(over ? 'mateCourse.examAgain' : 'mateCourse.examStart')}
                    </button>
                </>
            )}
            {plan && !over && (
                <>
                    <p className="text-sm flex items-center gap-3" data-testid="mates-exam-status">
                        <span className="font-mono text-amber-300 text-lg">{clock}</span>
                        <span>{t('mateCourse.taskOf', {index: current + 1, total: plan.length})}</span>
                        <span>{t('mateCourse.solvedCount', {solved: score, done: results.length})}</span>
                    </p>
                    {puzzle && (
                        <CoursePuzzle key={puzzle.id} puzzle={puzzle} onDone={done}>
                            {reviewing && (
                                <button type="button" onClick={next} data-testid="mates-exam-next"
                                        className="self-start px-4 py-2 rounded bg-amber-700 hover:bg-amber-600 text-white font-bold flex items-center gap-2 cursor-pointer">
                                    {t(current + 1 < (plan?.length ?? 0) ? 'mateCourse.nextTask' : 'mateCourse.examFinish')}
                                    <ArrowRight size={16}/>
                                </button>
                            )}
                        </CoursePuzzle>
                    )}
                </>
            )}
        </div>
    );
}
