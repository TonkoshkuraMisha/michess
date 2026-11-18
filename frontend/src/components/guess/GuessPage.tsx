// --- FILE: frontend/src/components/guess/GuessPage.tsx ---
// «Угадай ход мастера» (таск 14.3): позиция из партии мастера, игрок делает ход — баллы, ход мастера, оценка
// движка и объяснение наставника. Режимы: отдельные позиции и серия ходов из одной партии. /guess/:positionId —
// конкретная позиция (переход из просмотра партии). После ответа доска свободна: позицию можно разыграть
// (usePositionExplorer).

import {useCallback, useEffect, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
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

type Mode = 'single' | 'series';

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
    const [mode, setMode] = useState<Mode>('single');
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

    const loadNext = useCallback((which: Mode) => {
        guessApi.next(which === 'series').then((r) => show(r.position)).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [show]);

    useEffect(() => {
        if (positionId) {
            guessApi.position(Number(positionId)).then(show).catch((err) => setError(errorMessage(err, 'common.networkError')));
        } else {
            loadNext(mode);
        }
    }, [positionId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        } catch (err) {
            setPlayed(null);
            setError(errorMessage(err, 'common.networkError'));
        }
    };

    const goNext = () => {
        if (answer?.next_id) {
            if (positionId) navigate(`/guess/${answer.next_id}`);
            else guessApi.position(answer.next_id).then(show).catch((err) => setError(errorMessage(err, 'common.networkError')));
            return;
        }
        if (positionId) navigate('/guess');
        loadNext(mode);
    };

    const switchMode = (next: Mode) => {
        setMode(next);
        if (positionId) navigate('/guess');
        loadNext(next);
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
                            {position.series_id !== null && position.series_length > 1 && (
                                <div className="text-xs text-boxwood/70" data-testid="guess-series">
                                    {t('guess.seriesProgress', {index: position.series_index + 1, total: position.series_length})}
                                </div>
                            )}
                        </div>

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
                                    <button type="button" onClick={goNext}
                                            className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold hover:bg-amber-600 flex items-center gap-1.5">
                                        {t(answer.next_id ? 'guess.continueSeries' : 'guess.next')} <ArrowRight size={15}/>
                                    </button>
                                    <Link to={`/game/${position.game_id}`} className="px-3 py-1.5 rounded border border-amber-900/60 text-sm hover:border-amber-600">
                                        {t('guess.toGame')}
                                    </Link>
                                </div>
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
