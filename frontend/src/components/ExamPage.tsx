// Диагностический экзамен (таск 22.0): /exam — 10 тестов по разделам каталога тем (по 10 позиций от лёгкой к
// трудной) и эндшпильный экзамен на 30 позиций. Ответ — один ход; во время теста подсказок и отметок нет, в конце —
// оценка силы, уровень по разрядам и разбор. Игровой рейтинг не меняется; итоги — стартовые данные карты навыков.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowLeft, CheckCircle2, ClipboardCheck, XCircle} from 'lucide-react';
import {renderUiMessage, useI18n} from '../i18n';
import type {MessageKey, UiMessage} from '../i18n';
import {API_BASE_URL} from '../config/api';
import {getToken} from '../services/authToken';
import {errorMessage, readApiErrorOr, UiError} from '../services/apiErrors';
import {PuzzleBoard} from './puzzles/PuzzleBoard';

export type ExamLevel = 'novice' | 'fourth' | 'third' | 'second' | 'first' | 'candidate' | 'master';

export interface ExamSummary {
    tests: string[];
    results: Record<string, { correct: number; total: number; estimate: number; level: ExamLevel; at: string | null }>;
    overall: number | null;
    level: ExamLevel | null;
    passed: number;
    of: number;
}

interface Question {
    id: number;
    fen: string;
    color: 'white' | 'black';
    previous_move: string;
}

interface Graded {
    correct: number;
    total: number;
    estimate: number;
    level: ExamLevel;
    review: { id: number; answer: string; correct: boolean; solution: string; solution_san: string; rating: number }[];
}

async function call<T>(path: string, body?: object): Promise<T> {
    const token = getToken();
    const res = await fetch(`${API_BASE_URL}/api/v1/exam${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

const sectionLabel = (t: (key: MessageKey, params?: Record<string, string | number>) => string, section: string) =>
    section === 'endgame' ? t('exam.endgameTest') : `${section}. ${t(`puzzles.sections.${section}` as MessageKey)}`;

export function ExamPage() {
    const {t} = useI18n();
    const logged = Boolean(getToken());
    const [summary, setSummary] = useState<ExamSummary | null>(null);
    const [section, setSection] = useState<string | null>(null);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [answers, setAnswers] = useState<string[]>([]);
    const [graded, setGraded] = useState<Graded | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);

    const loadSummary = () => {
        if (!logged) return;
        call<ExamSummary>('').then(setSummary).catch((err) => setError(errorMessage(err, 'common.networkError')));
    };
    useEffect(loadSummary, [logged]); // eslint-disable-line react-hooks/exhaustive-deps

    const start = async (next: string) => {
        setBusy(true);
        setError(null);
        setGraded(null);
        try {
            const data = await call<{ questions: Question[] }>(`/${next}/questions`);
            setSection(next);
            setQuestions(data.questions);
            setAnswers([]);
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    };

    const answer = async (move: string) => {
        const next = [...answers, move];
        setAnswers(next);
        if (next.length < questions.length || !section) return;
        setBusy(true);
        try {
            setGraded(await call<Graded>(`/${section}/submit`, {answers: questions.map((q, i) => ({id: q.id, move: next[i]}))}));
            loadSummary();
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    };

    const back = () => {
        setSection(null);
        setQuestions([]);
        setAnswers([]);
        setGraded(null);
    };

    const current = section && !graded ? questions[answers.length] : null;

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
                </>
            )}

            {section && (
                <button type="button" onClick={back} className="self-start text-sm text-amber-400 hover:underline flex items-center gap-1">
                    <ArrowLeft size={14}/> {t('exam.backToList')}
                </button>
            )}

            {current && (
                <div className="flex flex-col lg:flex-row gap-5 items-start" data-testid="exam-question">
                    <div className="w-full max-w-[480px]">
                        <PuzzleBoard key={current.id} fen={current.fen} orientation={current.color} interactive={!busy}
                                     onMove={(uci) => void answer(uci)}
                                     lastMove={{from: current.previous_move.slice(0, 2), to: current.previous_move.slice(2, 4)}}/>
                    </div>
                    <div className="flex flex-col gap-2 text-sm">
                        <p className="font-bold text-amber-200">{sectionLabel(t, section!)}</p>
                        <p data-testid="exam-progress">{t('exam.progress', {n: answers.length + 1, total: questions.length})}</p>
                        <p className="text-boxwood/80">{t(current.color === 'white' ? 'exam.whiteToMove' : 'exam.blackToMove')}</p>
                        <button type="button" onClick={() => void answer('0000')} disabled={busy} data-testid="exam-skip"
                                className="self-start px-3 py-1 rounded bg-black/30 border border-amber-900/50 text-xs">{t('exam.skip')}</button>
                    </div>
                </div>
            )}

            {graded && (
                <section className="flex flex-col gap-2" data-testid="exam-result">
                    <p className="text-lg font-bold text-amber-200">
                        {t('exam.result', {correct: graded.correct, total: graded.total, level: t(`exam.levels.${graded.level}`), rating: graded.estimate})}
                    </p>
                    <ol className="flex flex-col gap-1 text-sm">
                        {graded.review.map((r, i) => (
                            <li key={r.id} className="flex items-center gap-2">
                                {r.correct ? <CheckCircle2 size={16} className="text-emerald-400"/> : <XCircle size={16} className="text-rose-400"/>}
                                <span>{t('exam.reviewLine', {n: i + 1, move: r.solution_san, rating: r.rating})}</span>
                            </li>
                        ))}
                    </ol>
                    <Link to="/puzzles" className="self-start text-sm text-amber-400 hover:underline">{t('exam.train')}</Link>
                </section>
            )}
        </div>
    );
}
