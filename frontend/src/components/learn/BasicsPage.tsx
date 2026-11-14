// --- FILE: frontend/src/components/learn/BasicsPage.tsx ---
// Азбука (таск 14.5): /learn/basics — разделы с прогрессом, /learn/basics/:sectionId — уровни раздела по порядку.
// Крупная доска, без таймеров. Прогресс раздела хранится на сервере как прогресс урока «basics-…» (вошедшим), лучшие
// оценки уровней (1–3 звезды) — в браузере.

import {useEffect, useMemo, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import type {Square} from 'chess.js';
import {Star, ArrowLeft, ArrowRight, RotateCcw, Check} from 'lucide-react';
import {useI18n} from '../../i18n';
import type {MessageKey} from '../../i18n';
import {getToken} from '../../services/authToken';
import {fetchLessonProgress, saveLessonProgress} from '../../services/lessonProgress';
import type {LessonProgress} from '../../services/lessonProgress';
import {BASICS, progressId, sectionById} from '../../content/basics/levels';
import {boardState, goalMove, rating, starsMove, starsPar} from '../../content/basics/rules';
import type {BoardState, Level} from '../../content/basics/rules';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';

const RATINGS_KEY = 'michess.basics.ratings';
const STATES: BoardState[] = ['check', 'mate', 'stalemate', 'none'];

function loadRatings(): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(RATINGS_KEY) ?? '{}') as Record<string, number>;
    } catch {
        return {};
    }
}

function saveRating(key: string, value: number) {
    try {
        const all = loadRatings();
        all[key] = Math.max(all[key] ?? 0, value);
        localStorage.setItem(RATINGS_KEY, JSON.stringify(all));
    } catch {
        // хранилище недоступно — оценка просто не запомнится
    }
}

function useBasicsProgress(): Record<string, LessonProgress> {
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

function levelsDone(saved: LessonProgress | undefined): number {
    if (!saved) return 0;
    return saved.completed ? saved.steps_total : saved.step;
}

export function BasicsPage() {
    const {t} = useI18n();
    const progress = useBasicsProgress();
    const ratings = loadRatings();
    const allDone = BASICS.every((s) => progress[progressId(s.id)]?.completed);
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="basics-page">
            <Link to="/learn" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('learn.title')}</Link>
            <h1 className="text-2xl font-bold text-amber-200">{t('basics.title')}</h1>
            <p className="text-boxwood/85">{t('basics.intro')}</p>
            {!getToken() && <p className="text-sm text-amber-300">{t('learn.loginToSave')}</p>}
            <div className="grid sm:grid-cols-2 gap-3">
                {BASICS.map((section, i) => {
                    const done = levelsDone(progress[progressId(section.id)]);
                    const stars = section.levels.reduce((sum, _, j) => sum + (ratings[`${section.id}:${j}`] ?? 0), 0);
                    return (
                        <Link key={section.id} to={`/learn/basics/${section.id}`} data-testid={`basics-section-${section.id}`}
                              className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark hover:border-amber-500 flex flex-col gap-1">
                            <span className="font-bold text-amber-200">{i + 1}. {t(`basics.sections.${section.id}.title`)}</span>
                            <span className="text-xs text-boxwood/75">
                                {t('basics.sectionProgress', {done, total: section.levels.length})}
                                {stars > 0 && <> · <Star size={11} className="inline text-yellow-400"/> {stars}</>}
                            </span>
                        </Link>
                    );
                })}
            </div>
            {allDone && (
                <div className="bg-amber-900/40 border border-amber-600 rounded p-3 flex flex-wrap items-center gap-3" data-testid="basics-all-done">
                    <span>{t('basics.allDone')}</span>
                    <Link to="/puzzles" className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold">{t('basics.toThemes')}</Link>
                </div>
            )}
        </div>
    );
}

type Feedback = { key: MessageKey; ok: boolean } | null;

function LevelPlayer({level, onSolved}: { level: Level; onSolved: (stars: 1 | 2 | 3) => void }) {
    const {t} = useI18n();
    const par = useMemo(() => (level.kind === 'stars' ? starsPar(level) ?? 0 : 0), [level]);
    const [fen, setFen] = useState(level.fen);
    const [hero, setHero] = useState(level.kind === 'stars' ? level.hero : '');
    const [left, setLeft] = useState<string[]>(level.kind === 'stars' ? level.stars : []);
    const [moves, setMoves] = useState(0);
    const [feedback, setFeedback] = useState<Feedback>(null);
    const [solved, setSolved] = useState(false);
    const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);

    const reset = () => {
        setFen(level.fen);
        setHero(level.kind === 'stars' ? level.hero : '');
        setLeft(level.kind === 'stars' ? level.stars : []);
        setMoves(0);
        setFeedback(null);
        setSolved(false);
        setLastMove(null);
    };

    const finish = (stars: 1 | 2 | 3) => {
        setSolved(true);
        onSolved(stars);
    };

    const onMove = (uci: string) => {
        if (solved) return;
        if (level.kind === 'stars') {
            const verdict = starsMove(fen, hero, uci, new Set(left));
            if ('reason' in verdict) {
                setFeedback({key: `basics.feedback.${verdict.reason}`, ok: false});
                return;
            }
            const remaining = left.filter((square) => square !== verdict.to);
            setFen(verdict.fen);
            setHero(verdict.to);
            setLeft(remaining);
            setLastMove({from: uci.slice(0, 2), to: verdict.to});
            setMoves(moves + 1);
            setFeedback(null);
            if (remaining.length === 0) finish(rating(moves + 1, par));
        } else if (level.kind === 'goal') {
            const verdict = goalMove(fen, level.goal, uci);
            if (verdict.fen) setFen(verdict.fen);
            setLastMove({from: uci.slice(0, 2), to: uci.slice(2, 4)});
            if (verdict.ok) {
                setFeedback({key: 'basics.feedback.correct', ok: true});
                finish(3);
            } else {
                if ('reason' in verdict) setFeedback({key: `basics.feedback.${verdict.reason}`, ok: false});
                if (verdict.fen) window.setTimeout(() => setFen(level.fen), 900);
            }
        }
    };

    const answer = (state: BoardState) => {
        if (level.kind !== 'question' || solved) return;
        const right = boardState(level.fen);
        if (state === right) {
            setFeedback({key: `basics.explain.${right}`, ok: true});
            finish(3);
        } else {
            setFeedback({key: 'basics.feedback.wrongAnswer', ok: false});
        }
    };

    const task = level.kind === 'stars'
        ? t(isCaptureLevel(level) ? 'basics.goals.capture' : 'basics.goals.stars')
        : level.kind === 'goal' ? t(`basics.goals.${level.goal}`) : t('basics.goals.question');

    return (
        <div className="flex flex-col md:flex-row gap-5 items-start">
            <div className="w-full max-w-[600px]">
                <PuzzleBoard fen={fen} orientation="white" interactive={!solved && level.kind !== 'question'} onMove={onMove}
                             lastMove={lastMove} stars={left}/>
            </div>
            <div className="flex-1 flex flex-col gap-3 min-w-0">
                <p className="text-lg text-amber-200" data-testid="basics-task">{task}</p>
                {level.kind === 'stars' && (
                    <p className="text-sm" data-testid="basics-moves">{t('basics.moves', {moves, par})}</p>
                )}
                {level.kind === 'question' && (
                    <div className="grid grid-cols-2 gap-2">
                        {STATES.map((state) => (
                            <button key={state} type="button" onClick={() => answer(state)} disabled={solved}
                                    data-testid={`basics-answer-${state}`}
                                    className="px-3 py-2 rounded border border-amber-900/60 bg-black/30 hover:border-amber-500 disabled:opacity-60">
                                {t(`basics.states.${state}`)}
                            </button>
                        ))}
                    </div>
                )}
                {feedback && (
                    <p role="status" data-testid="basics-feedback" className={`text-sm ${feedback.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {t(feedback.key)}
                    </p>
                )}
                {!solved && (
                    <button type="button" onClick={reset} className="self-start text-sm text-amber-400 hover:underline flex items-center gap-1">
                        <RotateCcw size={14}/> {t('basics.retry')}
                    </button>
                )}
            </div>
        </div>
    );
}

/** Уровень про взятие: на звёздах стоят фигуры соперника. */
function isCaptureLevel(level: Extract<Level, { kind: 'stars' }>): boolean {
    const game = new Chess(level.fen);
    return level.stars.some((square) => game.get(square as Square));
}

export function BasicsSectionPage() {
    const {t} = useI18n();
    const {sectionId = ''} = useParams<{ sectionId: string }>();
    const section = sectionById(sectionId);
    const [index, setIndex] = useState(0);
    const [result, setResult] = useState<1 | 2 | 3 | null>(null);

    if (!section) {
        return <p className="p-4 text-rose-300">{t('learn.notFound')}</p>;
    }
    const total = section.levels.length;
    const last = index === total - 1;
    const position = BASICS.indexOf(section);
    const nextSection = BASICS[position + 1];

    const solved = (stars: 1 | 2 | 3) => {
        setResult(stars);
        saveRating(`${section.id}:${index}`, stars);
        const token = getToken();
        if (token) {
            saveLessonProgress(token, progressId(section.id), {step: last ? total - 1 : index + 1, steps_total: total, completed: last})
                .catch(() => undefined);
        }
    };

    const go = (next: number) => {
        setIndex(next);
        setResult(null);
    };

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="basics-section">
            <Link to="/learn/basics" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('basics.title')}</Link>
            <div>
                <h1 className="text-2xl font-bold text-amber-200">{t(`basics.sections.${section.id}.title`)}</h1>
                <p className="text-boxwood/85">{t(`basics.sections.${section.id}.text`)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label={t('basics.levels')}>
                {section.levels.map((_, i) => (
                    <button key={i} type="button" onClick={() => go(i)} aria-current={i === index}
                            className={`w-8 h-8 rounded text-sm border ${i === index ? 'bg-amber-700 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50'}`}>
                        {i + 1}
                    </button>
                ))}
            </div>
            <p className="text-xs text-boxwood/70">{t('basics.levelOf', {index: index + 1, total})}</p>
            <LevelPlayer key={`${section.id}-${index}`} level={section.levels[index]} onSolved={solved}/>
            {result && (
                <div className="bg-black/40 rounded p-3 flex flex-wrap items-center gap-3" data-testid="basics-result">
                    <span className="flex gap-0.5" aria-label={t('basics.rating', {stars: result})}>
                        {[1, 2, 3].map((n) => <Star key={n} size={22} className={n <= result ? 'text-yellow-400 fill-yellow-400' : 'text-boxwood/40'}/>)}
                    </span>
                    {result < 3 && <span className="text-sm">{t('basics.tryFewer')}</span>}
                    {!last && (
                        <button type="button" onClick={() => go(index + 1)} data-testid="basics-next"
                                className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold flex items-center gap-1.5">
                            {t('basics.nextLevel')} <ArrowRight size={15}/>
                        </button>
                    )}
                    {last && (
                        <>
                            <span className="text-emerald-300 flex items-center gap-1"><Check size={16}/> {t('basics.sectionDone')}</span>
                            {nextSection
                                ? <Link to={`/learn/basics/${nextSection.id}`} onClick={() => go(0)} data-testid="basics-next-section"
                                        className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold">
                                    {t('basics.nextSection', {title: t(`basics.sections.${nextSection.id}.title`)})}
                                </Link>
                                : <Link to="/puzzles" className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold">{t('basics.toThemes')}</Link>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
