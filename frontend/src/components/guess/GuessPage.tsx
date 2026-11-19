// --- FILE: frontend/src/components/guess/GuessPage.tsx ---
// «Угадай ход мастера» (таск 14.3): позиция из партии мастера, игрок делает ход — баллы, ход мастера, оценка
// движка и объяснение наставника. Режимы: отдельные позиции и серия ходов из одной партии. /guess/:positionId —
// конкретная позиция (переход из просмотра партии). Для начинающих — «выбор из вариантов»: ход мастера и ходы из строк
// движка кнопками (сервер присылает их только в этом режиме). «Партия целиком» (?whole=1, ссылка из просмотра партии и
// архива чемпиона) — все отобранные моменты одной партии по порядку ходов (GET /guess/game/{id}), в конце — счёт за
// партию. После ответа доска свободна: позицию можно разыграть
// (usePositionExplorer).
// Данные — services/guess.ts (/api/v1/guess/*, доступно и гостю; отбор позиций и баллы — сервер, src/services/guess.py).
// Маршруты /guess и /guess/:positionId (App.tsx); переход с позиции приходит из просмотра партии.
// Итог ответа: баллы (100 — совпал с мастером, от 80 — рядом), ход мастера, линии движка (|cp| от 90000 — мат) и
// объяснение наставника; счёт сессии — средний балл (services/guess.ts, understanding).

import {useCallback, useEffect, useState} from 'react';
import {Link, useNavigate, useParams, useSearchParams} from 'react-router-dom';
import {Crown, ArrowRight} from 'lucide-react';
import {hasMessage, renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {coachText} from '../../services/coach';
import {guessApi, understanding} from '../../services/guess';
import type {GuessAnswer, GuessPosition} from '../../services/guess';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import type {BoardArrow} from '../puzzles/PuzzleBoard';
import {ExplorerControls, usePositionExplorer} from '../puzzles/usePositionExplorer';

/** single — отдельные позиции; series — серия ходов одной партии. */
type Mode = 'single' | 'series';

/** Предыдущие ходы партии с номерами («12… Nf6» для хода чёрных в начале списка) по номеру полухода первого. */
function movesText(position: GuessPosition): string {
    return position.previous.map((san, i) => {
        const ply = position.first_previous_ply + i;
        if (ply % 2 === 0) return `${ply / 2 + 1}. ${san}`;
        return i === 0 ? `${(ply + 1) / 2}… ${san}` : san;
    }).join(' ');
}

function evalText(cp: number): string {
    if (Math.abs(cp) >= 90000) return cp > 0 ? '#' : '-#';
    return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
}

export function GuessPage() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const {positionId} = useParams<{ positionId?: string }>();
    // Партия целиком: моменты партии по порядку (id позиций), баллы за эту партию и её конец.
    const [search] = useSearchParams();
    const whole = search.get('whole') === '1';
    const [plan, setPlan] = useState<{ gameId: number; ids: number[] } | null>(null);
    const [gameScores, setGameScores] = useState<number[]>([]);
    const [gameDone, setGameDone] = useState(false);
    const [mode, setMode] = useState<Mode>('single');
    // Выбор из вариантов (режим для начинающих): позиции запрашиваются с кандидатами.
    const [choices, setChoices] = useState(false);
    const [position, setPosition] = useState<GuessPosition | null>(null);
    const [empty, setEmpty] = useState(false);
    const [answer, setAnswer] = useState<GuessAnswer | null>(null);
    const [played, setPlayed] = useState<string | null>(null);
    const [scores, setScores] = useState<number[]>([]);
    const [error, setError] = useState<UiMessage | null>(null);
    const explorer = usePositionExplorer();
    const stopExplorer = explorer.stop;

    const show = useCallback((next: GuessPosition | null) => {
        setPosition(next);
        setEmpty(next === null);
        setAnswer(null);
        setPlayed(null);
        setError(null);
        stopExplorer();
    }, [stopExplorer]);

    const loadNext = useCallback((which: Mode, withChoices: boolean) => {
        guessApi.next(which === 'series', withChoices).then((r) => show(r.position))
            .catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [show]);

    useEffect(() => {
        if (positionId) {
            guessApi.position(Number(positionId), choices).then(show).catch((err) => setError(errorMessage(err, 'common.networkError')));
        } else {
            loadNext(mode, choices);
        }
    }, [positionId, choices]); // eslint-disable-line react-hooks/exhaustive-deps

    // Партия целиком: план — отобранные моменты партии текущей позиции; новая партия — новый счёт.
    useEffect(() => {
        if (!whole || !position || plan?.gameId === position.game_id) return;
        const gameId = position.game_id;
        guessApi.ofGame(gameId).then((r) => {
            setPlan({gameId, ids: r.positions.map((p) => p.id)});
            setGameScores([]);
            setGameDone(false);
        }).catch(() => undefined);
    }, [whole, position, plan?.gameId]);

    const submit = async (uci: string) => {
        if (!position) return;
        // Ответ уже дан — доска свободна: ход игрока начинает разбор с позиции (стрелки мастера и своего хода видны
        // до первого хода разбора).
        if (answer) {
            if (explorer.active) explorer.play(uci);
            else explorer.start(position.fen, [uci]);
            return;
        }
        setPlayed(uci);
        try {
            const result = await guessApi.answer(position.id, uci);
            setAnswer(result);
            setScores((list) => [...list, result.score]);
            if (whole) setGameScores((list) => [...list, result.score]);
        } catch (err) {
            setPlayed(null);
            setError(errorMessage(err, 'common.networkError'));
        }
    };

    const goNext = () => {
        // Партия целиком: следующий момент этой партии, после последнего — итог партии.
        if (whole && plan && position) {
            const nextId = plan.ids[plan.ids.indexOf(position.id) + 1];
            if (nextId !== undefined) navigate(`/guess/${nextId}?whole=1`);
            else setGameDone(true);
            return;
        }
        if (answer?.next_id) {
            if (positionId) navigate(`/guess/${answer.next_id}`);
            else guessApi.position(answer.next_id, choices).then(show).catch((err) => setError(errorMessage(err, 'common.networkError')));
            return;
        }
        if (positionId) navigate('/guess');
        loadNext(mode, choices);
    };

    const switchMode = (next: Mode) => {
        setMode(next);
        if (positionId) navigate('/guess');
        loadNext(next, choices);
    };

    const arrows: BoardArrow[] = [];
    if (answer) {
        arrows.push({from: answer.master_move.slice(0, 2), to: answer.master_move.slice(2, 4), color: 'green'});
        if (played && played !== answer.master_move) arrows.push({from: played.slice(0, 2), to: played.slice(2, 4), color: 'red'});
    }
    const percent = understanding(scores);
    const verdict = answer && (answer.score === 100 ? 'guess.perfect' : answer.score >= 80 ? 'guess.near' : 'guess.miss');

    return (
        <div className="w-full max-w-5xl flex flex-col gap-4 text-boxwood-light" data-testid="guess-page">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-amber-200 flex items-center gap-2"><Crown size={22}/> {t('guess.title')}</h1>
                    <p className="text-sm text-boxwood/75">{t('guess.subtitle')}</p>
                </div>
                <div className="flex gap-1.5" role="tablist">
                    {(['single', 'series'] as const).map((m) => (
                        <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
                                className={`px-3 py-1.5 rounded text-sm border ${mode === m ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`}>
                            {t(m === 'single' ? 'guess.modeSingle' : 'guess.modeSeries')}
                        </button>
                    ))}
                </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-boxwood/80 self-start cursor-pointer">
                <input type="checkbox" checked={choices} onChange={(e) => setChoices(e.target.checked)} className="accent-amber-600"
                       data-testid="guess-choices-toggle"/>
                {t('guess.choicesMode')}
            </label>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {empty && <p className="text-sm text-amber-200" data-testid="guess-empty">{t('guess.empty')}</p>}

            {position && (
                <div className="flex flex-col md:flex-row gap-5 items-start">
                    <div className="w-full max-w-[520px]">
                        <PuzzleBoard fen={explorer.fen ?? position.fen} orientation={position.side} interactive onMove={(uci) => void submit(uci)}
                                     lastMove={explorer.active ? explorer.lastMove
                                         : position.last_move ? {from: position.last_move.slice(0, 2), to: position.last_move.slice(2, 4)} : null}
                                     arrows={explorer.active ? [] : arrows}/>
                        <ExplorerControls explorer={explorer}/>
                    </div>
                    <div className="flex-1 flex flex-col gap-3 min-w-0">
                        <div className="bg-black/30 rounded p-3 text-sm flex flex-col gap-1">
                            <div className="font-bold text-amber-200" data-testid="guess-players">
                                {position.white} — {position.black}{position.event ? `, ${position.event}` : ''}{position.date ? ` ${position.date}` : ''}
                            </div>
                            {position.previous.length > 0 && <div className="font-mono text-xs text-boxwood/80">{movesText(position)}</div>}
                            <div className="text-amber-300">{t(position.side === 'white' ? 'guess.whiteToMove' : 'guess.blackToMove')}</div>
                            {whole && plan && plan.ids.includes(position.id) && (
                                <div className="text-xs text-boxwood/70" data-testid="guess-whole-progress">
                                    {t('guess.wholeProgress', {index: plan.ids.indexOf(position.id) + 1, total: plan.ids.length})}
                                </div>
                            )}
                            {!whole && position.series_id !== null && position.series_length > 1 && (
                                <div className="text-xs text-boxwood/70" data-testid="guess-series">
                                    {t('guess.seriesProgress', {index: position.series_index + 1, total: position.series_length})}
                                </div>
                            )}
                        </div>

                        {choices && !answer && position.candidates && position.candidates.length > 0 && (
                            <div className="flex flex-col gap-1.5" data-testid="guess-choices">
                                <span className="text-xs text-boxwood/70">{t('guess.choicesHint')}</span>
                                <div className="flex flex-wrap gap-2">
                                    {position.candidates.map((c) => (
                                        <button key={c.uci} type="button" onClick={() => void submit(c.uci)} data-testid={`guess-choice-${c.uci}`}
                                                className="px-3 py-1.5 rounded bg-black/40 border border-amber-900/60 font-mono hover:border-amber-500">
                                            {c.san}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {answer && (
                            <div className="bg-black/40 rounded p-3 flex flex-col gap-2" data-testid="guess-answer">
                                <div className="flex items-baseline gap-3">
                                    <span className="text-3xl font-bold text-amber-300" data-testid="guess-score">{answer.score}</span>
                                    {verdict && <span className="text-sm">{t(verdict)}</span>}
                                </div>
                                <div className="text-sm">{t('guess.masterMove', {san: answer.master_san})}</div>
                                {coachText(answer, t) && <p className="text-sm text-boxwood/90">{coachText(answer, t)}</p>}
                                {answer.themes && answer.themes.some((code) => hasMessage(`themes.${code}.name`)) && (
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="guess-themes">
                                        <span className="text-boxwood/70">{t('guess.themes')}:</span>
                                        {answer.themes.map((code) => `themes.${code}.name`).filter(hasMessage).map((key) => (
                                            <span key={key} className="px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-900/60">{t(key)}</span>
                                        ))}
                                    </div>
                                )}
                                <div className="text-xs text-boxwood/70">
                                    {t('guess.engineLines')}: {answer.lines.map((l) => `${l.san} ${evalText(l.cp)}`).join(', ')}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    {!gameDone && (
                                        <button type="button" onClick={goNext} data-testid="guess-next"
                                                className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold hover:bg-amber-600 flex items-center gap-1.5">
                                            {t(whole ? 'guess.nextMoment' : answer.next_id ? 'guess.continueSeries' : 'guess.next')} <ArrowRight size={15}/>
                                        </button>
                                    )}
                                    <Link to={`/game/${position.game_id}`} className="px-3 py-1.5 rounded border border-amber-900/60 text-sm hover:border-amber-600">
                                        {t('guess.toGame')}
                                    </Link>
                                </div>
                            </div>
                        )}

                        {gameDone && (
                            <div className="bg-amber-900/40 border border-amber-600 rounded p-3 text-sm flex flex-col gap-2" data-testid="guess-whole-done">
                                <span className="font-bold text-amber-200">
                                    {t('guess.wholeDone', {points: gameScores.reduce((a, b) => a + b, 0), max: gameScores.length * 100})}
                                </span>
                                <button type="button" onClick={() => navigate('/guess')} className="self-start text-amber-300 underline">
                                    {t('guess.next')}
                                </button>
                            </div>
                        )}

                        {percent !== null && (
                            <div className="text-xs text-boxwood/80" data-testid="guess-session">
                                {t('guess.session', {points: scores.reduce((a, b) => a + b, 0), max: scores.length * 100, percent})}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
