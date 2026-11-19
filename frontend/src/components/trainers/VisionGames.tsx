// --- FILE: frontend/src/components/trainers/VisionGames.tsx ---
// Игры тренажёров видения доски (таск 16.5). Каждая сообщает итог попытки через onFinish(score, mistakes).
// * PathGame — «Тихая тропа» и «Маршрут коня»: ROUNDS позиций подряд, фигуру — к цели, не вставая под бой.
// * ForkGame — «Двойной удар»: за FORK_SECONDS найти как можно больше полей вилки конём (щелчком по полю).
// * TailGame — «Хвост»: фигура собирает пешки, за каждой вырастает хвост; очки — 10 за съеденную, правила — trainers/tail.ts.
// Правила и задания — trainers/vision.ts; ход проверяется так же, как в азбуке (starsMove из content/basics/rules.ts). Запускается из TrainersPage.tsx.

import {useEffect, useMemo, useRef, useState} from 'react';
import {useI18n} from '../../i18n';
import type {MessageKey} from '../../i18n';
import {starsMove} from '../../content/basics/rules';
import {forkCount, forkLevel, isSafe, knightTargets, pathLevel, pathScore} from '../../trainers/vision';
import {boardFen, legalMoves, newGame, step} from '../../trainers/tail';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import type {TrainerGameProps} from './trainerGame';

/** Позиций в одной попытке PathGame. */
export const ROUNDS = 5;
/** Длительность попытки ForkGame, секунд. */
export const FORK_SECONDS = 60;

/**
 * Очки за позицию — pathScore(ходы, par); в «Маршруте коня» превышение par даёт 0 очков и ошибку. Неверный ход — ошибка,
 * позиция не меняется. Следующая позиция открывается через 400 мс после взятия цели.
 */
export function PathGame({kind, level, seed, onFinish}: TrainerGameProps & { kind: 'quiet' | 'knight' }) {
    const {t} = useI18n();
    const [round, setRound] = useState(0);
    const puzzle = useMemo(() => pathLevel(kind, level, seed + round), [kind, level, seed, round]);
    const [fen, setFen] = useState(puzzle.fen);
    const [hero, setHero] = useState(puzzle.hero);
    const [moves, setMoves] = useState(0);
    const [total, setTotal] = useState(0);
    const [mistakes, setMistakes] = useState(0);
    const [feedback, setFeedback] = useState<MessageKey | null>(null);
    const [last, setLast] = useState<{ from: string; to: string } | null>(null);

    useEffect(() => {
        setFen(puzzle.fen);
        setHero(puzzle.hero);
        setMoves(0);
        setLast(null);
    }, [puzzle]);

    const onMove = (uci: string) => {
        const verdict = starsMove(fen, hero, uci, new Set([puzzle.target]));
        if ('reason' in verdict) {
            setMistakes((m) => m + 1);
            setFeedback(`basics.feedback.${verdict.reason}`);
            return;
        }
        setFeedback(null);
        const made = moves + 1;
        setFen(verdict.fen);
        setHero(verdict.to);
        setLast({from: uci.slice(0, 2), to: verdict.to});
        setMoves(made);
        if (verdict.to !== puzzle.target) return;
        const points = kind === 'knight' && made > puzzle.par ? 0 : pathScore(made, puzzle.par);
        const sum = total + points;
        setTotal(sum);
        if (kind === 'knight' && made > puzzle.par) setMistakes((m) => m + 1);
        if (round + 1 >= ROUNDS) onFinish(sum, mistakes + (kind === 'knight' && made > puzzle.par ? 1 : 0));
        else window.setTimeout(() => setRound((r) => r + 1), 400);
    };

    return (
        <div className="flex flex-col md:flex-row gap-5 items-start" data-testid={`path-game-${kind}`}>
            <div className="w-full max-w-[560px]">
                <PuzzleBoard fen={fen} orientation="white" interactive onMove={onMove} lastMove={last} stars={[puzzle.target]}/>
            </div>
            <div className="flex flex-col gap-2 text-sm">
                <p className="text-amber-200">{t(kind === 'knight' ? 'trainers.knight_route.task' : 'trainers.quiet_path.task')}</p>
                <p data-testid="path-progress">{t('trainers.round', {n: round + 1, total: ROUNDS})} · {t('trainers.moves', {moves, par: puzzle.par})}</p>
                <p className="text-xs text-boxwood/70">{t('trainers.score', {score: total})} · {t('trainers.mistakes', {n: mistakes})}</p>
                {feedback && <p role="status" className="text-rose-300" data-testid="path-feedback">{t(feedback)}</p>}
            </div>
        </div>
    );
}

/** Поля вилки за FORK_SECONDS: 10 очков за найденное; тип промаха (не ход коня, нет вилки, поле под боем) определяет подсказку. */
export function ForkGame({level, seed, onFinish}: TrainerGameProps) {
    const {t} = useI18n();
    const [round, setRound] = useState(0);
    const puzzle = useMemo(() => forkLevel(level, seed + round), [level, seed, round]);
    const [solved, setSolved] = useState(0);
    const [mistakes, setMistakes] = useState(0);
    const [left, setLeft] = useState(FORK_SECONDS);
    const [feedback, setFeedback] = useState<MessageKey | null>(null);
    const finished = useRef(false);

    useEffect(() => {
        const started = Date.now();
        const id = window.setInterval(() => setLeft(Math.max(0, FORK_SECONDS - Math.floor((Date.now() - started) / 1000))), 250);
        return () => window.clearInterval(id);
    }, []);

    useEffect(() => {
        if (left > 0 || finished.current) return;
        finished.current = true;
        onFinish(solved * 10, mistakes);
    }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

    const onSquare = (square: string) => {
        if (left === 0) return;
        if (puzzle.answers.includes(square)) {
            setSolved((n) => n + 1);
            setFeedback(null);
            setRound((r) => r + 1);
            return;
        }
        setMistakes((n) => n + 1);
        const reachable = knightTargets(puzzle.knight).includes(square);
        setFeedback(!reachable ? 'trainers.double_strike.notKnightMove'
            : forkCount(puzzle.fen, square) < 2 ? 'trainers.double_strike.notFork'
                : !isSafe(puzzle.fen, square) ? 'trainers.double_strike.unsafe' : 'trainers.double_strike.notFork');
    };

    return (
        <div className="flex flex-col md:flex-row gap-5 items-start" data-testid="fork-game">
            <div className="w-full max-w-[560px]">
                <PuzzleBoard fen={puzzle.fen} orientation="white" interactive={left > 0} onMove={() => undefined} onSquare={onSquare}
                             highlights={[puzzle.knight]}/>
            </div>
            <div className="flex flex-col gap-2 text-sm">
                <p className="text-amber-200">{t(puzzle.safeOnly ? 'trainers.double_strike.taskSafe' : 'trainers.double_strike.task')}</p>
                <p className="font-mono text-2xl text-amber-300" data-testid="fork-clock">{left}</p>
                <p data-testid="fork-solved">{t('trainers.double_strike.solved', {n: solved})} · {t('trainers.mistakes', {n: mistakes})}</p>
                {feedback && <p role="status" className="text-rose-300" data-testid="fork-feedback">{t(feedback)}</p>}
            </div>
        </div>
    );
}

/** «Хвост»: очки — 10 за каждую съеденную пешку; попытку можно закончить досрочно (stop). */
export function TailGame({level, seed, onFinish}: TrainerGameProps) {
    const {t} = useI18n();
    const [state, setState] = useState(() => newGame(level, seed));
    const [mistakes, setMistakes] = useState(0);
    const finished = useRef(false);

    useEffect(() => {
        if (!state.over || finished.current) return;
        finished.current = true;
        onFinish(state.eaten * 10, mistakes);
    }, [state.over]); // eslint-disable-line react-hooks/exhaustive-deps

    const onSquare = (square: string) => {
        if (state.over) return;
        const next = step(state, square);
        if (next) setState(next);
        else setMistakes((n) => n + 1);
    };

    const stop = () => {
        if (finished.current) return;
        finished.current = true;
        onFinish(state.eaten * 10, mistakes);
    };

    return (
        <div className="flex flex-col md:flex-row gap-5 items-start" data-testid="tail-game">
            <div className="w-full max-w-[560px]">
                <PuzzleBoard fen={boardFen(state)} orientation="white" interactive={!state.over} onMove={() => undefined}
                             onSquare={onSquare} highlights={[state.head]}/>
            </div>
            <div className="flex flex-col gap-2 text-sm">
                <p className="text-amber-200">{t('trainers.tail.task')}</p>
                <p data-testid="tail-score">{t('trainers.tail.eaten', {n: state.eaten})} · {t('trainers.tail.length', {n: state.tail.length})}</p>
                <p className="text-xs text-boxwood/70">{t('trainers.tail.movesLeft', {n: legalMoves(state).length})} · {t('trainers.mistakes', {n: mistakes})}</p>
                {state.over && <p className="text-rose-300" data-testid="tail-over">{t('trainers.tail.over')}</p>}
                {!state.over && (
                    <button type="button" onClick={stop} className="self-start text-amber-400 hover:underline">{t('trainers.tail.stop')}</button>
                )}
            </div>
        </div>
    );
}
