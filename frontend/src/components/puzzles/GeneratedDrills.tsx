// --- FILE: frontend/src/components/puzzles/GeneratedDrills.tsx ---
// Упражнения-генераторы (таск 13.7): матрица «вид × фигура» и уровни 1–3. Каждый раз — новая позиция с единственным
// верным ходом; мат в 2 — после первого хода отвечает соперник. Режим «на минуту»: счёт ведёт сервер, три ошибки —
// конец, лучший счёт — личный рекорд для сочетания «вид.фигура.уровень».

import {useCallback, useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {Chess} from 'chess.js';
import {ArrowRight, Timer} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {UiError} from '../../services/apiErrors';
import {DRILL_KINDS, DRILL_PIECES, drillSupported, puzzlesApi} from '../../services/puzzles';
import type {DrillKind, DrillPiece, DrillRun, DrillRunResult, DrillView} from '../../services/puzzles';
import {PuzzleBoard} from './PuzzleBoard';
import {solutionSan, toMove} from './puzzleNotation';
import {SolutionReplay} from './SolutionReplay';
import type {ReplayView} from './SolutionReplay';

type Phase = 'idle' | 'loading' | 'solving' | 'waiting' | 'done';

const REPLY_DELAY_MS = 400;
const NEXT_DELAY_MS = 700;
const FIGURINES: Record<string, string> = {q: '♕', r: '♖', b: '♗', n: '♘', x: '?'};

interface Props {
    header: ReactNode;
    initialKind?: DrillKind;
    /** «Разобрать с наставником»: позиция упражнения на свободной доске. */
    onAnalyze?: (fen: string) => void;
}

function errorOf(err: unknown): UiMessage {
    return err instanceof UiError ? err.ui : {key: 'common.networkError'};
}

export function GeneratedDrills({header, initialKind = 'capture', onAnalyze}: Props) {
    const {t} = useI18n();
    const [kind, setKind] = useState<DrillKind>(initialKind);
    const [piece, setPiece] = useState<DrillPiece>('q');
    const [level, setLevel] = useState(1);
    const [drill, setDrill] = useState<DrillView | null>(null);
    const [fen, setFen] = useState(new Chess().fen());
    const [line, setLine] = useState<string[]>([]);
    const [phase, setPhase] = useState<Phase>('idle');
    const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
    const [mark, setMark] = useState<{ square: string; ok: boolean } | null>(null);
    const [correct, setCorrect] = useState<boolean | null>(null);
    const [solution, setSolution] = useState<string | null>(null);
    // Решение ходами (UCI) — для пошагового показа на доске (таск B.3).
    const [solutionLine, setSolutionLine] = useState<string[]>([]);
    const [replay, setReplay] = useState<ReplayView | null>(null);
    const [run, setRun] = useState<DrillRun | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [runResult, setRunResult] = useState<DrillRunResult | null>(null);
    const [records, setRecords] = useState<Record<string, number>>({});
    const [error, setError] = useState<UiMessage | null>(null);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const supported = drillSupported(kind, piece);
    const combo = `${kind}.${piece}.${level}`;

    const later = (fn: () => void, ms: number) => {
        timers.current.push(setTimeout(fn, ms));
    };
    useEffect(() => () => timers.current.forEach(clearTimeout), []);
    useEffect(() => {
        puzzlesApi.drillsRecords().then((body) => setRecords(body.records)).catch(() => undefined);
    }, []);

    const present = (view: DrillView) => {
        setDrill(view);
        setFen(view.fen);
        setLine([]);
        setLastMove(null);
        setMark(null);
        setCorrect(null);
        setSolution(null);
        setSolutionLine([]);
        setReplay(null);
        setPhase('solving');
    };

    const load = useCallback(async (inRun = false) => {
        setError(null);
        setPhase('loading');
        try {
            if (inRun) {
                const view = await puzzlesApi.drillsRunNext();
                setRun(view.run);
                present(view);
            } else {
                present(await puzzlesApi.drillsNext(kind, piece, level));
            }
        } catch (err) {
            setError(errorOf(err));
            setPhase('idle');
        }
    }, [kind, piece, level]);

    const finishRun = useCallback(async () => {
        try {
            const result = await puzzlesApi.drillsRunFinish();
            setRunResult(result);
            setRecords((current) => ({...current, [result.combo]: result.best}));
        } catch (err) {
            setError(errorOf(err));
        }
        setRun(null);
        setPhase('idle');
    }, []);

    useEffect(() => {
        if (!run) return;
        setSecondsLeft(run.seconds_left);
        const interval = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
        return () => clearInterval(interval);
    }, [run?.combo, run === null]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (run && secondsLeft === 0 && phase !== 'loading') void finishRun();
    }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps

    const startRun = async () => {
        setError(null);
        setRunResult(null);
        try {
            setRun(await puzzlesApi.drillsRunStart(kind, piece, level));
            await load(true);
        } catch (err) {
            setError(errorOf(err));
        }
    };

    const play = async (uci: string) => {
        if (!drill || phase !== 'solving') return;
        const game = new Chess(fen);
        const move = game.move(toMove(uci));
        setFen(game.fen());
        setLastMove({from: move.from, to: move.to});
        const moves = [...line, uci];
        setPhase('waiting');
        try {
            const answer = await puzzlesApi.drillsAnswer(drill.key, moves, run !== null);
            setMark({square: uci.slice(2, 4), ok: answer.correct});
            if (!answer.done && answer.reply) {
                const reply = answer.reply;
                later(() => {
                    const replied = game.move(toMove(reply));
                    setFen(game.fen());
                    setLastMove({from: replied.from, to: replied.to});
                    setLine([...moves, reply]);
                    setMark(null);
                    setPhase('solving');
                }, REPLY_DELAY_MS);
                return;
            }
            setCorrect(answer.correct);
            setPhase('done');
            if (answer.solution) {
                setSolution(solutionSan(drill.fen, answer.solution));
                setSolutionLine(answer.solution);
            }
            if (answer.run) {
                setRun(answer.run);
                if (answer.run.over) later(() => void finishRun(), NEXT_DELAY_MS);
                else later(() => void load(true), NEXT_DELAY_MS);
            }
        } catch (err) {
            setFen(fen);
            setError(errorOf(err));
            setPhase('solving');
        }
    };

    const status = () => {
        if (!drill) return null;
        if (phase === 'done') {
            return (
                <span className={correct ? 'text-emerald-400' : 'text-rose-400'} data-testid="drill-outcome">
                    {t(correct ? 'puzzles.drills.right' : 'puzzles.drills.wrong')}
                </span>
            );
        }
        if (line.length > 0) return t('puzzles.drills.mateNext');
        return t(`puzzles.drills.tasks.${drill.kind}`);
    };

    return (
        <div className="w-full max-w-6xl mx-auto p-3 sm:p-4 flex flex-col lg:flex-row gap-4" data-testid="generated-drills">
            <div className="w-full lg:w-[min(70vh,640px)] shrink-0 flex flex-col gap-2">
                <PuzzleBoard fen={replay?.fen ?? fen} orientation={drill?.color ?? 'white'} interactive={phase === 'solving'}
                             lastMove={replay ? replay.lastMove : lastMove} mark={replay ? null : mark}
                             arrows={replay?.arrows} onMove={(uci) => void play(uci)}/>
                <div className="text-sm font-bold text-amber-300" role="status" data-testid="drill-status">
                    {status()}
                    {drill?.piece_type && phase === 'solving' && line.length === 0 && (
                        <span className="block text-xs font-normal text-boxwood/80" data-testid="drill-piece-hint">
                            {t('puzzles.drills.withPiece', {piece: `${FIGURINES[drill.piece_type]} ${t(`puzzles.drills.pieces.${drill.piece_type as DrillPiece}`)}`})}
                        </span>
                    )}
                </div>
            </div>

            <aside className="flex-1 min-w-0 flex flex-col gap-3 text-sm text-boxwood-light">
                <section className="bg-acacia-dark p-3 rounded-md border border-amber-700/40 flex flex-col gap-2">
                    {header}
                    <p className="text-boxwood/80">{t('puzzles.drills.intro')}</p>

                    <span className="text-xs">{t('puzzles.drills.kind')}</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs" role="tablist">
                        {DRILL_KINDS.map((k) => (
                            <button key={k} type="button" role="tab" aria-selected={kind === k} data-testid={`drill-kind-${k}`}
                                    disabled={run !== null} onClick={() => setKind(k)}
                                    className={`py-1 rounded border font-bold cursor-pointer disabled:opacity-50 ${kind === k
                                        ? 'bg-amber-800 text-white border-amber-400' : 'bg-black/35 border-amber-900/40'}`}>
                                {t(`puzzles.drills.kinds.${k}`)}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                        <span>{t('puzzles.drills.piece')}</span>
                        {DRILL_PIECES.map((p) => (
                            <button key={p} type="button" aria-pressed={piece === p} data-testid={`drill-piece-${p}`}
                                    disabled={run !== null} onClick={() => setPiece(p)} title={t(`puzzles.drills.pieces.${p}`)}
                                    className={`w-8 h-8 rounded border text-lg cursor-pointer disabled:opacity-50 ${piece === p
                                        ? 'bg-amber-800 text-white border-amber-400' : 'bg-black/35 border-amber-900/40'}`}>
                                {FIGURINES[p]}
                            </button>
                        ))}
                        <span className="ml-2">{t('puzzles.drills.level')}</span>
                        {[1, 2, 3].map((lv) => (
                            <button key={lv} type="button" aria-pressed={level === lv} data-testid={`drill-level-${lv}`}
                                    disabled={run !== null} onClick={() => setLevel(lv)}
                                    title={t(`puzzles.drills.levels.l${lv as 1 | 2 | 3}`)}
                                    className={`w-8 h-8 rounded border font-bold cursor-pointer disabled:opacity-50 ${level === lv
                                        ? 'bg-amber-800 text-white border-amber-400' : 'bg-black/35 border-amber-900/40'}`}>
                                {lv}
                            </button>
                        ))}
                    </div>
                    {!supported && <p className="text-amber-200 text-xs" data-testid="drill-unsupported">{t('puzzles.drills.unsupported')}</p>}

                    {run ? (
                        <div className="flex items-center justify-between font-mono" data-testid="drill-run">
                            <span>{t('puzzles.timeLeft', {time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`})}</span>
                            <span>{t('puzzles.score', {score: run.solved})}</span>
                            <span>{'✗'.repeat(run.mistakes)}{'·'.repeat(Math.max(0, 3 - run.mistakes))}</span>
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => void load()} data-testid="drill-next"
                                    disabled={!supported || phase === 'loading' || phase === 'waiting'}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold disabled:opacity-40 cursor-pointer">
                                <ArrowRight size={15}/> {t('puzzles.drills.train')}
                            </button>
                            <button type="button" onClick={() => void startRun()} data-testid="drill-timed"
                                    disabled={!supported} title={t('puzzles.drills.timedRules')}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 disabled:opacity-40 cursor-pointer">
                                <Timer size={15}/> {t('puzzles.drills.timed')}
                                <span className="text-[10px]" data-testid="drill-record">{t('puzzles.drills.record', {best: records[combo] ?? 0})}</span>
                            </button>
                        </div>
                    )}
                    {runResult && (
                        <p className="font-bold text-amber-200" data-testid="drill-run-result">
                            {t('puzzles.drills.runOver', {score: runResult.score, best: runResult.best})}
                            {runResult.new_record && ` ${t('puzzles.newRecord')}`}
                        </p>
                    )}
                    {solution && (
                        <p className="text-xs text-boxwood/80" data-testid="drill-solution">{t('puzzles.solution', {moves: solution})}</p>
                    )}
                    {phase === 'done' && drill && !run && (
                        <SolutionReplay key={drill.key} startFen={drill.fen} onShow={setReplay} onAnalyze={onAnalyze}
                                        lines={solutionLine.length > 0
                                            ? [{id: 'solution', label: t('puzzles.review.solution'), moves: solutionLine, color: 'green'}]
                                            : []}/>
                    )}
                    {error && <p className="text-rose-300" role="alert">{renderUiMessage(error, t)}</p>}
                </section>
            </aside>
        </div>
    );
}
