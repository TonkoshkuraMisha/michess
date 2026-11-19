// --- FILE: frontend/src/components/trainers/CalcGames.tsx ---
// Счёт и внимание (таск 19.7). QuizGame — QUIZ_ROUNDS быстрых вопросов с ответом кнопкой и разбором после каждого
// («Кто выиграет размен?», «Сколько ходов до поля?», «Успевает ли король?», «Оцени позицию»); после ответа доска
// свободна — позицию можно разыграть (usePositionExplorer). ChecksGame — «Шахи и
// взятия»: отметить на доске все шахи и взятия за обе стороны (поле «откуда», поле «куда»), затем «Готово».
// Данные: партии классики (content/classics) и чистые правила trainers/calculation.ts (без сети). Запускается из TrainersPage.tsx; уровней у этих тренажёров нет.

import {useEffect, useMemo, useState} from 'react';
import {useI18n} from '../../i18n';
import type {MessageKey} from '../../i18n';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import type {BoardArrow} from '../puzzles/PuzzleBoard';
import {ExplorerControls, usePositionExplorer} from '../puzzles/usePositionExplorer';
import {loadAllClassics} from '../../content/classics';
import type {ClassicGame} from '../../content/classics';
import {positionPool} from '../../trainers/memory';
import {
    checksAndCaptures, checksPosition, compareQuestion, distanceQuestion, evalQuestion, exchangeQuestion, sanOf, squareFen,
    squareQuestion,
} from '../../trainers/calculation';

/** Вопросов в одной попытке QuizGame; 10 очков за верный ответ. */
export const QUIZ_ROUNDS = 10;
/** Позиций в одной попытке ChecksGame. */
export const CHECKS_ROUNDS = 3;
/** Виды викторин — коды тренажёров calc_* (кроме calc_checks, у него своя игра). */
export type QuizKind = 'calc_exchange' | 'calc_distance' | 'calc_square' | 'calc_eval' | 'calc_compare';

/** Общие свойства игр: уровень (здесь не используется), seed и onFinish(очки, ошибки). */
interface GameProps {
    level: number;
    seed: number;
    onFinish: (score: number, mistakes: number) => void;
}

/** Готовый вопрос: позиция, подсветка, ключ текста вопроса с параметрами, варианты ответа (label — ключ каталога или готовая подпись хода) и id верного. */
interface Quiz {
    fen: string;
    orientation: 'white' | 'black';
    highlights: string[];
    prompt: MessageKey;
    params?: Record<string, string | number>;
    options: { id: string; label: MessageKey | string }[];
    answer: string;
    /** Разбор после ответа (например, оценки обоих ходов). */
    explain?: { key: MessageKey; params: Record<string, string | number> };
}

/** Оценка в сотых пешки → «+1.5»; знак «+» только у положительных. */
const pawns = (cp: number) => `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;

/** Партии классики по требованию (не в основном бандле); при ошибке загрузки — пустой список. */
function useClassics(): ClassicGame[] | null {
    const [games, setGames] = useState<ClassicGame[] | null>(null);
    useEffect(() => {
        let alive = true;
        loadAllClassics().then((list) => alive && setGames(list)).catch(() => alive && setGames([]));
        return () => {
            alive = false;
        };
    }, []);
    return games;
}

/** Пустая доска (FEN): основа вопросов, где позиция строится из одной фигуры. */
const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';

/** Строит вопрос выбранного вида детерминированно по seed и номеру; null — в пуле не нашлось подходящей позиции. */
function makeQuiz(kind: QuizKind, games: ClassicGame[], pool: string[], seed: number, index: number): Quiz | null {
    if (kind === 'calc_exchange') {
        const q = exchangeQuestion(pool, seed * 97 + index);
        if (!q) return null;
        return {
            fen: q.fen, orientation: q.fen.split(' ')[1] === 'w' ? 'white' : 'black', highlights: [q.square],
            prompt: 'trainers.calc.exchangePrompt', params: {square: q.square}, answer: q.answer,
            options: (['win', 'equal', 'lose'] as const).map((id) => ({id, label: `trainers.calc.exchange.${id}` as MessageKey})),
        };
    }
    if (kind === 'calc_distance') {
        const q = distanceQuestion(seed, index);
        const fen = EMPTY.replace('8/8/8/8/8/8/8/8', placementWith(q.from, q.piece === 'n' ? 'N' : 'K'));
        return {
            fen, orientation: 'white', highlights: [q.to], prompt: q.piece === 'n' ? 'trainers.calc.knightPrompt' : 'trainers.calc.kingPrompt',
            params: {from: q.from, to: q.to}, answer: String(q.answer),
            options: Array.from({length: 8}, (_, i) => ({id: String(i), label: String(i)})).filter((o) => q.piece === 'k' || o.id !== '0'),
        };
    }
    if (kind === 'calc_square') {
        const q = squareQuestion(seed, index);
        return {
            fen: squareFen(q), orientation: 'white', highlights: [`${q.pawn[0]}8`],
            prompt: q.toMove === 'w' ? 'trainers.calc.squareWhite' : 'trainers.calc.squareBlack', answer: q.answer ? 'yes' : 'no',
            options: [{id: 'yes', label: 'trainers.calc.catches'}, {id: 'no', label: 'trainers.calc.escapes'}],
        };
    }
    if (kind === 'calc_compare') {
        const q = compareQuestion(games, seed * 71 + index);
        if (!q) return null;
        const white = q.fen.split(' ')[1] === 'w';
        return {
            fen: q.fen, orientation: white ? 'white' : 'black', highlights: [], answer: q.best,
            prompt: white ? 'trainers.calc.comparePromptWhite' : 'trainers.calc.comparePromptBlack',
            options: q.options.map((uci) => ({id: uci, label: sanOf(q.fen, uci)})),
            explain: {key: 'trainers.calc.compareVerdict', params: {
                best: sanOf(q.fen, q.best), bestCp: pawns(q.bestCp), other: sanOf(q.fen, q.other), otherCp: pawns(q.otherCp),
            }},
        };
    }
    const q = evalQuestion(games, seed * 53 + index);
    if (!q) return null;
    return {
        fen: q.fen, orientation: 'white', highlights: [], prompt: 'trainers.calc.evalPrompt', answer: q.answer,
        options: (['white', 'equal', 'black'] as const).map((id) => ({id, label: `trainers.calc.eval.${id}` as MessageKey})),
    };
}

/** Расстановка FEN с одной фигурой на поле. */
function placementWith(square: string, piece: string): string {
    const rows: string[] = [];
    for (let rank = 8; rank >= 1; rank--) {
        if (Number(square[1]) !== rank) {
            rows.push('8');
            continue;
        }
        const file = 'abcdefgh'.indexOf(square[0]);
        rows.push(`${file || ''}${piece}${7 - file || ''}`);
    }
    return rows.join('/');
}

/** Серия быстрых вопросов; после ответа доска свободна — позицию можно разыграть самому. */
export function QuizGame({kind, seed, onFinish}: GameProps & { kind: QuizKind }) {
    const {t} = useI18n();
    const games = useClassics();
    const pool = useMemo(() => (games ? positionPool(games, []) : null), [games]);
    const [index, setIndex] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const [score, setScore] = useState({correct: 0, wrong: 0});
    const explorer = usePositionExplorer();
    const quiz = useMemo(() => (games && pool ? makeQuiz(kind, games, pool, seed, index) : null), [kind, games, pool, seed, index]);

    if (!games) return <p className="text-sm text-boxwood/70">{t('trainers.memory.loading')}</p>;
    if (!quiz) return <p className="text-sm text-rose-300">{t('trainers.memory.noPositions')}</p>;

    const answer = (id: string) => {
        if (picked) return;
        setPicked(id);
        setScore((s) => (id === quiz.answer ? {...s, correct: s.correct + 1} : {...s, wrong: s.wrong + 1}));
        // После ответа позицию можно разыграть самому (например, гонку пешки и короля) — usePositionExplorer.
        explorer.start(quiz.fen);
    };
    const next = () => {
        if (index + 1 >= QUIZ_ROUNDS) {
            onFinish(score.correct * 10, score.wrong);
            return;
        }
        setIndex((i) => i + 1);
        setPicked(null);
        explorer.stop();
    };
    const label = (l: string) => (l.startsWith('trainers.') ? t(l as MessageKey) : l);

    return (
        <div className="flex flex-col gap-3" data-testid={`quiz-${kind}`}>
            <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-bold text-amber-200">{t('trainers.calc.question', {n: index + 1, total: QUIZ_ROUNDS})}</span>
                <span className="text-sm" data-testid="quiz-score">{t('trainers.coord.score', {score: score.correct, mistakes: score.wrong})}</span>
            </div>
            <p className="text-lg" data-testid="quiz-prompt">{t(quiz.prompt, quiz.params)}</p>
            <div className="w-full max-w-[420px]">
                <PuzzleBoard fen={explorer.fen ?? quiz.fen} orientation={quiz.orientation} interactive={explorer.active}
                             onMove={(uci) => explorer.play(uci)} lastMove={explorer.lastMove}
                             highlights={explorer.plies ? [] : quiz.highlights} sound={explorer.active}/>
            </div>
            <ExplorerControls explorer={explorer}/>
            <div className="flex flex-wrap gap-2">
                {quiz.options.map((o) => {
                    const tone = !picked ? 'bg-black/40 border-amber-800/60 hover:border-amber-400'
                        : o.id === quiz.answer ? 'bg-emerald-800 border-emerald-400' : o.id === picked ? 'bg-rose-900 border-rose-500' : 'bg-black/30 border-transparent opacity-60';
                    return (
                        <button key={o.id} type="button" onClick={() => answer(o.id)} data-testid={`quiz-option-${o.id}`}
                                className={`px-4 py-2 rounded-lg border font-bold ${tone}`}>{label(o.label)}</button>
                    );
                })}
            </div>
            {picked && quiz.explain && <p className="text-sm text-boxwood/85" data-testid="quiz-explain">{t(quiz.explain.key, quiz.explain.params)}</p>}
            {picked && (
                <button type="button" onClick={next} data-testid="quiz-next" className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold">
                    {t(index + 1 >= QUIZ_ROUNDS ? 'trainers.memory.finish' : 'trainers.memory.next')}
                </button>
            )}
        </div>
    );
}

/**
 * Очки раунда: процент найденных шахов и взятий минус 10 за каждую лишнюю отметку (не ниже 0). Стрелки разбора: зелёная — найден,
 * жёлтая — пропущен, красная — лишний; до проверки отмеченное — синее.
 */
export function ChecksGame({seed, onFinish}: GameProps) {
    const {t} = useI18n();
    const games = useClassics();
    const [round, setRound] = useState(0);
    const [marked, setMarked] = useState<string[]>([]);
    const [from, setFrom] = useState<string | null>(null);
    const [review, setReview] = useState<{ found: string[]; missed: string[]; wrong: string[] } | null>(null);
    const [totals, setTotals] = useState({score: 0, mistakes: 0});
    const pool = useMemo(() => (games ? positionPool(games, []) : []), [games]);
    const fen = useMemo(() => (games ? checksPosition(pool, seed * 13 + round * 101) : null), [games, pool, seed, round]);

    if (!games) return <p className="text-sm text-boxwood/70">{t('trainers.memory.loading')}</p>;
    if (!fen) return <p className="text-sm text-rose-300">{t('trainers.memory.noPositions')}</p>;

    const onSquare = (square: string) => {
        if (review) return;
        if (!from) {
            setFrom(square);
            return;
        }
        const uci = `${from}${square}`;
        setFrom(null);
        if (from === square) return;
        setMarked((m) => (m.includes(uci) ? m.filter((x) => x !== uci) : [...m, uci]));
    };
    const done = () => {
        const truth = checksAndCaptures(fen);
        const found = marked.filter((m) => truth.has(m));
        const wrong = marked.filter((m) => !truth.has(m));
        const missed = [...truth].filter((m) => !marked.includes(m));
        const points = Math.max(0, Math.round((found.length / truth.size) * 100) - wrong.length * 10);
        setTotals((s) => ({score: s.score + points, mistakes: s.mistakes + wrong.length + missed.length}));
        setReview({found, missed, wrong});
    };
    const next = () => {
        if (round + 1 >= CHECKS_ROUNDS) {
            onFinish(totals.score, totals.mistakes);
            return;
        }
        setRound((r) => r + 1);
        setMarked([]);
        setReview(null);
    };
    const arrows: BoardArrow[] = review
        ? [...review.found.map((m) => ({from: m.slice(0, 2), to: m.slice(2, 4), color: 'green' as const})),
            ...review.missed.map((m) => ({from: m.slice(0, 2), to: m.slice(2, 4), color: 'yellow' as const})),
            ...review.wrong.map((m) => ({from: m.slice(0, 2), to: m.slice(2, 4), color: 'red' as const}))]
        : marked.map((m) => ({from: m.slice(0, 2), to: m.slice(2, 4), color: 'blue' as const}));

    return (
        <div className="flex flex-col gap-3" data-testid="checks-game">
            <span className="font-bold text-amber-200">{t('trainers.memory.round', {n: round + 1, total: CHECKS_ROUNDS})}</span>
            <p className="text-sm">{t('trainers.calc.checksHint')}</p>
            <div className="w-full max-w-[460px]">
                <PuzzleBoard fen={fen} orientation="white" interactive onMove={() => undefined} onSquare={onSquare} arrows={arrows}
                             highlights={from ? [from] : []} sound={false}/>
            </div>
            {review ? (
                <>
                    <p data-testid="checks-review">{t('trainers.calc.checksReview', {found: review.found.length, missed: review.missed.length, wrong: review.wrong.length})}</p>
                    <button type="button" onClick={next} data-testid="checks-next" className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold">
                        {t(round + 1 >= CHECKS_ROUNDS ? 'trainers.memory.finish' : 'trainers.memory.next')}
                    </button>
                </>
            ) : (
                <button type="button" onClick={done} data-testid="checks-done" className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold">
                    {t('trainers.calc.done', {n: marked.length})}
                </button>
            )}
        </div>
    );
}
