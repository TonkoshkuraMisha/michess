// --- FILE: frontend/src/components/puzzles/SolutionReplay.tsx ---
// Разбор после ответа в тренажёрах (таск B.3): линии «опровержение», «верный ход», «решение» — пошагово на доске,
// стрелка показывает следующий ход линии; «Разобрать с наставником» — позиция упражнения на свободной доске.

import {useState} from 'react';
import {Chess} from 'chess.js';
import {ChevronLeft, ChevronRight, GraduationCap} from 'lucide-react';
import {useI18n} from '../../i18n';
import type {BoardArrow} from './PuzzleBoard';
import {toMove} from './puzzleNotation';

export interface ReplayLine {
    id: string;
    label: string;
    /** Ходы линии в UCI от стартовой позиции. */
    moves: string[];
    color: NonNullable<BoardArrow['color']>;
}

/** Что показать на доске вместо позиции упражнения. */
export interface ReplayView {
    fen: string;
    lastMove: { from: string; to: string } | null;
    arrows: BoardArrow[];
}

/** Позиция линии после ply ходов; стрелка — следующий ход линии. */
export function replayView(startFen: string, line: ReplayLine, ply: number): ReplayView {
    const game = new Chess(startFen);
    let lastMove: ReplayView['lastMove'] = null;
    for (const uci of line.moves.slice(0, ply)) {
        const move = game.move(toMove(uci));
        lastMove = {from: move.from, to: move.to};
    }
    const next = line.moves[ply];
    return {
        fen: game.fen(),
        lastMove,
        arrows: next ? [{from: next.slice(0, 2), to: next.slice(2, 4), color: line.color}] : [],
    };
}

interface Props {
    startFen: string;
    lines: ReplayLine[];
    /** Показ линии на доске; null — вернуть позицию упражнения. */
    onShow: (view: ReplayView | null) => void;
    /** Позиция упражнения на свободной доске с наставником. */
    onAnalyze?: (fen: string) => void;
}

export function SolutionReplay({startFen, lines, onShow, onAnalyze}: Props) {
    const {t} = useI18n();
    const [selected, setSelected] = useState<{ id: string; ply: number } | null>(null);
    const line = selected ? lines.find((l) => l.id === selected.id) ?? null : null;

    // Показ — из обработчиков, не из эффекта: линии родитель собирает на каждой отрисовке заново, и эффект по ним
    // зацикливал бы отрисовку (onShow меняет состояние родителя).
    const show = (next: { id: string; ply: number } | null) => {
        setSelected(next);
        const nextLine = next ? lines.find((l) => l.id === next.id) : undefined;
        onShow(next && nextLine ? replayView(startFen, nextLine, next.ply) : null);
    };

    if (lines.length === 0 && !onAnalyze) return null;
    const step = (delta: number) => {
        if (!line || !selected) return;
        show({id: line.id, ply: Math.max(0, Math.min(line.moves.length, selected.ply + delta))});
    };

    return (
        <div className="flex flex-col gap-1.5" data-testid="solution-replay">
            {lines.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs">
                    {lines.map((l) => (
                        <button key={l.id} type="button" data-testid={`replay-line-${l.id}`}
                                aria-pressed={selected?.id === l.id}
                                onClick={() => show(selected?.id === l.id ? null : {id: l.id, ply: 0})}
                                className={`px-2 py-1 rounded border font-bold cursor-pointer ${selected?.id === l.id
                                    ? 'bg-amber-800 text-white border-amber-400' : 'bg-black/35 border-amber-900/40 hover:border-amber-500'}`}>
                            {l.label}
                        </button>
                    ))}
                </div>
            )}
            {line && selected && (
                <div className="flex items-center gap-1.5 text-xs">
                    <button type="button" data-testid="replay-back" onClick={() => step(-1)} disabled={selected.ply === 0}
                            aria-label={t('puzzles.review.back')} title={t('puzzles.review.back')}
                            className="p-1 rounded bg-black/40 border border-amber-900/50 disabled:opacity-40 cursor-pointer">
                        <ChevronLeft size={14}/>
                    </button>
                    <span data-testid="replay-step">
                        {t('puzzles.review.step', {step: selected.ply, total: line.moves.length})}
                    </span>
                    <button type="button" data-testid="replay-forward" onClick={() => step(1)}
                            disabled={selected.ply === line.moves.length}
                            aria-label={t('puzzles.review.forward')} title={t('puzzles.review.forward')}
                            className="p-1 rounded bg-black/40 border border-amber-900/50 disabled:opacity-40 cursor-pointer">
                        <ChevronRight size={14}/>
                    </button>
                </div>
            )}
            {onAnalyze && (
                <button type="button" data-testid="replay-analyze" onClick={() => onAnalyze(startFen)}
                        className="self-start flex items-center gap-1 px-2 py-1 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 text-xs font-bold cursor-pointer">
                    <GraduationCap size={13}/> {t('puzzles.analyze')}
                </button>
            )}
        </div>
    );
}
