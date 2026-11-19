// Диагностический экзамен (таск 22.0): /exam — 10 тестов по разделам каталога тем (по 10 позиций от лёгкой к
// трудной) и эндшпильный экзамен на 30 позиций. Решение доигрывается до конца (до мата или последнего хода
// комбинации): верный ход проверяет сервер (/move), соперник отвечает ходом из решения, за каждый верный ход — очко;
// ошибка или «Не знаю» заканчивают позицию, набранные на ней очки остаются. Подсказок нет; в конце — оценка силы,
// уровень по разрядам и разбор. Игровой рейтинг не меняется; итоги — стартовые данные карты навыков.

import {useEffect, useRef, useState} from 'react';
import {Chess} from 'chess.js';
import {Link, useSearchParams} from 'react-router-dom';
import {ArrowLeft, CheckCircle2, ClipboardCheck, XCircle} from 'lucide-react';
import {renderUiMessage, useI18n} from '../i18n';
import type {MessageKey, UiMessage} from '../i18n';
import {getToken} from '../services/authToken';
import {errorMessage} from '../services/apiErrors';
import {examCall} from '../services/exam';
import {PuzzleBoard} from './puzzles/PuzzleBoard';

/** Уровни по разрядам, которые сервер присваивает оценке силы (src/services/exam.py, LEVELS). */
export type ExamLevel = 'novice' | 'fourth' | 'third' | 'second' | 'first' | 'candidate' | 'master';

/** Ответ GET /exam: последние результаты по разделам, общая оценка и уровень. */
export interface ExamSummary {
    tests: string[];
    /** Экзамены уровней Большого курса (27.12): level0 … level5. */
    level_tests?: string[];
    results: Record<string, { correct: number; total: number; estimate: number; level: ExamLevel; at: string | null }>;
    overall: number | null;
    level: ExamLevel | null;
    passed: number;
    of: number;
}

/** Позиция теста: id задачи, позиция после хода соперника, чья очередь и этот ход (для подсветки). */
interface Question {
    id: number;
    fen: string;
    color: 'white' | 'black';
    previous_move: string;
    branch?: string;
}

/** Итог сданного теста и разбор по позициям. */
interface Graded {
    correct: number;
    total: number;
    estimate: number;
    level: ExamLevel;
    review: {
        id: number; answer: string; correct: boolean; solution: string; solution_san: string; rating: number;
        points?: number; max_points?: number;
    }[];
    /** Очки: верные ходы по всем позициям из возможных. */
    points?: number;
    max_points?: number;
    /** Экзамен уровня: верно / всего по ветвям курса. */
    branches?: Record<string, { correct: number; total: number }> | null;
}

/** Ответ сервера на ход во время теста. */
interface MoveResult {
    correct: boolean;
    reply: string | null;
    done: boolean;
    solved: boolean;
    points: number;
    max_points: number;
}

/** Пауза перед ответом соперника и перед следующей позицией: успеть увидеть свой ход и финал комбинации. */
export const EXAM_REPLY_MS = 450;
export const EXAM_NEXT_MS = 1100;

// Клетки хода из записи UCI.
const squares = (uci: string) => ({from: uci.slice(0, 2), to: uci.slice(2, 4)});

/** Позиция после хода (UCI); при сбое разбора — прежняя. */
function afterMove(fen: string, uci: string): string {
    try {
        const game = new Chess(fen);
        game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
        return game.fen();
    } catch {
        return fen;
    }
}

// Код теста уровня курса: level0 … level5.
const LEVEL_TEST = /^level(\d)$/;

/** Название теста: раздел диагностики, эндшпильный экзамен или экзамен уровня курса. */
export function examTitle(t: (key: string, params?: Record<string, string | number>) => string, section: string): string {
    const level = LEVEL_TEST.exec(section);
    if (level) return t('exam.levelTest', {n: Number(level[1])});
    return section === 'endgame' ? t('exam.endgameTest') : `${section}. ${t(`puzzles.sections.${section}`)}`;
}

const call = examCall;

/** Последние результаты по разделам — для отметки «уровень пройден» в Большом курсе (27.12). */
export const fetchExamSummary = () => call<ExamSummary>('');

// То же, что examTitle, но для типизированной функции перевода.
const sectionLabel = (t: (key: MessageKey, params?: Record<string, string | number>) => string, section: string) =>
    examTitle(t as unknown as (key: string, params?: Record<string, string | number>) => string, section);

/**
 * Экзамен: выбор теста, прохождение позиций и разбор. Ходы идут на сервер по одному (/move); таймеры
 * хранятся в timers и снимаются при уходе со страницы.
 */
export function ExamPage() {
    const {t} = useI18n();
    const logged = Boolean(getToken());
    const [summary, setSummary] = useState<ExamSummary | null>(null);
    const [section, setSection] = useState<string | null>(null);
    const [questions, setQuestions] = useState<Question[]>([]);
    // Ходы игрока по каждой пройденной позиции; текущая позиция — played и board (позиция после сыгранных ходов).
    const [answers, setAnswers] = useState<string[][]>([]);
    const [played, setPlayed] = useState<string[]>([]);
    const [board, setBoard] = useState<{ fen: string; last: string; mark?: boolean } | null>(null);
    const [points, setPoints] = useState(0);
    const [flash, setFlash] = useState<{ kind: 'right' | 'solved' | 'wrong'; gain: number } | null>(null);
    const [waiting, setWaiting] = useState(false);
    const timers = useRef<number[]>([]);
    const later = (fn: () => void, ms: number) => {
        timers.current.push(window.setTimeout(fn, ms));
    };
    const clearTimers = () => {
        timers.current.forEach((id) => window.clearTimeout(id));
        timers.current = [];
    };
    useEffect(() => clearTimers, []);
    const resetQuestion = () => {
        setPlayed([]);
        setBoard(null);
        setFlash(null);
        setWaiting(false);
    };
    const [graded, setGraded] = useState<Graded | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);

    const loadSummary = () => {
        if (!logged) return;
        call<ExamSummary>('').then(setSummary).catch((err) => setError(errorMessage(err, 'common.networkError')));
    };
    useEffect(loadSummary, [logged]); // eslint-disable-line react-hooks/exhaustive-deps

    // Переход из курса или программы: /exam?test=level3 — сразу начать этот тест.
    const [search] = useSearchParams();
    const requested = search.get('test');

    const start = async (next: string) => {
        setBusy(true);
        setError(null);
        setGraded(null);
        try {
            const data = await call<{ questions: Question[] }>(`/${next}/questions`);
            clearTimers();
            setSection(next);
            setQuestions(data.questions);
            setAnswers([]);
            setPoints(0);
            resetQuestion();
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (logged && requested && !section) void start(requested);
    }, [logged, requested]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Позиция закончена (решена, ошибка или «Не знаю»): записать ходы и перейти дальше или сдать тест. */
    const finish = async (moves: string[]) => {
        const next = [...answers, moves];
        setAnswers(next);
        resetQuestion();
        if (next.length < questions.length || !section) return;
        setBusy(true);
        try {
            setGraded(await call<Graded>(`/${section}/submit`, {answers: questions.map((q, i) => ({id: q.id, moves: next[i]}))}));
            loadSummary();
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    };

    const current = section && !graded ? questions[answers.length] : null;
    const position = current ? board ?? {fen: current.fen, last: current.previous_move} : null;

    const move = async (uci: string) => {
        if (!current || !position || !section || waiting || busy) return;
        const moves = [...played, uci];
        setWaiting(true);
        setError(null);
        let result: MoveResult;
        try {
            result = await call<MoveResult>(`/${section}/move`, {id: current.id, moves});
        } catch (err) {
            // Ход не засчитан и не потерян: позиция прежняя, можно повторить.
            setError(errorMessage(err, 'common.networkError'));
            setWaiting(false);
            return;
        }
        const mine = afterMove(position.fen, uci);
        setBoard({fen: mine, last: uci, mark: result.correct});
        // Другой мат засчитывается как всё решение — очки сразу за все оставшиеся ходы.
        const gain = result.correct ? Math.max(1, result.points - played.length) : 0;
        if (gain) setPoints((value) => value + gain);
        setFlash({kind: !result.correct ? 'wrong' : result.done ? 'solved' : 'right', gain});
        if (result.done || !result.reply) {
            later(() => void finish(moves), EXAM_NEXT_MS);
            return;
        }
        const reply = result.reply;
        later(() => {
            setPlayed(moves);
            setBoard({fen: afterMove(mine, reply), last: reply});
            setWaiting(false);
        }, EXAM_REPLY_MS);
    };

    const back = () => {
        clearTimers();
        setSection(null);
        setQuestions([]);
        setAnswers([]);
        setPoints(0);
        resetQuestion();
        setGraded(null);
    };

    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="exam-page">
            <header className="flex items-center gap-2">
                <ClipboardCheck className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('exam.title')}</h1>
            </header>
            {!section && <p className="text-boxwood/85">{t('exam.intro')}</p>}
            {!logged && <p className="text-amber-300" data-testid="exam-login">{t('exam.loginRequired')}</p>}
            {error && <p role="alert" className="text-rose-300">{renderUiMessage(error, t)}</p>}

            {!section && summary && (
                <>
                    <p className="font-bold text-amber-300" data-testid="exam-overall">
                        {summary.overall && summary.level
                            ? t('exam.overall', {level: t(`exam.levels.${summary.level}`), rating: summary.overall, passed: summary.passed, of: summary.of})
                            : t('exam.noResults')}
                    </p>
                    <ul className="grid sm:grid-cols-2 gap-2">
                        {summary.tests.map((test) => {
                            const result = summary.results[test];
                            return (
                                <li key={test} className="bg-acacia rounded-lg border-2 border-acacia-dark p-3 flex flex-col gap-1.5 text-sm" data-testid={`exam-test-${test}`}>
                                    <span className="font-bold text-amber-200">{sectionLabel(t, test)}</span>
                                    <span className="text-xs text-boxwood/80">
                                        {result ? t('exam.lastResult', {correct: result.correct, total: result.total, level: t(`exam.levels.${result.level}`)})
                                            : t('exam.notTaken')}
                                    </span>
                                    <button type="button" disabled={busy} onClick={() => void start(test)} data-testid={`exam-start-${test}`}
                                            className="self-start px-3 py-1 rounded bg-amber-700 text-white font-bold text-xs disabled:opacity-50">
                                        {t(result ? 'exam.retake' : 'exam.start')}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {summary.level_tests && summary.level_tests.length > 0 && (
                        <>
                            <h2 className="font-bold text-amber-300 mt-1">{t('exam.levelTests')}</h2>
                            <ul className="grid sm:grid-cols-3 gap-2">
                                {summary.level_tests.map((test) => {
                                    const result = summary.results[test];
                                    return (
                                        <li key={test} className="bg-acacia rounded-lg border-2 border-acacia-dark p-3 flex flex-col gap-1.5 text-sm" data-testid={`exam-test-${test}`}>
                                            <span className="font-bold text-amber-200">{sectionLabel(t, test)}</span>
                                            <span className="text-xs text-boxwood/80">
                                                {result ? t('exam.lastResult', {correct: result.correct, total: result.total, level: t(`exam.levels.${result.level}`)})
                                                    : t('exam.notTaken')}
                                            </span>
                                            <button type="button" disabled={busy} onClick={() => void start(test)} data-testid={`exam-start-${test}`}
                                                    className="self-start px-3 py-1 rounded bg-amber-700 text-white font-bold text-xs disabled:opacity-50">
                                                {t(result ? 'exam.retake' : 'exam.start')}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                </>
            )}

            {section && (
                <button type="button" onClick={back} className="self-start text-sm text-amber-400 hover:underline flex items-center gap-1">
                    <ArrowLeft size={14}/> {t('exam.backToList')}
                </button>
            )}

            {current && position && (
                <div className="flex flex-col lg:flex-row gap-5 items-start" data-testid="exam-question">
                    <div className="w-full max-w-[480px]">
                        <PuzzleBoard key={current.id} fen={position.fen} orientation={current.color}
                                     interactive={!busy && !waiting} onMove={(uci) => void move(uci)}
                                     lastMove={squares(position.last)}
                                     mark={position.mark === undefined ? null : {square: position.last.slice(2, 4), ok: position.mark}}/>
                    </div>
                    <div className="flex flex-col gap-2 text-sm">
                        <p className="font-bold text-amber-200">{sectionLabel(t, section!)}</p>
                        <p data-testid="exam-progress">{t('exam.progress', {n: answers.length + 1, total: questions.length})}</p>
                        <p className="font-bold text-amber-300" data-testid="exam-points">{t('exam.pointsNow', {points})}</p>
                        <p className="text-boxwood/80">{t(current.color === 'white' ? 'exam.whiteToMove' : 'exam.blackToMove')}</p>
                        <p className="text-xs text-boxwood/70">{t('exam.playToEnd')}</p>
                        <p className={`min-h-5 font-bold ${flash?.kind === 'wrong' ? 'text-rose-300' : 'text-emerald-300'}`}
                           data-testid="exam-flash" aria-live="polite">
                            {flash?.kind === 'right' && t('exam.moveRight', {gain: flash.gain})}
                            {flash?.kind === 'solved' && t('exam.solved', {gain: flash.gain})}
                            {flash?.kind === 'wrong' && t('exam.moveWrong')}
                        </p>
                        <button type="button" onClick={() => void finish(played)} disabled={busy || waiting} data-testid="exam-skip"
                                className="self-start px-3 py-1 rounded bg-black/30 border border-amber-900/50 text-xs disabled:opacity-50">{t('exam.skip')}</button>
                    </div>
                </div>
            )}

            {graded && (
                <section className="flex flex-col gap-2" data-testid="exam-result">
                    <p className="text-lg font-bold text-amber-200">
                        {t('exam.result', {correct: graded.correct, total: graded.total, level: t(`exam.levels.${graded.level}`), rating: graded.estimate})}
                    </p>
                    {graded.max_points !== undefined && graded.max_points > 0 && (
                        <p className="font-bold text-amber-300" data-testid="exam-result-points">
                            {t('exam.pointsTotal', {points: graded.points ?? 0, max: graded.max_points})}
                        </p>
                    )}
                    {graded.branches && (
                        <ul className="flex flex-wrap gap-2 text-sm" data-testid="exam-branches">
                            {Object.entries(graded.branches).map(([branch, score]) => (
                                <li key={branch} className="px-2 py-1 rounded bg-black/30 border border-amber-900/50">
                                    {t(`supercourse.branches.${branch}` as MessageKey)}: {score.correct}/{score.total}
                                </li>
                            ))}
                        </ul>
                    )}
                    <ol className="flex flex-col gap-1 text-sm">
                        {graded.review.map((r, i) => (
                            <li key={r.id} className="flex items-center gap-2">
                                {r.correct ? <CheckCircle2 size={16} className="text-emerald-400"/> : <XCircle size={16} className="text-rose-400"/>}
                                <span>
                                    {t('exam.reviewLine', {n: i + 1, move: r.solution_san, rating: r.rating})}
                                    {r.max_points !== undefined && ` · ${t('exam.reviewScore', {points: r.points ?? 0, max: r.max_points})}`}
                                </span>
                            </li>
                        ))}
                    </ol>
                    <Link to="/puzzles" className="self-start text-sm text-amber-400 hover:underline">{t('exam.train')}</Link>
                </section>
            )}
        </div>
    );
}
