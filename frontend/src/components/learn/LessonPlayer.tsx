// --- FILE: frontend/src/components/learn/LessonPlayer.tsx ---
// Проигрыватель урока школы (таск 14.1): шаги урока (объяснение, показ, «найдите ход», вопрос с выбором), затем
// экзамен из контрольных вопросов. Вопрос засчитывается в экзамене, если на него ответили с первой попытки.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Chess} from 'chess.js';
import {useI18n} from '../../i18n';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import type {BoardArrow} from '../puzzles/PuzzleBoard';
import {localized} from '../../content/lessons';
import type {ChoiceStep, DemoAction, FindMoveStep, Lesson, QuestionStep, Step} from '../../content/lessons/format';

/** Пауза после хода показа и перед ответом соперника — чтобы ход успели увидеть. */
export const DEMO_MOVE_MS = 600;
export const REPLY_DELAY_MS = 600;

export interface LessonResult {
    examScore: number;
    examTotal: number;
}

export interface LessonPlayerProps {
    lesson: Lesson;
    /** С какого шага начать (продолжение урока). */
    initialStep?: number;
    /** Игрок дошёл до шага step (номер с нуля). */
    onStep?: (step: number) => void;
    /** Урок и экзамен пройдены. */
    onFinish?: (result: LessonResult) => void;
    /** Кнопки под итогом урока (следующий урок, все курсы). */
    finishActions?: React.ReactNode;
}

type Phase = 'steps' | 'examIntro' | 'exam' | 'done';

interface BoardState {
    fen: string;
    arrows: BoardArrow[];
    highlights: string[];
    ghost: { square: string; piece: string } | null;
    lastMove: { from: string; to: string } | null;
}

function boardOf(step: Step | QuestionStep): BoardState {
    return {
        fen: ('fen' in step && step.fen) || new Chess().fen(),
        arrows: step.arrows ?? [],
        highlights: step.highlights ?? [],
        ghost: step.ghost ?? null,
        lastMove: null,
    };
}

function orientationOf(step: Step, fen: string): 'white' | 'black' {
    if (step.orientation) return step.orientation;
    if (step.type === 'find_move') return fen.split(' ')[1] === 'b' ? 'black' : 'white';
    return 'white';
}

function apply(fen: string, uci: string): { fen: string; from: string; to: string } {
    const game = new Chess(fen);
    game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
    return {fen: game.fen(), from: uci.slice(0, 2), to: uci.slice(2, 4)};
}

export function LessonPlayer({lesson, initialStep = 0, onStep, onFinish, finishActions}: LessonPlayerProps) {
    const {t, tp, language} = useI18n();
    const [phase, setPhase] = useState<Phase>('steps');
    const [index, setIndex] = useState(() => Math.min(initialStep, lesson.steps.length - 1));
    const [examScore, setExamScore] = useState(0);

    const step: Step | null = phase === 'steps' ? lesson.steps[index] : phase === 'exam' ? lesson.exam[index] : null;

    // --- состояние текущего шага ---------------------------------------------------------------------
    const [board, setBoard] = useState<BoardState>(() => boardOf(lesson.steps[Math.min(initialStep, lesson.steps.length - 1)]));
    const [taskIndex, setTaskIndex] = useState(0);
    const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
    const [solved, setSolved] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [hint, setHint] = useState<{ from: string; to: string | null } | null>(null);
    const [chosen, setChosen] = useState<number | null>(null);
    const [firstTry, setFirstTry] = useState(true);
    const [demoRun, setDemoRun] = useState(0);
    const [demoDone, setDemoDone] = useState(false);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    const clearTimers = () => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
    };
    const later = (fn: () => void, ms: number) => {
        timers.current.push(setTimeout(fn, ms));
    };

    // Новый шаг — новая доска и сброс ответа.
    useEffect(() => {
        clearTimers();
        if (!step) return;
        setBoard(boardOf(step));
        setTaskIndex(0);
        setFeedback(null);
        setSolved(step.type === 'text');
        setWaiting(false);
        setHint(null);
        setChosen(null);
        setFirstTry(true);
        setDemoDone(step.type !== 'demo');
        return clearTimers;
    }, [phase, index]); // eslint-disable-line react-hooks/exhaustive-deps

    // Отчёт о дальнем шаге.
    useEffect(() => {
        if (phase === 'steps') onStep?.(index);
    }, [phase, index]); // eslint-disable-line react-hooks/exhaustive-deps

    // Показ: действия по очереди.
    useEffect(() => {
        if (!step || step.type !== 'demo') return;
        clearTimers();
        setBoard(boardOf(step));
        setDemoDone(false);
        let fen = step.fen;
        let delay = 300;
        const schedule = (action: DemoAction) => {
            switch (action.do) {
                case 'move': {
                    const moved = apply(fen, action.uci);
                    fen = moved.fen;
                    // Ход снимает подсветку: она показывала, какая фигура пойдёт.
                    later(() => setBoard((b) => ({...b, fen: moved.fen, lastMove: {from: moved.from, to: moved.to}, highlights: []})), delay);
                    delay += DEMO_MOVE_MS;
                    break;
                }
                case 'arrow':
                    later(() => setBoard((b) => ({...b, arrows: [...b.arrows, {from: action.from, to: action.to, color: action.color}]})), delay);
                    delay += 250;
                    break;
                case 'highlight':
                    later(() => setBoard((b) => ({...b, highlights: action.squares})), delay);
                    break;
                case 'ghost':
                    later(() => setBoard((b) => ({...b, ghost: {square: action.square, piece: action.piece}})), delay);
                    break;
                case 'place': {
                    const game = new Chess(fen);
                    game.put({color: action.piece[0] as 'w' | 'b', type: action.piece[1].toLowerCase() as 'p'}, action.square as never);
                    const placed = game.fen();
                    fen = placed;
                    later(() => setBoard((b) => ({...b, fen: placed, ghost: null})), delay);
                    delay += 300;
                    break;
                }
                case 'clear':
                    later(() => setBoard((b) => ({...b, arrows: [], highlights: [], ghost: null})), delay);
                    break;
                case 'pause':
                    delay += action.ms;
                    break;
            }
        };
        step.actions.forEach(schedule);
        later(() => setDemoDone(true), delay);
        return clearTimers;
    }, [step, demoRun]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- ответы ----------------------------------------------------------------------------------------
    const onMove = useCallback((uci: string) => {
        if (!step || step.type !== 'find_move' || solved || waiting) return;
        const task = step.line[taskIndex];
        const isCorrect = task.answers.includes(uci) || task.answers.includes(uci.slice(0, 4));
        if (!isCorrect) {
            setFirstTry(false);
            const special = task.wrong?.[uci] ?? task.wrong?.[uci.slice(0, 4)];
            setFeedback({text: special ? localized(special, language) : t('learn.wrongMove'), ok: false});
            return;
        }
        const moved = apply(board.fen, uci);
        setHint(null);
        setBoard((b) => ({...b, fen: moved.fen, lastMove: {from: moved.from, to: moved.to}, arrows: [], highlights: []}));
        setFeedback({text: task.correct ? localized(task.correct, language) : t('learn.correct'), ok: true});
        const last = taskIndex === step.line.length - 1;
        if (task.reply) {
            setWaiting(true);
            const reply = apply(moved.fen, task.reply);
            later(() => {
                setBoard((b) => ({...b, fen: reply.fen, lastMove: {from: reply.from, to: reply.to}}));
                setWaiting(false);
                if (last) setSolved(true);
                else setTaskIndex((i) => i + 1);
            }, REPLY_DELAY_MS);
        } else if (last) {
            setSolved(true);
        } else {
            setTaskIndex((i) => i + 1);
        }
    }, [step, solved, waiting, taskIndex, board.fen, language, t]);

    const choose = (option: number) => {
        if (!step || step.type !== 'choice' || solved) return;
        const picked = step.options[option];
        setChosen(option);
        if (!picked.correct) setFirstTry(false);
        else setSolved(true);
        const fallback = picked.correct ? t('learn.correct') : t('learn.wrongMove');
        setFeedback({text: picked.feedback ? localized(picked.feedback, language) : fallback, ok: Boolean(picked.correct)});
    };

    const showHint = () => {
        if (!step || step.type !== 'find_move') return;
        const answer = step.line[taskIndex].answers[0];
        setFirstTry(false);
        setHint((current) => current ? {from: answer.slice(0, 2), to: answer.slice(2, 4)} : {from: answer.slice(0, 2), to: null});
    };

    // --- переходы ----------------------------------------------------------------------------------------
    const next = () => {
        if (phase === 'steps') {
            if (index < lesson.steps.length - 1) setIndex(index + 1);
            else setPhase('examIntro');
        } else if (phase === 'exam') {
            const score = examScore + (firstTry ? 1 : 0);
            setExamScore(score);
            if (index < lesson.exam.length - 1) {
                setIndex(index + 1);
            } else {
                setPhase('done');
                onFinish?.({examScore: score, examTotal: lesson.exam.length});
            }
        }
    };

    const startExam = () => {
        setExamScore(0);
        setIndex(0);
        setPhase('exam');
    };

    const restart = () => {
        setExamScore(0);
        setIndex(0);
        setPhase('steps');
    };

    const title = localized(lesson.title, language);

    if (phase === 'examIntro' || phase === 'done') {
        return (
            <div className="max-w-xl mx-auto bg-acacia p-5 rounded-lg border-2 border-acacia-dark text-boxwood-light flex flex-col gap-3"
                 data-testid={phase === 'done' ? 'lesson-done' : 'lesson-exam-intro'}>
                <h1 className="text-xl font-bold text-amber-200">{title}</h1>
                {phase === 'examIntro' ? (
                    <>
                        <h2 className="font-bold">{t('learn.examTitle')}</h2>
                        <p>{tp('learn.examIntro', lesson.exam.length)}</p>
                        <button type="button" onClick={startExam}
                                className="self-start px-4 py-2 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600 cursor-pointer">
                            {t('learn.startExam')}
                        </button>
                    </>
                ) : (
                    <>
                        <p className="text-lg" data-testid="lesson-exam-result">
                            {t('learn.examResult', {score: examScore, total: lesson.exam.length})}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {finishActions}
                            <button type="button" onClick={restart}
                                    className="px-4 py-2 rounded-md bg-black/40 border border-amber-700/50 hover:bg-black/60 cursor-pointer">
                                {t('learn.review')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        );
    }

    if (!step) return null;
    const total = phase === 'steps' ? lesson.steps.length : lesson.exam.length;
    const counter = phase === 'steps'
        ? t('learn.stepOf', {current: index + 1, total})
        : t('learn.examQuestion', {current: index + 1, total});
    const canGoNext = phase === 'steps' ? (step.type === 'text' || step.type === 'demo' || solved) : solved;
    const isLastStep = phase === 'steps' && index === lesson.steps.length - 1;
    const interactive = step.type === 'find_move' && !solved && !waiting;

    return (
        <div className="w-full max-w-5xl mx-auto flex flex-col lg:flex-row gap-4 items-start" data-testid="lesson-player">
            <div className="w-full max-w-[min(90vw,520px)] lg:w-[520px] shrink-0">
                <PuzzleBoard
                    fen={board.fen}
                    orientation={orientationOf(step, board.fen)}
                    interactive={interactive}
                    lastMove={board.lastMove}
                    hint={hint}
                    arrows={board.arrows}
                    highlights={board.highlights}
                    ghost={board.ghost}
                    onMove={onMove}
                />
            </div>
            <div className="flex-1 w-full bg-acacia p-4 rounded-lg border-2 border-acacia-dark text-boxwood-light flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-2">
                    <h1 className="text-lg font-bold text-amber-200">{phase === 'exam' ? `${title} · ${t('learn.examTitle')}` : title}</h1>
                    <span className="text-xs font-mono text-boxwood/70" data-testid="lesson-counter">{counter}</span>
                </div>
                <p className="leading-relaxed" data-testid="lesson-text">{localized(step.text, language)}</p>

                {step.type === 'find_move' && !solved && (
                    <p className="text-amber-300 text-sm">
                        {waiting ? t('learn.opponentReplies') : taskIndex > 0 ? t('learn.playOn') : t('learn.yourMove')}
                    </p>
                )}
                {step.type === 'choice' && (
                    <ChoiceOptions step={step} chosen={chosen} solved={solved} onChoose={choose}/>
                )}
                {feedback && (
                    <p role="status" data-testid="lesson-feedback"
                       className={`text-sm p-2 rounded border ${feedback.ok ? 'border-emerald-600/60 bg-emerald-950/40 text-emerald-200' : 'border-rose-600/60 bg-rose-950/40 text-rose-200'}`}>
                        {feedback.text}
                    </p>
                )}

                <div className="flex flex-wrap gap-2 mt-auto pt-2">
                    {phase === 'steps' && index > 0 && (
                        <button type="button" onClick={() => setIndex(index - 1)}
                                className="px-3 py-1.5 rounded-md bg-black/40 border border-amber-800/50 hover:bg-black/60 cursor-pointer">
                            {t('learn.back')}
                        </button>
                    )}
                    {step.type === 'demo' && (
                        <button type="button" onClick={() => setDemoRun((n) => n + 1)} disabled={!demoDone}
                                className="px-3 py-1.5 rounded-md bg-black/40 border border-amber-800/50 hover:bg-black/60 disabled:opacity-40 cursor-pointer">
                            {t('learn.replay')}
                        </button>
                    )}
                    {step.type === 'find_move' && !solved && (step as FindMoveStep).hint !== undefined && (
                        <button type="button" onClick={showHint}
                                className="px-3 py-1.5 rounded-md bg-black/40 border border-sky-700/60 hover:bg-black/60 cursor-pointer">
                            {t('learn.hint')}
                        </button>
                    )}
                    {step.type === 'find_move' && hint && (step as FindMoveStep).hint && (
                        <span className="text-xs text-sky-200 self-center">{localized((step as FindMoveStep).hint, language)}</span>
                    )}
                    <button type="button" onClick={next} disabled={!canGoNext}
                            className="ml-auto px-4 py-1.5 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
                        {isLastStep ? t('learn.finish') : t('learn.next')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ChoiceOptions({step, chosen, solved, onChoose}: {
    step: ChoiceStep;
    chosen: number | null;
    solved: boolean;
    onChoose: (i: number) => void;
}) {
    const {language} = useI18n();
    const options = useMemo(() => step.options, [step]);
    return (
        <div className="flex flex-col gap-1.5" role="group">
            {options.map((option, i) => {
                const picked = chosen === i;
                const tone = picked ? (option.correct ? 'border-emerald-500 bg-emerald-900/40' : 'border-rose-500 bg-rose-900/40')
                    : 'border-amber-800/50 bg-black/30 hover:bg-black/50';
                return (
                    <button key={i} type="button" disabled={solved} onClick={() => onChoose(i)}
                            className={`text-left px-3 py-2 rounded-md border ${tone} disabled:cursor-default cursor-pointer`}>
                        {localized(option.text, language)}
                    </button>
                );
            })}
        </div>
    );
}
