// --- FILE: frontend/src/components/learn/EndgameTrainer.tsx ---
// Эндшпильный тренажёр (таск 14.4): /learn/endgames — 33 упражнения (с «обязательными позициями» и этюдами 27.9), /learn/endgames/:id — игра против идеальной
// защиты по эндшпильным таблицам (POST /analysis/tablebase). Цели: мат (счётчик ходов против оптимума по таблицам),
// провести пешку или реализовать перевес не упустив выигрыш, удержать ничью заданное число ходов. После каждого хода
// игрока таблицы проверяют, не упущен ли результат (trainerVerdict в services/tablebase.ts). Сервер таблиц недоступен —
// отвечает оценка движка (source: 'engine'): тренажёр продолжает работать и показывает об этом пометку.

import {useEffect, useRef, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {ArrowLeft, Check, RotateCcw} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {MessageKey, UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {fetchLessonProgress, saveLessonProgress} from '../../services/lessonProgress';
import {probeTablebase, trainerVerdict} from '../../services/tablebase';
import exercisesData from '../../content/endgames.json';
import {MUST_KNOW} from '../../content/mustKnow';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';

export type EndgameGoal = 'mate' | 'promote' | 'convert' | 'draw';

export interface EndgameExercise {
    id: string;
    fen: string;
    goal: EndgameGoal;
    limit: number;
    optimum: number | null;
    side: 'white' | 'black';
}

export const EXERCISES = exercisesData as EndgameExercise[];
const GOALS: EndgameGoal[] = ['mate', 'promote', 'convert', 'draw'];

export function progressId(id: string): string {
    return `endgame-${id.replace(/_/g, '-')}`;
}

/** Осталась ли у стороны color только королевская фигура. */
function loneKing(game: Chess, color: 'w' | 'b'): boolean {
    return game.board().flat().filter((p) => p && p.color === color).length === 1;
}

export function EndgamesPage() {
    const {t} = useI18n();
    const [done, setDone] = useState<Set<string>>(new Set());
    useEffect(() => {
        const token = getToken();
        if (!token) return;
        fetchLessonProgress(token)
            .then((items) => setDone(new Set(items.filter((p) => p.completed).map((p) => p.lesson_id))))
            .catch(() => undefined);
    }, []);
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="endgames-page">
            <Link to="/learn" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('learn.title')}</Link>
            <h1 className="text-2xl font-bold text-amber-200">{t('endgames.title')}</h1>
            <p className="text-boxwood/85">{t('endgames.intro')}</p>
            <section className="flex flex-col gap-2 bg-amber-900/20 border border-amber-800/60 rounded-lg p-3" data-testid="must-know">
                <h2 className="font-bold text-amber-200">{t('endgames.mustKnow.title')}</h2>
                <p className="text-sm text-boxwood/80">{t('endgames.mustKnow.intro')}</p>
                {MUST_KNOW.map((ids, stage) => (
                    <div key={stage} className="flex flex-col gap-1" data-testid={`must-know-${stage + 1}`}>
                        <h3 className="text-sm font-bold text-amber-300">
                            {t('endgames.mustKnow.stage', {n: stage + 1, done: ids.filter((id) => done.has(progressId(id))).length, total: ids.length})}
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                            {ids.map((id) => (
                                <Link key={id} to={`/learn/endgames/${id}`}
                                      className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${done.has(progressId(id)) ? 'border-emerald-600 text-emerald-200' : 'border-amber-800 hover:border-amber-500'}`}>
                                    {done.has(progressId(id)) && <Check size={12}/>}{t(`endgames.items.${id}` as MessageKey)}
                                </Link>
                            ))}
                        </div>
                    </div>
                ))}
            </section>
            {GOALS.map((goal) => (
                <section key={goal} className="flex flex-col gap-2">
                    <h2 className="font-bold text-amber-200">{t(`endgames.goals.${goal}.section`)}</h2>
                    <div className="grid sm:grid-cols-2 gap-2">
                        {EXERCISES.filter((e) => e.goal === goal).map((e) => (
                            <Link key={e.id} to={`/learn/endgames/${e.id}`} data-testid={`endgame-${e.id}`}
                                  className="flex items-center justify-between gap-2 bg-acacia px-3 py-2 rounded border-2 border-acacia-dark hover:border-amber-500">
                                <span>{t(`endgames.items.${e.id}` as MessageKey)}</span>
                                {done.has(progressId(e.id)) && <Check size={16} className="text-emerald-400"/>}
                            </Link>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

type Status = 'playing' | 'thinking' | 'success' | 'failed';

export function EndgameTrainerPage() {
    const {t} = useI18n();
    const {exerciseId = ''} = useParams<{ exerciseId: string }>();
    const exercise = EXERCISES.find((e) => e.id === exerciseId);
    const [fen, setFen] = useState(exercise?.fen ?? '');
    const [moves, setMoves] = useState(0);
    const [status, setStatus] = useState<Status>('playing');
    const [result, setResult] = useState<MessageKey | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
    const [engineFallback, setEngineFallback] = useState(false);
    const busy = useRef(false);

    useEffect(() => {
        if (exercise) reset();
    }, [exerciseId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!exercise) return <p className="p-4 text-rose-300">{t('learn.notFound')}</p>;
    const me: 'w' | 'b' = exercise.side === 'white' ? 'w' : 'b';
    const them: 'w' | 'b' = me === 'w' ? 'b' : 'w';
    const winning = exercise.goal !== 'draw';

    function reset() {
        setFen(exercise!.fen);
        setMoves(0);
        setStatus('playing');
        setResult(null);
        setError(null);
        setLastMove(null);
        setEngineFallback(false);
    }

    const finish = (ok: boolean, key: MessageKey) => {
        setStatus(ok ? 'success' : 'failed');
        setResult(key);
        const token = getToken();
        if (ok && token) saveLessonProgress(token, progressId(exercise.id), {step: 0, steps_total: 1, completed: true}).catch(() => undefined);
    };

    const onMove = async (uci: string) => {
        if (status !== 'playing' || busy.current) return;
        const game = new Chess(fen);
        try {
            game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q'});
        } catch {
            return;
        }
        const made = moves + 1;
        setFen(game.fen());
        setMoves(made);
        setLastMove({from: uci.slice(0, 2), to: uci.slice(2, 4)});
        if (game.isCheckmate()) return finish(true, exercise.goal === 'mate' && exercise.optimum && made <= exercise.optimum
            ? 'endgames.result.perfectMate' : 'endgames.result.mate');
        if (game.isDraw()) return finish(!winning, winning ? 'endgames.result.drawnWin' : 'endgames.result.held');

        busy.current = true;
        setStatus('thinking');
        try {
            const probe = await probeTablebase(game.fen());
            setEngineFallback(probe.source === 'engine');
            // Оценка — для соперника (он ходит): для выигрыша у соперника должен быть проигрыш, для ничьей — не выигрыш.
            const verdict = trainerVerdict(probe, winning);
            if (verdict !== 'continue') return finish(false, `endgames.result.${verdict}`);
            const promoted = uci.length === 5 || (game.history({verbose: true}).at(-1)?.promotion ?? null) !== null;
            if (exercise.goal === 'promote' && promoted) return finish(true, 'endgames.result.promoted');
            if (exercise.goal === 'convert' && loneKing(game, them)) return finish(true, 'endgames.result.converted');
            if (!probe.best) return finish(!winning, 'endgames.result.held');
            game.move({from: probe.best.uci.slice(0, 2), to: probe.best.uci.slice(2, 4), promotion: probe.best.uci[4]});
            setFen(game.fen());
            setLastMove({from: probe.best.uci.slice(0, 2), to: probe.best.uci.slice(2, 4)});
            if (game.isCheckmate()) return finish(false, 'endgames.result.mated');
            if (game.isDraw()) return finish(!winning, winning ? 'endgames.result.drawnWin' : 'endgames.result.held');
            if (made >= exercise.limit) return finish(!winning, winning ? 'endgames.result.outOfMoves' : 'endgames.result.held');
            setStatus('playing');
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
            setFen(new Chess(fen).fen());
            setMoves(moves);
            setStatus('playing');
        } finally {
            busy.current = false;
        }
    };

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="endgame-trainer">
            <Link to="/learn/endgames" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('endgames.title')}</Link>
            <div>
                <h1 className="text-2xl font-bold text-amber-200">{t(`endgames.items.${exercise.id}` as MessageKey)}</h1>
                <p className="text-boxwood/85" data-testid="endgame-goal">
                    {t(`endgames.goals.${exercise.goal}.task`, {limit: exercise.limit, side: t(exercise.side === 'white' ? 'endgames.white' : 'endgames.black')})}
                </p>
            </div>
            <div className="flex flex-col md:flex-row gap-5 items-start">
                <div className="w-full max-w-[560px]">
                    <PuzzleBoard fen={fen} orientation={exercise.side} interactive={status === 'playing'} onMove={(uci) => void onMove(uci)}
                                 lastMove={lastMove}/>
                </div>
                <div className="flex flex-col gap-2 text-sm min-w-0">
                    <p data-testid="endgame-moves">
                        {exercise.optimum ? t('endgames.movesOptimum', {moves, optimum: exercise.optimum, limit: exercise.limit})
                            : t('endgames.moves', {moves, limit: exercise.limit})}
                    </p>
                    {status === 'thinking' && <p className="text-boxwood/70 animate-pulse">{t('endgames.thinking')}</p>}
                    {engineFallback && <p className="text-amber-300/90 text-xs" data-testid="endgame-engine-fallback">{t('endgames.engineFallback')}</p>}
                    {result && (
                        <p data-testid="endgame-result" className={status === 'success' ? 'text-emerald-300' : 'text-rose-300'}>
                            {t(result, {moves, optimum: exercise.optimum ?? 0})}
                        </p>
                    )}
                    {error && <p role="alert" className="text-rose-300">{renderUiMessage(error, t)}</p>}
                    <button type="button" onClick={reset} data-testid="endgame-reset"
                            className="self-start px-3 py-1.5 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1">
                        <RotateCcw size={14}/> {t('endgames.again')}
                    </button>
                </div>
            </div>
        </div>
    );
}
