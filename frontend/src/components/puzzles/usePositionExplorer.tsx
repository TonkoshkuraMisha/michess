// --- FILE: frontend/src/components/puzzles/usePositionExplorer.tsx ---
// Свободный разбор после ответа (отзыв владельца 18.11): когда задача или вопрос тренажёра решены, доска не
// застывает со стрелкой — на ней стоит сделанный ход, и позицию можно доиграть за обе стороны, вернуть ход назад или
// вернуться к позиции задачи. Ходы проверяет chess.js (законность — та же, что на доске PuzzleBoard). Хук хранит
// только линию от позиции задачи; оценки и подсказок движка нет — это не анализ, а «подвигать фигуры» (честная игра
// не затрагивается: во время своей партии с человеком тренажёры и так закрыты правилами раздела).
// Только состояние в памяти (без сети и localStorage). Подключают PuzzlesPage, DefenseTrainer, GeneratedDrills,
// GuessPage, learn/MateCourse и trainers/{CalcGames, MiniatureGame, StructureQuiz}.

import {useCallback, useMemo, useState} from 'react';
import {Chess} from 'chess.js';
import {RotateCcw, Undo2} from 'lucide-react';
import {useI18n} from '../../i18n';

/** Линия разбора: позиция задачи и ходы UCI, сыгранные от неё (стартовая позиция не меняется). */
interface Line {
    start: string;
    moves: string[];
}

/** Интерфейс хука: что показывать на доске и как менять линию разбора. */
export interface PositionExplorer {
    /** Разбор включён (после ответа). */
    active: boolean;
    /** Позиция на доске: стартовая + сыгранные ходы. */
    fen: string | null;
    /** Последний ход линии — для подсветки на доске. */
    lastMove: { from: string; to: string } | null;
    /** Сколько ходов сыграно от позиции задачи. */
    plies: number;
    /** Включить разбор с позиции fen, сразу сыграв ходы moves (например, ответ игрока). */
    start: (fen: string, moves?: string[]) => void;
    /** Сыграть ход UCI за сторону, чья очередь; незаконный — false, доска не меняется. */
    play: (uci: string) => boolean;
    /** Вернуть один ход назад. */
    back: () => void;
    /** Вернуться к позиции задачи (линия очищается, разбор остаётся включённым). */
    reset: () => void;
    /** Выключить разбор (новая задача или упражнение). */
    stop: () => void;
}

/** Позиция после ходов линии; незаконные ходы в конце отбрасываются. */
function replay(line: Line): { fen: string; last: { from: string; to: string } | null; plies: number } {
    const game = new Chess(line.start);
    let last: { from: string; to: string } | null = null;
    let plies = 0;
    for (const uci of line.moves) {
        try {
            game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q'});
        } catch {
            break;
        }
        last = {from: uci.slice(0, 2), to: uci.slice(2, 4)};
        plies += 1;
    }
    return {fen: game.fen(), last, plies};
}

/** Хук свободного разбора: хранит только линию ходов, позицию на доске каждый раз пересчитывает replay(). */
export function usePositionExplorer(): PositionExplorer {
    const [line, setLine] = useState<Line | null>(null);
    const view = useMemo(() => (line ? replay(line) : null), [line]);

    const start = useCallback((fen: string, moves: string[] = []) => {
        // Позиция, которую chess.js не принимает (например, одна фигура без королей в «Сколько ходов?»), — разбор не
        // включается: доска остаётся как была.
        try {
            new Chess(fen);
        } catch {
            setLine(null);
            return;
        }
        const played = replay({start: fen, moves});
        setLine({start: fen, moves: moves.slice(0, played.plies)});
    }, []);
    const play = useCallback((uci: string) => {
        if (!line || !view) return false;
        const game = new Chess(view.fen);
        try {
            game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q'});
        } catch {
            return false;
        }
        setLine({...line, moves: [...line.moves.slice(0, view.plies), uci]});
        return true;
    }, [line, view]);
    const back = useCallback(() => setLine((l) => (l ? {...l, moves: l.moves.slice(0, -1)} : l)), []);
    const reset = useCallback(() => setLine((l) => (l ? {...l, moves: []} : l)), []);
    const stop = useCallback(() => setLine(null), []);

    return {
        active: line !== null, fen: view?.fen ?? null, lastMove: view?.last ?? null, plies: view?.plies ?? 0,
        start, play, back, reset, stop,
    };
}

/** Кнопки разбора под доской: ход назад и к позиции задачи; подсказка, что доска свободна. */
export function ExplorerControls({explorer}: { explorer: PositionExplorer }) {
    const {t} = useI18n();
    if (!explorer.active) return null;
    return (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="explorer-controls">
            <span className="text-boxwood/70">{t('puzzles.explore.hint')}</span>
            <button type="button" onClick={explorer.back} disabled={explorer.plies === 0} data-testid="explorer-back"
                    className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1 disabled:opacity-40">
                <Undo2 size={12}/> {t('puzzles.explore.back')}
            </button>
            <button type="button" onClick={explorer.reset} disabled={explorer.plies === 0} data-testid="explorer-reset"
                    className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1 disabled:opacity-40">
                <RotateCcw size={12}/> {t('puzzles.explore.toStart')}
            </button>
        </div>
    );
}
