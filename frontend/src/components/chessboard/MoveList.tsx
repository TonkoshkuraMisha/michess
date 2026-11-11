// --- FILE: frontend/src/components/chessboard/MoveList.tsx ---

import type {RefObject} from 'react';

export interface MovePair {
    moveNumber: number;
    whiteSan: string;
    whiteIdx: number;
    blackSan?: string;
    blackIdx?: number;
}

export interface MoveListProps {
    movePairs: MovePair[];
    activeMoveIndex: number;
    /** -1 — живая позиция (хвост партии); иначе — просмотр конкретного полухода истории. */
    viewIndex: number;
    historyLength: number;
    /** Партия с соперником (PvP/бот) идёт — иначе это свободный анализ/песочница. */
    hasActiveSession: boolean;
    scrollRef: RefObject<HTMLDivElement | null>;
    onSelectMove: (idx: number) => void;
    onReturnToLive: () => void;
}

/** Журнал ходов в парах бел/чёрн с подсветкой текущего просматриваемого полухода. */
export function MoveList({
    movePairs, activeMoveIndex, viewIndex, historyLength, hasActiveSession, scrollRef,
    onSelectMove, onReturnToLive,
}: MoveListProps) {
    return (
        <div
            className="flex-1 min-h-0 flex flex-col bg-[#1A120B]/90 rounded-md border border-amber-900/50 overflow-hidden shadow-inner">
            <div
                className="grid grid-cols-[44px_1fr_1fr] px-3 py-1.5 bg-black/55 border-b border-amber-900/40 text-xs uppercase tracking-wider text-boxwood/65 font-bold shrink-0">
                <span>№</span>
                <span>Белые</span>
                <span>Чёрные</span>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 min-h-0 overflow-y-auto divide-y divide-amber-900/15 font-mono text-sm [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-amber-900/50"
            >
                {movePairs.length === 0 ? (
                    <div
                        className="h-full flex flex-col items-center justify-center p-6 text-center text-boxwood/50 font-sans text-sm gap-1.5">
                        <span className="font-semibold">Ходов пока нет</span>
                        <span className="text-xs text-boxwood/40">
                            {hasActiveSession
                                ? 'Сделайте первый ход на доске.'
                                : 'Двигайте фигуры для анализа или выберите соперника слева.'}
                        </span>
                    </div>
                ) : (
                    movePairs.map((pair) => {
                        const isWhiteActive = activeMoveIndex === pair.whiteIdx;
                        const isBlackActive = pair.blackIdx !== undefined && activeMoveIndex === pair.blackIdx;

                        return (
                            <div
                                key={pair.moveNumber}
                                className="grid grid-cols-[44px_1fr_1fr] items-center px-2.5 py-1 hover:bg-white/5 transition-colors"
                            >
                                <span className="text-xs text-amber-500/70 font-bold pl-1 select-none">
                                    {pair.moveNumber}.
                                </span>

                                <button
                                    type="button"
                                    onClick={() => onSelectMove(pair.whiteIdx)}
                                    className={`text-left px-2 py-0.5 rounded text-sm font-bold transition truncate cursor-pointer ${
                                        isWhiteActive
                                            ? 'active-move-btn bg-amber-600/40 text-amber-200 border border-amber-500/50 shadow-sm'
                                            : 'text-boxwood-light hover:bg-amber-900/30 hover:text-white'
                                    }`}
                                >
                                    {pair.whiteSan}
                                </button>

                                {pair.blackSan !== undefined && pair.blackIdx !== undefined ? (
                                    <button
                                        type="button"
                                        onClick={() => onSelectMove(pair.blackIdx!)}
                                        className={`text-left px-2 py-0.5 rounded text-sm font-bold transition truncate cursor-pointer ${
                                            isBlackActive
                                                ? 'active-move-btn bg-amber-600/40 text-amber-200 border border-amber-500/50 shadow-sm'
                                                : 'text-boxwood-light hover:bg-amber-900/30 hover:text-white'
                                        }`}
                                    >
                                        {pair.blackSan}
                                    </button>
                                ) : (
                                    <span/>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {viewIndex !== -1 && historyLength > 0 && (
                <button
                    type="button"
                    onClick={onReturnToLive}
                    className="w-full py-1.5 px-3 bg-amber-700/40 hover:bg-amber-700/60 border-t border-amber-500/40 text-amber-200 text-xs font-bold text-center transition shrink-0 cursor-pointer"
                >
                    Просмотр истории
                    ({viewIndex === -2 ? 'Начало' : `полуход ${viewIndex + 1} из ${historyLength}`}) —
                    Вернуться к игре
                </button>
            )}
        </div>
    );
}
