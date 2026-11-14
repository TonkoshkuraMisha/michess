// --- FILE: frontend/src/components/learn/ClassicsPage.tsx ---
// Партии мастеров с объяснениями (таск 14.7): /learn/classics — подборка, /learn/classics/:id — просмотр партии:
// вводный текст, ходы с комментариями наставника, режим «с остановками» (перед ключевым ходом — «что бы вы сыграли?»,
// баллы как в «Угадай ход мастера»), итоговый текст в конце.

import {useEffect, useMemo, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {ArrowLeft, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Check} from 'lucide-react';
import {useI18n} from '../../i18n';
import {coachArrows, coachText} from '../../services/coach';
import {getToken} from '../../services/authToken';
import {fetchLessonProgress, saveLessonProgress} from '../../services/lessonProgress';
import type {LessonProgress} from '../../services/lessonProgress';
import {loadAllClassics, loadClassic, progressId, scoreStop} from '../../content/classics';
import type {ClassicGame} from '../../content/classics';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import type {BoardArrow} from '../puzzles/PuzzleBoard';

const ARROW_COLORS: Record<string, BoardArrow['color']> = {best: 'green', threat: 'red', idea: 'blue'};

function title(game: ClassicGame): string {
    return `${game.white} — ${game.black}`;
}

function evalText(cp: number): string {
    if (Math.abs(cp) >= 50000) return cp > 0 ? '+#' : '-#';
    return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
}

export function ClassicsPage() {
    const {t} = useI18n();
    const [games, setGames] = useState<ClassicGame[]>([]);
    const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
    useEffect(() => {
        void loadAllClassics().then(setGames);
        const token = getToken();
        if (token) {
            fetchLessonProgress(token)
                .then((items) => setProgress(Object.fromEntries(items.map((p) => [p.lesson_id, p]))))
                .catch(() => undefined);
        }
    }, []);
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="classics-page">
            <Link to="/learn" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('learn.title')}</Link>
            <h1 className="text-2xl font-bold text-amber-200">{t('classics.title')}</h1>
            <p className="text-boxwood/85">{t('classics.intro')}</p>
            <ol className="flex flex-col gap-2">
                {games.map((game) => (
                    <li key={game.id}>
                        <Link to={`/learn/classics/${game.id}`} data-testid={`classic-${game.id}`}
                              className="flex items-center justify-between gap-3 bg-acacia px-3 py-2 rounded border-2 border-acacia-dark hover:border-amber-500">
                            <span>
                                <span className="font-bold text-amber-200">{title(game)}</span>
                                <span className="text-xs text-boxwood/70"> · {[game.event, game.year].filter(Boolean).join(', ')} · {game.result}</span>
                            </span>
                            {progress[progressId(game.id)]?.completed && <Check size={16} className="text-emerald-400 shrink-0"/>}
                        </Link>
                    </li>
                ))}
            </ol>
        </div>
    );
}

type StopState = { ply: number; answer: string | null; score: number | null };

export function ClassicGamePage() {
    const {t, language} = useI18n();
    const {gameId = ''} = useParams<{ gameId: string }>();
    const [game, setGame] = useState<ClassicGame | null | undefined>(undefined);
    const [ply, setPly] = useState(0);
    const [withStops, setWithStops] = useState(true);
    const [stop, setStop] = useState<StopState | null>(null);
    const [scores, setScores] = useState<Record<number, number>>({});

    useEffect(() => {
        setGame(undefined);
        setPly(0);
        setStop(null);
        setScores({});
        void loadClassic(gameId).then(setGame);
    }, [gameId]);

    const positions = useMemo(() => {
        if (!game) return [];
        const chess = new Chess();
        const list = [{fen: chess.fen(), san: '', last: null as { from: string; to: string } | null}];
        for (const uci of game.moves) {
            const move = chess.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
            list.push({fen: chess.fen(), san: move.san, last: {from: move.from, to: move.to}});
        }
        return list;
    }, [game]);

    if (game === undefined) return null;
    if (game === null) return <p className="p-4 text-rose-300">{t('learn.notFound')}</p>;

    const total = game.moves.length;
    const stopsByPly = new Map(game.stops.map((s) => [s.ply, s]));
    const atEnd = ply === total;

    const goTo = (target: number) => {
        const next = Math.max(0, Math.min(total, target));
        // Шаг вперёд через ключевой ход: сначала вопрос «что бы вы сыграли?».
        if (withStops && next === ply + 1 && stopsByPly.has(ply) && scores[ply] === undefined) {
            setStop({ply, answer: null, score: null});
            return;
        }
        setStop(null);
        setPly(next);
        if (next === total) {
            const token = getToken();
            if (token) saveLessonProgress(token, progressId(game.id), {step: 0, steps_total: 1, completed: true}).catch(() => undefined);
        }
    };

    const answer = (uci: string) => {
        if (!stop || stop.answer) return;
        const result = scoreStop(stopsByPly.get(stop.ply)!, uci);
        setStop({...stop, answer: uci, score: result.score});
        setScores((all) => ({...all, [stop.ply]: result.score}));
    };

    const continueGame = () => {
        setStop(null);
        setPly(ply + 1);
    };

    const comment = ply > 0 ? game.comments[String(ply - 1)] : undefined;
    const arrows: BoardArrow[] = stop
        ? (stop.answer
            ? [{from: game.moves[stop.ply].slice(0, 2), to: game.moves[stop.ply].slice(2, 4), color: 'green'},
                ...(stop.answer !== game.moves[stop.ply] ? [{from: stop.answer.slice(0, 2), to: stop.answer.slice(2, 4), color: 'red' as const}] : [])]
            : [])
        : coachArrows(comment).map((a) => ({from: a.from, to: a.to, color: ARROW_COLORS[a.kind]}));
    const answered = Object.values(scores);
    const orientation = game.result === '0-1' ? 'black' : 'white';
    const moveNumber = (index: number) => (index % 2 === 0 ? `${index / 2 + 1}.` : '');

    return (
        <div className="w-full max-w-6xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="classic-game">
            <Link to="/learn/classics" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('classics.title')}</Link>
            <div>
                <h1 className="text-2xl font-bold text-amber-200">{title(game)}</h1>
                <p className="text-sm text-boxwood/75">{[game.event, game.year].filter(Boolean).join(', ')} · {game.result}</p>
            </div>
            {ply === 0 && game.intro[language] && (
                <p className="bg-black/30 rounded p-3 text-boxwood/90" data-testid="classic-intro">{game.intro[language]}</p>
            )}
            <div className="flex flex-col lg:flex-row gap-5 items-start">
                <div className="w-full max-w-[560px] flex flex-col gap-2">
                    <PuzzleBoard fen={positions[ply].fen} orientation={orientation} interactive={Boolean(stop && !stop.answer)}
                                 onMove={answer} lastMove={stop ? positions[ply].last : positions[ply].last} arrows={arrows}/>
                    <div className="flex items-center justify-center gap-2">
                        {[
                            {icon: <ChevronFirst size={18}/>, to: 0, label: t('classics.first')},
                            {icon: <ChevronLeft size={18}/>, to: ply - 1, label: t('classics.prev')},
                            {icon: <ChevronRight size={18}/>, to: ply + 1, label: t('classics.next')},
                            {icon: <ChevronLast size={18}/>, to: total, label: t('classics.last')},
                        ].map((b) => (
                            <button key={b.label} type="button" aria-label={b.label} onClick={() => goTo(b.to)}
                                    disabled={Boolean(stop && !stop.answer)}
                                    className="p-2 rounded bg-black/30 border border-amber-900/50 hover:border-amber-500 disabled:opacity-40">
                                {b.icon}
                            </button>
                        ))}
                        <span className="text-xs font-mono text-boxwood/70 ml-2" data-testid="classic-eval">
                            {ply > 0 ? evalText(game.evals[ply - 1]) : '0.0'}
                        </span>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={withStops} onChange={(e) => setWithStops(e.target.checked)} data-testid="classic-stops-toggle"/>
                        {t('classics.withStops')}
                    </label>
                </div>
                <div className="flex-1 flex flex-col gap-3 min-w-0">
                    {stop && (
                        <div className="bg-amber-900/40 border border-amber-600 rounded p-3 flex flex-col gap-2" data-testid="classic-stop">
                            <p className="font-bold text-amber-200">
                                {t(stop.ply % 2 === 0 ? 'classics.questionWhite' : 'classics.questionBlack')}
                            </p>
                            {stop.answer && stop.score !== null && (
                                <>
                                    <p data-testid="classic-stop-score">
                                        {t('classics.stopScore', {score: stop.score, san: positions[stop.ply + 1].san})}
                                    </p>
                                    <button type="button" onClick={continueGame} data-testid="classic-stop-continue"
                                            className="self-start px-3 py-1.5 rounded bg-amber-700 text-white font-bold">
                                        {t('classics.continue')}
                                    </button>
                                </>
                            )}
                            {!stop.answer && (
                                <button type="button" onClick={continueGame} className="self-start text-sm text-amber-400 hover:underline">
                                    {t('classics.skip')}
                                </button>
                            )}
                        </div>
                    )}
                    {!stop && comment && coachText(comment, t) && (
                        <p className="bg-black/30 rounded p-3 text-sm" data-testid="classic-comment">{coachText(comment, t)}</p>
                    )}
                    <div className="bg-black/20 rounded p-2 text-sm font-mono leading-7 max-h-72 overflow-y-auto" data-testid="classic-moves">
                        {positions.slice(1).map((p, i) => (
                            <span key={i}>
                                {moveNumber(i) && <span className="text-boxwood/50 mr-1">{moveNumber(i)}</span>}
                                <button type="button" onClick={() => { setStop(null); setPly(i + 1); }}
                                        className={`px-1 rounded ${i + 1 === ply ? 'bg-amber-700 text-white' : 'hover:bg-white/10'} ${game.comments[String(i)] ? 'underline decoration-dotted' : ''}`}>
                                    {p.san}
                                </button>{' '}
                            </span>
                        ))}
                    </div>
                    {answered.length > 0 && (
                        <p className="text-xs text-boxwood/80" data-testid="classic-stop-total">
                            {t('classics.stopsTotal', {points: answered.reduce((a, b) => a + b, 0), max: answered.length * 100})}
                        </p>
                    )}
                    {atEnd && game.summary[language] && (
                        <p className="bg-black/30 rounded p-3 text-boxwood/90" data-testid="classic-summary">{game.summary[language]}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
