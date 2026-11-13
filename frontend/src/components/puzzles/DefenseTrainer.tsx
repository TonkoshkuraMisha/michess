// --- FILE: frontend/src/components/puzzles/DefenseTrainer.tsx ---
// Защитные упражнения (таск 13.6), раздел I каталога тем:
// * «Что грозит?» — сначала показать угрозу соперника (его фигуру, которая бьёт, или поле удара), затем защититься;
// * «Не зевни» — из трёх естественных ходов выбрать единственный, который не проигрывает;
// * «Единственная защита» — задачи базы с тегом защиты: их ведёт тренировка по приёмам (onDefensiveMove).
// Угроза и верные ходы приходят с сервера только после ответа.

import {useCallback, useState} from 'react';
import type {ReactNode} from 'react';
import {Chess} from 'chess.js';
import {ArrowRight, Eye, ShieldAlert, ShieldCheck} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {UiError} from '../../services/apiErrors';
import {puzzlesApi} from '../../services/puzzles';
import type {DefenseAnswer, DefenseDrillView, DefenseKind, DefenseThreatResponse} from '../../services/puzzles';
import {themeText} from '../../services/themes';
import {PuzzleBoard} from './PuzzleBoard';
import {sanMoves, toMove} from './puzzleNotation';

type Phase = 'idle' | 'loading' | 'threat' | 'move' | 'waiting' | 'done';

interface Props {
    /** Шапка страницы задач (заголовок, профиль, переключатель режимов). */
    header: ReactNode;
    initialKind?: DefenseKind;
    /** «Единственная защита» — тренировка по приёмам с темой defensive_move. */
    onDefensiveMove: () => void;
}

function errorOf(err: unknown): UiMessage {
    return err instanceof UiError ? err.ui : {key: 'common.networkError'};
}

export function DefenseTrainer({header, initialKind = 'threat', onDefensiveMove}: Props) {
    const {t} = useI18n();
    const [kind, setKind] = useState<DefenseKind>(initialKind);
    const [drill, setDrill] = useState<DefenseDrillView | null>(null);
    const [fen, setFen] = useState(new Chess().fen());
    const [phase, setPhase] = useState<Phase>('idle');
    const [threat, setThreat] = useState<DefenseThreatResponse | null>(null);
    const [answer, setAnswer] = useState<DefenseAnswer | null>(null);
    const [played, setPlayed] = useState<{ from: string; to: string } | null>(null);
    const [mark, setMark] = useState<{ square: string; ok: boolean } | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);

    const load = useCallback(async (nextKind: DefenseKind) => {
        setError(null);
        setPhase('loading');
        try {
            const view = await puzzlesApi.defenseNext(nextKind);
            setDrill(view);
            setFen(view.fen);
            setThreat(null);
            setAnswer(null);
            setPlayed(null);
            setMark(null);
            setPhase(view.kind === 'threat' ? 'threat' : 'move');
        } catch (err) {
            setError(errorOf(err));
            setPhase('idle');
        }
    }, []);

    const chooseKind = (next: DefenseKind) => {
        setKind(next);
        void load(next);
    };

    const pickThreat = async (square: string) => {
        if (!drill || phase !== 'threat') return;
        setPhase('waiting');
        try {
            const body = await puzzlesApi.defenseThreat(drill.id, square);
            setThreat(body);
            setMark({square, ok: body.correct});
            setPhase('move');
        } catch (err) {
            setError(errorOf(err));
            setPhase('threat');
        }
    };

    const play = async (uci: string) => {
        if (!drill || phase !== 'move') return;
        const game = new Chess(drill.fen);
        const move = game.move(toMove(uci));
        setFen(game.fen());
        setPlayed({from: move.from, to: move.to});
        setPhase('waiting');
        try {
            const body = await puzzlesApi.defenseAnswer(drill.id, uci);
            setAnswer(body);
            setMark({square: uci.slice(2, 4), ok: body.correct});
            setPhase('done');
        } catch (err) {
            setFen(drill.fen);
            setPlayed(null);
            setError(errorOf(err));
            setPhase('move');
        }
    };

    const threatSan = drill && threat ? sanMoves(nullMoveFen(drill.fen), [threat.threat])[0] : '';
    const threatSquares = threat ? {from: threat.threat.slice(0, 2), to: threat.threat.slice(2, 4)} : null;
    const motifs = (answer?.motifs ?? threat?.motifs ?? []).filter((code) => code !== 'defensive_move');
    const training = answer?.training ?? null;
    const goodSan = drill && answer ? answer.good.map((uci) => sanMoves(drill.fen, [uci])[0]).join(', ') : '';

    return (
        <div className="w-full max-w-6xl mx-auto p-3 sm:p-4 flex flex-col lg:flex-row gap-4" data-testid="defense-trainer">
            <div className="w-full lg:w-[min(70vh,640px)] shrink-0 flex flex-col gap-2">
                <PuzzleBoard fen={fen} orientation={drill?.color ?? 'white'}
                             interactive={phase === 'threat' || (phase === 'move' && drill?.kind === 'threat')}
                             lastMove={played} hint={threatSquares} mark={mark}
                             onMove={(uci) => void play(uci)}
                             onSquare={phase === 'threat' ? (square) => void pickThreat(square) : undefined}/>
                <div className="text-sm font-bold text-amber-300" role="status" data-testid="defense-status">
                    {phase === 'threat' && t('puzzles.defense.findThreat')}
                    {phase === 'move' && drill?.kind === 'threat' && t('puzzles.defense.defendNow')}
                    {phase === 'move' && drill?.kind === 'blunder' && t('puzzles.defense.chooseMove')}
                    {phase === 'done' && answer && (
                        <span className={answer.correct ? 'text-emerald-400' : 'text-rose-400'} data-testid="defense-outcome">
                            {t(answer.correct ? 'puzzles.defense.right' : 'puzzles.defense.wrong')}
                        </span>
                    )}
                </div>
            </div>

            <aside className="flex-1 min-w-0 flex flex-col gap-3 text-sm text-boxwood-light">
                <section className="bg-acacia-dark p-3 rounded-md border border-amber-700/40 flex flex-col gap-2">
                    {header}
                    <p className="text-boxwood/80">{t('puzzles.defense.intro')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs" role="tablist">
                        {(['threat', 'blunder'] as const).map((k) => (
                            <button key={k} type="button" role="tab" aria-selected={kind === k}
                                    data-testid={`defense-kind-${k}`} title={t(`puzzles.defense.kindHints.${k}`)}
                                    onClick={() => chooseKind(k)}
                                    className={`py-1.5 px-2 rounded border font-bold cursor-pointer flex items-center justify-center gap-1 ${kind === k
                                        ? 'bg-amber-800 text-white border-amber-400' : 'bg-black/35 border-amber-900/40'}`}>
                                {k === 'threat' ? <Eye size={13}/> : <ShieldAlert size={13}/>}
                                {t(`puzzles.defense.kinds.${k}`)}
                            </button>
                        ))}
                        <button type="button" data-testid="defense-kind-defensive" onClick={onDefensiveMove}
                                title={t('puzzles.defense.kindHints.defensive')}
                                className="py-1.5 px-2 rounded border font-bold cursor-pointer flex items-center justify-center gap-1 bg-black/35 border-amber-900/40">
                            <ShieldCheck size={13}/> {t('puzzles.defense.kinds.defensive')}
                        </button>
                    </div>
                    <p className="text-xs text-boxwood/70">{t(`puzzles.defense.kindHints.${kind}`)}</p>

                    {drill?.kind === 'blunder' && (phase === 'move' || phase === 'waiting' || phase === 'done') && (
                        <div className="flex flex-col gap-1.5" data-testid="defense-choices">
                            {drill.choices.map((uci) => {
                                const isGood = answer?.good.includes(uci);
                                const chosen = played && uci.startsWith(`${played.from}${played.to}`);
                                return (
                                    <button key={uci} type="button" data-testid={`defense-choice-${uci}`}
                                            disabled={phase !== 'move'} onClick={() => void play(uci)}
                                            className={`py-2 rounded border font-bold text-base cursor-pointer disabled:cursor-default ${
                                                answer
                                                    ? isGood ? 'bg-emerald-900/70 border-emerald-400' : chosen ? 'bg-rose-900/70 border-rose-400' : 'bg-black/30 border-amber-900/40 opacity-70'
                                                    : 'bg-black/40 border-amber-900/50 hover:border-amber-400'}`}>
                                        {sanMoves(drill.fen, [uci])[0]}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {threat && (
                        <p className={threat.correct ? 'text-emerald-300' : 'text-rose-300'} data-testid="defense-threat-result">
                            {t(threat.correct ? 'puzzles.defense.threatRight' : 'puzzles.defense.threatWrong', {move: threatSan})}
                        </p>
                    )}
                    {answer && !answer.correct && goodSan && (
                        <p className="text-emerald-200" data-testid="defense-good">{t('puzzles.defense.goodMoves', {moves: goodSan})}</p>
                    )}
                    {answer && drill && Object.entries(answer.refutations).map(([move, reply]) => {
                        const [moveSan, replySan] = sanMoves(drill.fen, [move, reply]);
                        return (
                            <p key={move} className="text-xs text-boxwood/80" data-testid={`defense-refutation-${move}`}>
                                {t('puzzles.defense.refutation', {move: moveSan, reply: replySan})}
                            </p>
                        );
                    })}
                    {(threat || answer) && motifs.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1" data-testid="defense-motifs">
                            <span className="text-xs">{t('puzzles.defense.motifs')}</span>
                            {motifs.map((code) => (
                                <span key={code} title={themeText(code, 'short', t)}
                                      className="px-1.5 py-0.5 rounded bg-black/40 border border-amber-900/50 text-xs">
                                    {themeText(code, 'name', t)}
                                </span>
                            ))}
                        </div>
                    )}
                    {training && (
                        <p className="text-amber-200" data-testid="defense-progress">
                            {training.mastered && training.advanced
                                ? t('puzzles.training.justMastered')
                                : training.advanced
                                    ? t('puzzles.training.advanced', {stage: training.stage})
                                    : t('puzzles.training.progress', {
                                        stage: training.stage,
                                        clean: training.recent.split('').filter((c) => c === '1').length,
                                        window: training.window, pass: training.pass,
                                    })}
                        </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => void load(kind)} data-testid="defense-next"
                                disabled={phase === 'loading' || phase === 'waiting'}
                                className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold disabled:opacity-40 cursor-pointer">
                            <ArrowRight size={15}/> {t(drill ? 'puzzles.defense.next' : 'puzzles.defense.start')}
                        </button>
                    </div>
                    {drill && (
                        <p className="text-xs text-boxwood/70" data-testid="defense-info">
                            {themeText(drill.theme, 'name', t)} · {t('puzzles.training.stageBadge', {stage: drill.stage})}
                            {' · '}{t('puzzles.puzzleRating', {rating: drill.rating})}
                        </p>
                    )}
                    {error && <p className="text-rose-300" role="alert">{renderUiMessage(error, t)}</p>}
                </section>
            </aside>
        </div>
    );
}

/** Позиция с очередью хода соперника — чтобы записать его угрозу нотацией. */
function nullMoveFen(fen: string): string {
    const parts = fen.split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';
    return parts.join(' ');
}
