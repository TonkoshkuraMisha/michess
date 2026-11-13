// --- FILE: frontend/src/components/puzzles/PuzzlesPage.tsx ---
// Режим «Приёмы» (таск 13.4) — TrainingPanel: путь по теме реестра со ступенями и смешанные подборки.
// Режим «Упражнения» (таск 13.7) — GeneratedDrills: позиции-генераторы «вид × фигура», уровни, «на минуту».
// Режим «Защита» (таск 13.6) — DefenseTrainer: «Что грозит?», «Не зевни», «Единственная защита».
// Режим «Мои ошибки» (таск 13.5) — позиции перед ошибками в партиях игрока с повторением через интервалы.
// Страница задач (таск 13.3): решение по рейтингу или теме, задача дня, режим на время (3/5 минут, три ошибки —
// конец, личный рекорд), подсказка, «Показать решение», итог с изменением рейтинга, история и график рейтинга,
// «Разобрать с наставником» — позиция задачи на свободной доске с включённым наставником.

import {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Chess} from 'chess.js';
import {format, parseISO} from 'date-fns';
import {Puzzle as PuzzleIcon, Lightbulb, Flag, ArrowRight, GraduationCap, Timer, CalendarDays} from 'lucide-react';
import {hasMessage, renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {UiError} from '../../services/apiErrors';
import {DEFENSE_DRILL_THEMES, puzzlesApi} from '../../services/puzzles';
import type {DrillKind} from '../../services/puzzles';
import type {
    DefenseKind, HintResponse, PersonalAnswer, PersonalSummary, PersonalView, PuzzleProfile, PuzzleResult, PuzzleView,
    TimedResult, TimedRun, TrainingTarget,
} from '../../services/puzzles';
import {fetchThemeRegistry, themeText} from '../../services/themes';
import type {ThemeRegistry, ThemeSection} from '../../services/themes';
import {DefenseTrainer} from './DefenseTrainer';
import {GeneratedDrills} from './GeneratedDrills';
import {PuzzleBoard} from './PuzzleBoard';
import {sanMoves, solutionSan, toMove} from './puzzleNotation';
import {TrainingPanel} from './TrainingPanel';
import {SolutionReplay} from './SolutionReplay';
import type {ReplayView} from './SolutionReplay';

type Mode = 'rated' | 'themes' | 'defense' | 'drills' | 'personal' | 'daily' | 'timed';
const MODES: Mode[] = ['rated', 'themes', 'defense', 'drills', 'personal', 'daily', 'timed'];
type Phase = 'idle' | 'loading' | 'opponent' | 'solving' | 'waiting' | 'done';

const OPPONENT_DELAY_MS = 500;
const REPLY_DELAY_MS = 400;
const SOLUTION_STEP_MS = 700;

export {solutionSan};

function errorOf(err: unknown): UiMessage {
    return err instanceof UiError ? err.ui : {key: 'common.networkError'};
}

export function RatingChart({history}: { history: PuzzleProfile['history'] }) {
    const {t} = useI18n();
    const points = [...history].reverse().map((h) => h.rating_after);
    if (points.length < 2) return null;
    const min = Math.min(...points) - 10;
    const max = Math.max(...points) + 10;
    const path = points.map((value, i) => {
        const x = (i / (points.length - 1)) * 100;
        const y = 40 - ((value - min) / (max - min)) * 40;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return (
        <svg viewBox="0 0 100 40" className="w-full h-16" role="img" aria-label={t('puzzles.chart')}
             data-testid="puzzle-chart" preserveAspectRatio="none">
            <polyline points={path} fill="none" stroke="rgb(251, 191, 36)" strokeWidth="1.2"
                      vectorEffect="non-scaling-stroke"/>
        </svg>
    );
}

/** Имя бота-соперника из каталога (исторический мастер); незнакомый id — как есть. */
function botShortName(id: string, t: ReturnType<typeof useI18n>['t']): string {
    const key = `bots.profiles.${id}.shortName`;
    return hasMessage(key) ? t(key) : id;
}

export default function PuzzlesPage() {
    const {t, dateLocale} = useI18n();
    const navigate = useNavigate();
    const [mode, setMode] = useState<Mode>('rated');
    const [theme, setTheme] = useState<string | null>(null);
    const [registry, setRegistry] = useState<ThemeRegistry | null>(null);
    const [puzzle, setPuzzle] = useState<PuzzleView | null>(null);
    const [fen, setFen] = useState(new Chess().fen());
    const [startFen, setStartFen] = useState<string | null>(null);
    const [phase, setPhase] = useState<Phase>('idle');
    const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
    const [hint, setHint] = useState<HintResponse | null>(null);
    const [mark, setMark] = useState<{ square: string; ok: boolean } | null>(null);
    const [result, setResult] = useState<PuzzleResult | null>(null);
    const [solution, setSolution] = useState<string | null>(null);
    const [profile, setProfile] = useState<PuzzleProfile | null>(null);
    const [run, setRun] = useState<TimedRun | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [timedResult, setTimedResult] = useState<TimedResult | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [target, setTarget] = useState<TrainingTarget | null>(null);
    const [personal, setPersonal] = useState<PersonalView | null>(null);
    // Разбор личной ошибки на доске: ход из партии и сильный ход (таск B.3).
    const [personalReplay, setPersonalReplay] = useState<ReplayView | null>(null);
    const [personalAnswer, setPersonalAnswer] = useState<PersonalAnswer | null>(null);
    const [personalSummary, setPersonalSummary] = useState<PersonalSummary | null>(null);
    const [trainingKey, setTrainingKey] = useState(0);
    const [defenseKind, setDefenseKind] = useState<DefenseKind>('threat');
    const [drillKind, setDrillKind] = useState<DrillKind>('capture');
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const gameRef = useRef(new Chess());

    const later = (fn: () => void, ms: number) => {
        timers.current.push(setTimeout(fn, ms));
    };
    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    const refreshProfile = useCallback(() => {
        puzzlesApi.me().then(setProfile).catch(() => undefined);
    }, []);

    useEffect(() => {
        refreshProfile();
        fetchThemeRegistry().then(setRegistry).catch(() => undefined);
    }, [refreshProfile]);

    const apply = (uci: string) => {
        const move = gameRef.current.move(toMove(uci));
        setFen(gameRef.current.fen());
        setLastMove({from: move.from, to: move.to});
    };

    const present = useCallback((view: PuzzleView) => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        gameRef.current = new Chess(view.fen);
        setPuzzle(view);
        setFen(view.fen);
        setLastMove(null);
        setHint(null);
        setMark(null);
        setResult(null);
        setSolution(null);
        setPhase('opponent');
        later(() => {
            apply(view.first_move);
            setStartFen(gameRef.current.fen());
            setPhase('solving');
        }, OPPONENT_DELAY_MS);
    }, []);

    const load = useCallback(async (nextMode: Mode = mode, nextTarget: TrainingTarget | null = target) => {
        setError(null);
        setPhase('loading');
        try {
            if (nextMode === 'personal') {
                setPuzzle(null);
                setPersonalAnswer(null);
                setPersonalReplay(null);
                setMark(null);
                setPersonalSummary(await puzzlesApi.personalSummary());
                let view: PersonalView | null = null;
                try {
                    view = await puzzlesApi.personalNext();
                } catch {
                    view = null;  // к повторению сейчас ничего нет — сводка скажет, когда следующая
                }
                setPersonal(view);
                if (view) {
                    gameRef.current = new Chess(view.fen);
                    setFen(view.fen);
                    setLastMove(view.previous_move
                        ? {from: view.previous_move.slice(0, 2), to: view.previous_move.slice(2, 4)} : null);
                    setStartFen(view.fen);
                    setPhase('solving');
                } else {
                    setPhase('idle');
                }
            } else if (nextMode === 'themes') {
                if (nextTarget) present(await puzzlesApi.train(nextTarget));
                else setPhase('idle');
            } else if (nextMode === 'timed') {
                const view = await puzzlesApi.timedNext();
                setRun(view.run);
                present(view);
            } else {
                present(nextMode === 'daily' ? await puzzlesApi.daily() : await puzzlesApi.next(theme));
            }
        } catch (err) {
            setError(errorOf(err));
            setPhase('idle');
        }
    }, [mode, theme, target, present]);

    const finishTimed = useCallback(async () => {
        try {
            setTimedResult(await puzzlesApi.timedFinish());
            refreshProfile();
        } catch (err) {
            setError(errorOf(err));
        }
        setRun(null);
        setPhase('idle');
    }, [refreshProfile]);

    // Таймер забега: показывает время, а конец всё равно фиксирует сервер.
    useEffect(() => {
        if (!run) return;
        setSecondsLeft(run.seconds_left);
        const interval = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
        return () => clearInterval(interval);
    }, [run?.run_id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (run && secondsLeft === 0 && phase !== 'loading') void finishTimed();
    }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps

    const onResult = (res: PuzzleResult, line: string[] | null, fenBefore: string) => {
        setResult(res);
        setPhase('done');
        if (line) {
            // Неверный ход снимается, решение показывается на доске ход за ходом.
            later(() => {
                gameRef.current.undo();
                setFen(gameRef.current.fen());
                line.forEach((uci, i) => later(() => apply(uci), SOLUTION_STEP_MS * (i + 1)));
            }, SOLUTION_STEP_MS);
            setSolution(solutionSan(fenBefore, line));
        }
        if (res.run) {
            setRun(res.run);
            if (res.run.over) later(() => void finishTimed(), SOLUTION_STEP_MS);
            else later(() => void load('timed'), res.solved ? REPLY_DELAY_MS * 2 : SOLUTION_STEP_MS * 2);
        } else {
            refreshProfile();
            if (res.training) setTrainingKey((k) => k + 1);
        }
    };

    const onPersonalMove = async (uci: string) => {
        if (!personal) return;
        const fenBefore = gameRef.current.fen();
        apply(uci);
        setPhase('waiting');
        try {
            const answer = await puzzlesApi.personalAnswer(personal.id, uci);
            setMark({square: uci.slice(2, 4), ok: answer.correct});
            setPersonalAnswer(answer);
            setSolution(`${solutionSan(fenBefore, [answer.solution])}`);
            setPhase('done');
            if (!answer.correct) {
                later(() => {
                    gameRef.current.undo();
                    setFen(gameRef.current.fen());
                    later(() => apply(answer.solution), SOLUTION_STEP_MS);
                }, SOLUTION_STEP_MS);
            }
        } catch (err) {
            gameRef.current.undo();
            setFen(gameRef.current.fen());
            setError(errorOf(err));
            setPhase('solving');
        }
    };

    const onMove = async (uci: string) => {
        if (mode === 'personal' && phase === 'solving') {
            await onPersonalMove(uci);
            return;
        }
        if (!puzzle || phase !== 'solving') return;
        const fenBefore = gameRef.current.fen();
        apply(uci);
        setPhase('waiting');
        setHint(null);
        try {
            const answer = await puzzlesApi.move(puzzle.id, uci);
            setMark({square: uci.slice(2, 4), ok: answer.correct});
            if (answer.done && answer.result) {
                onResult(answer.result, answer.correct ? null : answer.solution, fenBefore);
            } else if (answer.reply) {
                const reply = answer.reply;
                later(() => {
                    apply(reply);
                    setMark(null);
                    setPhase('solving');
                }, REPLY_DELAY_MS);
            }
        } catch (err) {
            gameRef.current.undo();
            setFen(gameRef.current.fen());
            setError(errorOf(err));
            setPhase('solving');
        }
    };

    const askHint = async () => {
        if (!puzzle) return;
        try {
            setHint(await puzzlesApi.hint(puzzle.id));
        } catch (err) {
            setError(errorOf(err));
        }
    };

    const giveUp = async () => {
        if (!puzzle) return;
        try {
            const body = await puzzlesApi.giveUp(puzzle.id);
            setResult(body.result);
            setSolution(solutionSan(gameRef.current.fen(), body.solution));
            setPhase('done');
            body.solution.forEach((uci, i) => later(() => apply(uci), SOLUTION_STEP_MS * (i + 1)));
            refreshProfile();
        } catch (err) {
            setError(errorOf(err));
        }
    };

    const startTimed = async (minutes: 3 | 5) => {
        setError(null);
        setTimedResult(null);
        try {
            setRun(await puzzlesApi.timedStart(minutes));
            setMode('timed');
            await load('timed');
        } catch (err) {
            setError(errorOf(err));
        }
    };

    const chooseMode = (next: Mode) => {
        setMode(next);
        setTimedResult(null);
        setTarget(null);
        setPersonal(null);
        if (next !== 'personal') setPersonalSummary(null);
        if (next !== 'timed' && next !== 'themes' && next !== 'defense' && next !== 'drills') void load(next);
        if (next === 'themes' || next === 'defense' || next === 'drills') setPhase('idle');
    };

    const startTraining = (next: TrainingTarget) => {
        // «Что грозит?» и «Не зевни» — защитные упражнения (13.6), а не задачи базы.
        const drill = next.theme ? DEFENSE_DRILL_THEMES[next.theme] : undefined;
        if (drill) {
            setDefenseKind(drill);
            setMode('defense');
            return;
        }
        setMode('themes');
        setTarget(next);
        void load('themes', next);
    };

    const analyzePosition = (fen: string) => navigate('/', {state: {analyzeFen: fen}});
    const analyze = () => {
        if (startFen) analyzePosition(startFen);
    };

    const dueDays = (iso: string | null) => (iso
        ? Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)) : 0);

    const turnText = puzzle ? t(puzzle.color === 'white' ? 'puzzles.yourMoveWhite' : 'puzzles.yourMoveBlack') : '';
    const showThemes = (mode !== 'timed' && !(target?.blind)) || phase === 'done';
    const training = result?.training ?? null;

    const header = (
        <>
            <h1 className="flex items-center gap-2 text-lg font-bold text-amber-400">
                <PuzzleIcon size={18}/> {t('puzzles.title')}
            </h1>
            {profile && (
                <p data-testid="puzzle-profile">
                    {t('puzzles.profile', {rating: profile.rating, games: profile.games, streak: profile.streak})}
                </p>
            )}
            <div className="grid grid-cols-4 gap-1 font-bold text-xs" role="tablist">
                {MODES.map((m) => (
                    <button key={m} type="button" role="tab" aria-selected={mode === m} data-testid={`puzzle-mode-${m}`}
                            onClick={() => chooseMode(m)}
                            className={`py-1.5 rounded border cursor-pointer flex items-center justify-center gap-1 ${mode === m
                                ? 'bg-amber-800 text-white border-amber-400' : 'bg-black/35 border-amber-900/40'}`}>
                        {m === 'daily' && <CalendarDays size={13}/>}
                        {m === 'timed' && <Timer size={13}/>}
                        {t(`puzzles.modes.${m}`)}
                    </button>
                ))}
            </div>
        </>
    );

    if (mode === 'drills') {
        return <GeneratedDrills key={drillKind} header={header} initialKind={drillKind} onAnalyze={analyzePosition}/>;
    }

    if (mode === 'defense') {
        return (
            <DefenseTrainer key={defenseKind} header={header} initialKind={defenseKind}
                            onDefensiveMove={() => startTraining({theme: 'defensive_move', blind: false})}
                            onAnalyze={analyzePosition}/>
        );
    }

    return (
        <div className="w-full max-w-6xl mx-auto p-3 sm:p-4 flex flex-col lg:flex-row gap-4" data-testid="puzzles-page">
            <div className="w-full lg:w-[min(70vh,640px)] shrink-0 flex flex-col gap-2">
                <PuzzleBoard fen={personalReplay?.fen ?? fen} orientation={personal?.color ?? puzzle?.color ?? 'white'}
                             interactive={phase === 'solving'}
                             lastMove={personalReplay ? personalReplay.lastMove : lastMove} hint={personalReplay ? null : hint}
                             mark={personalReplay ? null : mark} arrows={personalReplay?.arrows}
                             onMove={(uci) => void onMove(uci)}/>
                <div className="flex flex-wrap items-center gap-2 text-sm" role="status" data-testid="puzzle-status">
                    {phase === 'opponent' && <span className="text-boxwood/80">{t('puzzles.opponentMoving')}</span>}
                    {(phase === 'solving' || phase === 'waiting') && personal && (
                        <span className="font-bold text-amber-300">{t('puzzles.personal.task')}</span>
                    )}
                    {(phase === 'solving' || phase === 'waiting') && !personal && <span className="font-bold text-amber-300">{turnText}</span>}
                    {phase === 'done' && result && (
                        <span className={`font-bold ${result.solved ? 'text-emerald-400' : 'text-rose-400'}`}
                              data-testid="puzzle-outcome">
                            {t(result.solved ? 'puzzles.solved' : 'puzzles.failed')}
                            {!result.run && ` ${t('puzzles.delta', {delta: result.delta > 0 ? `+${result.delta}` : String(result.delta)})}`}
                        </span>
                    )}
                </div>
            </div>

            <aside className="flex-1 min-w-0 flex flex-col gap-3 text-sm text-boxwood-light">
                <section className="bg-acacia-dark p-3 rounded-md border border-amber-700/40 flex flex-col gap-2">
                    {header}

                    {mode === 'rated' && (
                        <label className="flex flex-col gap-1">
                            <span>{t('puzzles.theme')}</span>
                            <select value={theme ?? ''} data-testid="puzzle-theme"
                                    onChange={(e) => setTheme(e.target.value || null)}
                                    className="bg-black/40 border border-amber-900/50 rounded px-2 py-1">
                                <option value="">{t('puzzles.allThemes')}</option>
                                {registry?.sections.map((section) => (
                                    <optgroup key={section} label={t(`puzzles.sections.${section as ThemeSection}`)}>
                                        {registry.themes.filter((th) => th.section === section).map((th) => (
                                            <option key={th.code} value={th.code}>{themeText(th.code, 'name', t)}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </label>
                    )}

                    {mode === 'timed' && !run && (
                        <div className="flex flex-col gap-1.5" data-testid="puzzle-timed-setup">
                            <p className="text-boxwood/80">{t('puzzles.timedRules')}</p>
                            <div className="flex gap-2">
                                {([3, 5] as const).map((minutes) => (
                                    <button key={minutes} type="button" data-testid={`puzzle-timed-${minutes}`}
                                            onClick={() => void startTimed(minutes)}
                                            className="flex-1 py-1.5 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold cursor-pointer">
                                        {t('puzzles.timedStart', {minutes})}
                                        {profile && <span className="block text-[10px] font-normal">{t('puzzles.record', {score: profile.best[String(minutes) as '3' | '5']})}</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {run && (
                        <div className="flex items-center justify-between font-mono" data-testid="puzzle-run">
                            <span>{t('puzzles.timeLeft', {time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`})}</span>
                            <span>{t('puzzles.score', {score: run.solved})}</span>
                            <span aria-label={t('puzzles.mistakes', {count: run.mistakes})}>
                                {'✗'.repeat(run.mistakes)}{'·'.repeat(Math.max(0, 3 - run.mistakes))}
                            </span>
                        </div>
                    )}
                    {timedResult && (
                        <p className="font-bold text-amber-200" data-testid="puzzle-timed-result">
                            {t('puzzles.timedOver', {score: timedResult.score, best: timedResult.best})}
                            {timedResult.new_record && ` ${t('puzzles.newRecord')}`}
                        </p>
                    )}

                    {mode === 'themes' && target && (
                        <div className="flex flex-wrap items-center justify-between gap-2" data-testid="training-target">
                            <span className="font-bold text-amber-200">
                                {target.theme
                                    ? themeText(target.theme, 'name', t)
                                    : t('puzzles.training.mixedOf', {section: t(`puzzles.sections.${target.section as ThemeSection}`)})}
                                {target.blind && ` · ${t('puzzles.training.blind')}`}
                            </span>
                            <button type="button" onClick={() => {
                                setTarget(null);
                                setPhase('idle');
                                setPuzzle(null);
                            }} data-testid="training-back"
                                    className="text-xs px-2 py-0.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 cursor-pointer">
                                {t('puzzles.training.back')}
                            </button>
                        </div>
                    )}
                    {training && (
                        <p className="text-amber-200" data-testid="training-progress">
                            {training.mastered && training.advanced
                                ? t('puzzles.training.justMastered')
                                : training.advanced
                                    ? t('puzzles.training.advanced', {stage: training.stage})
                                    : t('puzzles.training.progress', {
                                        stage: training.stage,
                                        clean: training.recent.split('').filter((c) => c === '1').length,
                                        window: training.window, pass: training.pass,
                                    })}
                        </p>
                    )}

                    {mode === 'personal' && personalSummary && (
                        <div className="flex flex-col gap-1.5" data-testid="personal-panel">
                            <p data-testid="personal-summary">
                                {t('puzzles.personal.summary', {
                                    due: personalSummary.due, active: personalSummary.active,
                                    mastered: personalSummary.mastered,
                                })}
                            </p>
                            {!personal && phase === 'idle' && (
                                <p className="text-amber-200" data-testid="personal-empty">
                                    {personalSummary.active === 0
                                        ? t('puzzles.personal.none')
                                        : t('puzzles.personal.allDone', {days: dueDays(personalSummary.next_due_at)})}
                                </p>
                            )}
                            {personalAnswer && (
                                <p className={personalAnswer.correct ? 'text-emerald-300' : 'text-rose-300'}
                                   data-testid="personal-result">
                                    {t(personalAnswer.correct ? 'puzzles.personal.right' : 'puzzles.personal.wrong')}
                                    {' '}
                                    {personalAnswer.done
                                        ? t('puzzles.personal.mastered')
                                        : t('puzzles.personal.again', {days: dueDays(personalAnswer.next_due_at)})}
                                </p>
                            )}
                            {personal?.opponent && (
                                <p className="text-xs text-boxwood/80" data-testid="personal-from">
                                    {t('puzzles.personal.from', {
                                        opponent: personal.opponent_is_bot
                                            ? botShortName(personal.opponent, t) : personal.opponent,
                                        date: personal.played_at
                                            ? format(parseISO(personal.played_at), 'd MMM yyyy', {locale: dateLocale}) : '',
                                    })}
                                </p>
                            )}
                            {personalAnswer && personal && (
                                <SolutionReplay key={personal.id} startFen={personal.fen} onShow={setPersonalReplay}
                                                onAnalyze={analyzePosition} lines={[
                                    ...(personalAnswer.played !== personalAnswer.solution ? [{
                                        id: 'played', moves: [personalAnswer.played], color: 'red' as const,
                                        label: t('puzzles.review.refutation', {move: sanMoves(personal.fen, [personalAnswer.played])[0]}),
                                    }] : []),
                                    {
                                        id: 'best', moves: [personalAnswer.solution], color: 'green' as const,
                                        label: t('puzzles.review.good', {move: sanMoves(personal.fen, [personalAnswer.solution])[0]}),
                                    },
                                ]}/>
                            )}
                            {personalAnswer && personal && (
                                <p className="text-xs text-boxwood/80" data-testid="personal-played">
                                    {t('puzzles.personal.inGame', {
                                        move: solutionSan(personal.fen, [personalAnswer.played]),
                                        best: solution ?? '',
                                    })}
                                </p>
                            )}
                            <div className="flex flex-wrap gap-2">
                                {phase === 'done' && (
                                    <button type="button" onClick={() => void load('personal')} data-testid="personal-next"
                                            className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold cursor-pointer">
                                        <ArrowRight size={15}/> {t('puzzles.next')}
                                    </button>
                                )}
                                {personal && (
                                    <button type="button" onClick={() => navigate(`/game/${personal.game_id}`)}
                                            data-testid="personal-open-game"
                                            className="px-3 py-1.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 cursor-pointer">
                                        {t('puzzles.personal.openGame')}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {mode !== 'timed' && mode !== 'personal' && (mode !== 'themes' || target) && (
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => void load()} data-testid="puzzle-next"
                                    disabled={phase === 'loading' || phase === 'opponent'}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold disabled:opacity-40 cursor-pointer">
                                <ArrowRight size={15}/> {t(puzzle ? 'puzzles.next' : 'puzzles.start')}
                            </button>
                            {phase === 'solving' && (
                                <>
                                    <button type="button" onClick={() => void askHint()} data-testid="puzzle-hint"
                                            disabled={(hint?.hints_used ?? 0) >= 2}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 disabled:opacity-40 cursor-pointer">
                                        <Lightbulb size={15}/> {t('puzzles.hint')}
                                    </button>
                                    <button type="button" onClick={() => void giveUp()} data-testid="puzzle-give-up"
                                            className="flex items-center gap-1 px-3 py-1.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 cursor-pointer">
                                        <Flag size={15}/> {t('puzzles.giveUp')}
                                    </button>
                                </>
                            )}
                            {phase === 'done' && startFen && (
                                <button type="button" onClick={analyze} data-testid="puzzle-analyze"
                                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 font-bold cursor-pointer">
                                    <GraduationCap size={15}/> {t('puzzles.analyze')}
                                </button>
                            )}
                        </div>
                    )}
                    {hint && <p className="text-sky-300" data-testid="puzzle-hint-text">{t(hint.to ? 'puzzles.hintMove' : 'puzzles.hintPiece')}</p>}
                    {error && <p className="text-rose-300" role="alert">{renderUiMessage(error, t)}</p>}
                </section>

                {mode === 'themes' && !target && (
                    <section className="bg-acacia-dark p-3 rounded-md border border-amber-700/40">
                        <TrainingPanel onTrain={startTraining} refreshKey={trainingKey}
                                       onDrill={(kind) => {
                                           setDrillKind(kind);
                                           setMode('drills');
                                       }}/>
                    </section>
                )}

                {puzzle && (
                    <section className="bg-acacia-dark p-3 rounded-md border border-amber-700/40 flex flex-col gap-1.5"
                             data-testid="puzzle-info">
                        <p>
                            {t('puzzles.puzzleRating', {rating: puzzle.rating})}
                            {puzzle.daily && ` · ${t('puzzles.dailyBadge')}`}
                            {puzzle.stage ? ` · ${t('puzzles.training.stageBadge', {stage: puzzle.stage})}` : ''}
                        </p>
                        {showThemes && puzzle.themes.length > 0 && (
                            <div className="flex flex-wrap gap-1" data-testid="puzzle-themes">
                                {puzzle.themes.map((code) => (
                                    <span key={code} title={themeText(code, 'short', t)}
                                          className="px-1.5 py-0.5 rounded bg-black/40 border border-amber-900/50 text-xs">
                                        {themeText(code, 'name', t)}
                                    </span>
                                ))}
                            </div>
                        )}
                        {solution && (
                            <p className="text-xs text-boxwood/80" data-testid="puzzle-solution">
                                {t('puzzles.solution', {moves: solution})}
                            </p>
                        )}
                    </section>
                )}

                {profile && profile.history.length > 0 && (
                    <section className="bg-acacia-dark p-3 rounded-md border border-amber-700/40 flex flex-col gap-1.5"
                             data-testid="puzzle-history">
                        <h2 className="font-bold text-amber-400">{t('puzzles.history')}</h2>
                        <RatingChart history={profile.history}/>
                        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs font-mono">
                            {profile.history.slice(0, 12).map((h, i) => (
                                <li key={`${h.puzzle_id}-${i}`} className={h.solved ? 'text-emerald-400' : 'text-rose-400'}>
                                    {h.solved ? '✓' : '✗'} {h.puzzle_rating} → {h.rating_after}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </aside>
        </div>
    );
}
