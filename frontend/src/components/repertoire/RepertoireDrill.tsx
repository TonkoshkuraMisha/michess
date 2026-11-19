// Повторение репертуара (таск 20.2): /repertoire/:id/drill (маршрут в App.tsx).
// «Повторение» — карточки по расписанию (SM-2) и новые в пределах дневной нормы; «Учить новые» — сначала показ
// своих ходов, затем проверка; ошибка возвращает карточку в конец сессии (повтор расписание не меняет).
// «Игра против репертуара» — соперник отвечает ходами из репертуара (чаще — популярными у людей), игрок должен
// оставаться в своих линиях. Данные — services/repertoire.ts: GET /repertoires/{id}/drill, POST .../drill/answer,
// POST .../opponent (src/services/repertoire_drill.py); дерево для игры против репертуара берётся из загруженного
// Repertoire (followLine/edgesFrom).

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {ArrowLeft, RotateCcw} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {edgesFrom, followLine, repertoireApi} from '../../services/repertoire';
import type {DrillCard, DrillStats, Repertoire} from '../../services/repertoire';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import type {BoardArrow} from '../puzzles/PuzzleBoard';
import {numberedMoves} from '../../services/moveNumbers';

// Режим страницы; фаза карточки (show — показ ответа в «Учить новые», ask — ждём ход, right/wrong — разбор);
// карточка в очереди сессии с признаком повтора после ошибки (retry — на расписание не влияет).
type Mode = 'review' | 'learn' | 'play';
type Phase = 'show' | 'ask' | 'right' | 'wrong';
type QueuedCard = DrillCard & { retry: boolean };

// Стили вкладки режима и общей кнопки страницы (вынесены, чтобы не повторять длинные строки классов).
const TAB = (active: boolean) =>
    `px-3 py-1.5 rounded text-sm border ${active ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`;
const BUTTON = 'px-3 py-1.5 rounded bg-amber-700 text-white font-bold text-sm disabled:opacity-50';

/** Проигрывает линию UCI из начальной позиции: FEN, ходы в SAN и последний ход для подсветки. */
function replay(line: string[]): { fen: string; sans: string[]; last: { from: string; to: string } | null } {
    const game = new Chess();
    const sans: string[] = [];
    let last: { from: string; to: string } | null = null;
    for (const uci of line) {
        const move = game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
        sans.push(move.san);
        last = {from: move.from, to: move.to};
    }
    return {fen: game.fen(), sans, last};
}

/** Стрелки доски для списка ходов UCI одного цвета (верные ответы — зелёные, ошибка — красная). */
const arrowsOf = (ucis: string[], color: BoardArrow['color']): BoardArrow[] =>
    ucis.map((uci) => ({from: uci.slice(0, 2), to: uci.slice(2, 4), color}));

/** Строка сводки по репертуару: выучено / учится / новых / к повторению / осталось новых на сегодня. */
function StatsLine({stats}: { stats: DrillStats }) {
    const {t} = useI18n();
    return (
        <p className="text-sm text-boxwood/85" data-testid="drill-stats">
            {t('repertoire.drill.stats', {learned: stats.learned, learning: stats.learning, fresh: stats.new, due: stats.due, left: stats.new_left})}
        </p>
    );
}

/**
 * Сессия карточек («Повторение» и «Учить новые»): очередь с сервера, ответ проверяется на сервере (answer).
 * Верный ответ в первый раз учитывается в итоге; ошибка ставит копию карточки (retry) в конец очереди.
 */
function CardsSession({rep, mode}: { rep: Repertoire; mode: 'review' | 'learn' }) {
    const {t} = useI18n();
    const [queue, setQueue] = useState<QueuedCard[] | null>(null);
    const [stats, setStats] = useState<DrillStats | null>(null);
    const [phase, setPhase] = useState<Phase>('ask');
    const [tally, setTally] = useState({right: 0, wrong: 0});
    const [error, setError] = useState<UiMessage | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        setQueue(null);
        setTally({right: 0, wrong: 0});
        setError(null);
        repertoireApi.drill(rep.id, mode).then((r) => {
            setStats(r.stats);
            setQueue(r.cards.map((c) => ({...c, retry: false})));
            setPhase(mode === 'learn' ? 'show' : 'ask');
        }).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [rep.id, mode]);
    useEffect(load, [load]);

    if (error) return <p role="alert" className="text-rose-300">{renderUiMessage(error, t)}</p>;
    if (!queue) return <p className="text-boxwood/70">{t('repertoire.loading')}</p>;
    const card = queue[0];
    if (!card) {
        return (
            <div className="flex flex-col gap-2" data-testid="drill-done">
                {stats && <StatsLine stats={stats}/>}
                <p className="font-bold text-amber-200">
                    {tally.right + tally.wrong === 0 ? t(mode === 'learn' ? 'repertoire.drill.noNew' : 'repertoire.drill.nothingDue')
                        : t('repertoire.drill.sessionDone', {right: tally.right, wrong: tally.wrong})}
                </p>
                <button type="button" onClick={load} className={`${BUTTON} self-start`}>{t('repertoire.drill.again')}</button>
            </div>
        );
    }

    const before = replay(card.line);
    const answerUcis = card.answers.map((a) => a.uci);
    const next = () => {
        setQueue((q) => q && q.slice(1));
        setPhase(mode === 'learn' && !queue[1]?.retry ? 'show' : 'ask');
    };
    const onMove = async (uci: string) => {
        if (phase !== 'ask' || busy) return;
        setBusy(true);
        try {
            const result = await repertoireApi.answer(rep.id, card.position, uci, card.retry);
            setStats(result.stats);
            if (result.correct) {
                setPhase('right');
                if (!card.retry) setTally((x) => ({...x, right: x.right + 1}));
            } else {
                setPhase('wrong');
                if (!card.retry) setTally((x) => ({...x, wrong: x.wrong + 1}));
                setQueue((q) => q && [...q, {...card, retry: true}]);
            }
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    };
    const reveal = phase === 'show' || phase === 'wrong' || phase === 'right';

    return (
        <div className="flex flex-col lg:flex-row gap-5 items-start" data-testid="drill-card">
            <div className="w-full max-w-[520px] flex flex-col gap-2">
                <PuzzleBoard fen={card.fen} orientation={rep.color} interactive={phase === 'ask'} onMove={(uci) => void onMove(uci)}
                             lastMove={before.last} arrows={reveal ? arrowsOf(answerUcis, phase === 'wrong' ? 'red' : 'green') : []}/>
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-2 text-sm">
                {stats && <StatsLine stats={stats}/>}
                <p className="font-mono text-xs text-boxwood/80" data-testid="drill-line">
                    {card.line.length ? numberedMoves(before.sans).join(' ') : t('repertoire.startPosition')}
                </p>
                <p className="font-bold text-amber-200" data-testid="drill-prompt">
                    {phase === 'show' && t('repertoire.drill.showPrompt')}
                    {phase === 'ask' && t(card.retry ? 'repertoire.drill.retryPrompt' : 'repertoire.drill.askPrompt')}
                    {phase === 'right' && t('repertoire.drill.right')}
                    {phase === 'wrong' && t('repertoire.drill.wrong', {moves: card.answers.map((a) => a.san).join(', ')})}
                </p>
                {reveal && card.answers.some((a) => a.comment) && (
                    <ul className="text-xs text-boxwood/85 flex flex-col gap-1">
                        {card.answers.filter((a) => a.comment).map((a) => <li key={a.uci}><b className="font-mono">{a.san}</b> — {a.comment}</li>)}
                    </ul>
                )}
                {phase === 'show' && (
                    <button type="button" onClick={() => setPhase('ask')} className={`${BUTTON} self-start`} data-testid="drill-check">
                        {t('repertoire.drill.checkMe')}
                    </button>
                )}
                {(phase === 'right' || phase === 'wrong') && (
                    <button type="button" onClick={next} className={`${BUTTON} self-start`} data-testid="drill-next">{t('repertoire.drill.next')}</button>
                )}
                <p className="text-xs text-boxwood/60">{t('repertoire.drill.left', {n: queue.length})}</p>
            </div>
        </div>
    );
}

/**
 * «Игра против репертуара»: игрок ходит только по своим ребрам дерева, ответы соперника запрашивает у сервера.
 * Уход из репертуара подсвечивает верные ходы; когда у игрока в позиции нет своих ходов — линия закончена.
 */
function PlaySession({rep}: { rep: Repertoire }) {
    const {t} = useI18n();
    const [line, setLine] = useState<string[]>([]);
    const [state, setState] = useState<'play' | 'left' | 'end' | 'done'>('play');
    const [wrongMove, setWrongMove] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);
    const myTurnWhite = rep.color === 'white';

    const position = useMemo(() => replay(line), [line]);
    const follow = followLine(rep, line);
    const inTree = follow.known === line.length;
    const mine = inTree ? edgesFrom(rep, follow.position).filter((e) => e.mine) : [];
    const whiteToMove = line.length % 2 === 0;
    const myTurn = whiteToMove === myTurnWhite;

    const askOpponent = useCallback(async (moves: string[]) => {
        setBusy(true);
        setError(null);
        try {
            const r = await repertoireApi.opponent(rep.id, moves);
            if (r.reply) setLine([...moves, r.reply]);
            else setState('done');
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    }, [rep.id]);

    const restart = useCallback(() => {
        setLine([]);
        setState('play');
        setWrongMove(null);
        if (!myTurnWhite) void askOpponent([]);
    }, [askOpponent, myTurnWhite]);
    useEffect(restart, [restart]);

    useEffect(() => {
        if (state === 'play' && myTurn && !busy && mine.length === 0 && line.length > 0) setState('end');
    }, [state, myTurn, busy, mine.length, line.length]);

    const onMove = (uci: string) => {
        if (state !== 'play' || !myTurn || busy) return;
        if (!mine.some((e) => e.uci === uci)) {
            setWrongMove(uci);
            setState('left');
            return;
        }
        const moves = [...line, uci];
        setLine(moves);
        void askOpponent(moves);
    };

    const status = state === 'left' ? t('repertoire.drill.leftRepertoire', {moves: mine.map((e) => e.san).join(', ')})
        : state === 'end' ? t('repertoire.drill.lineEnd')
            : state === 'done' ? t('repertoire.drill.lineDone')
                : busy ? t('repertoire.drill.opponentThinking') : t('repertoire.drill.yourMove');

    return (
        <div className="flex flex-col lg:flex-row gap-5 items-start" data-testid="drill-play">
            <div className="w-full max-w-[520px] flex flex-col gap-2">
                <PuzzleBoard fen={position.fen} orientation={rep.color} interactive={state === 'play' && myTurn && !busy} onMove={onMove}
                             lastMove={position.last}
                             arrows={state === 'left' ? [...arrowsOf(mine.map((e) => e.uci), 'green'), ...arrowsOf(wrongMove ? [wrongMove] : [], 'red')] : []}/>
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-2 text-sm">
                <p className="font-bold text-amber-200" data-testid="drill-play-status">{status}</p>
                {line.length > 0 && <p className="font-mono text-xs text-boxwood/80" data-testid="drill-play-line">{numberedMoves(position.sans).join(' ')}</p>}
                {error && <p role="alert" className="text-rose-300">{renderUiMessage(error, t)}</p>}
                <div className="flex flex-wrap gap-2">
                    {state === 'left' && (
                        <button type="button" onClick={() => {
                            setState('play');
                            setWrongMove(null);
                        }} className={BUTTON} data-testid="drill-play-retry">{t('repertoire.drill.tryAgain')}</button>
                    )}
                    <button type="button" onClick={restart} className="px-3 py-1.5 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1"
                            data-testid="drill-play-restart">
                        <RotateCcw size={14}/> {t('repertoire.drill.restart')}
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Страница повторения: загружает репертуар и переключает три режима; вкладка режима сбрасывает сессию (key). */
export function RepertoireDrillPage() {
    const {t} = useI18n();
    const {repertoireId = ''} = useParams<{ repertoireId: string }>();
    const id = Number(repertoireId);
    const [rep, setRep] = useState<Repertoire | null>(null);
    const [mode, setMode] = useState<Mode>('review');
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        repertoireApi.get(id).then(setRep).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [id]);

    if (error) return <p role="alert" className="p-4 text-rose-300">{renderUiMessage(error, t)}</p>;
    if (!rep) return <p className="p-4 text-boxwood/70">{t('repertoire.loading')}</p>;
    const title = rep.name || (rep.starter ? t(`repertoire.starters.${rep.starter}.name`) : t('repertoire.untitled'));

    return (
        <div className="w-full max-w-6xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="repertoire-drill">
            <Link to={`/repertoire/${rep.id}`} className="text-sm text-amber-400 hover:underline flex items-center gap-1">
                <ArrowLeft size={14}/> {title}
            </Link>
            <h1 className="text-2xl font-bold text-amber-200">{t('repertoire.drill.title')}</h1>
            <div className="flex flex-wrap gap-1.5" role="tablist">
                {(['review', 'learn', 'play'] as const).map((m) => (
                    <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                            data-testid={`drill-tab-${m}`} className={TAB(mode === m)}>
                        {t(`repertoire.drill.modes.${m}`)}
                    </button>
                ))}
            </div>
            <p className="text-sm text-boxwood/75">{t(`repertoire.drill.hints.${mode}`)}</p>
            {mode === 'play' ? <PlaySession rep={rep}/> : <CardsSession key={mode} rep={rep} mode={mode}/>}
        </div>
    );
}
