// --- FILE: frontend/src/components/chessboard/BoardNavigationControls.tsx ---

import {ChevronFirst, ChevronLeft, ChevronRight, ChevronLast} from 'lucide-react';

export interface BoardNavigationControlsProps {
    historyLength: number;
    /** -1 — живая позиция, -2 — самое начало партии (до первого хода). */
    viewIndex: number;
    onFirst: () => void;
    onBack: () => void;
    onForward: () => void;
    onLast: () => void;
}

/** Кнопки перемотки журнала ходов — дублируют клавиши со стрелками. */
export function BoardNavigationControls({
    historyLength, viewIndex, onFirst, onBack, onForward, onLast,
}: BoardNavigationControlsProps) {
    return (
        <div
            className="bg-acacia-dark p-2 rounded-md border border-amber-900/40 flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-boxwood/80 pl-1">Навигация:</span>
            <div className="flex gap-1.5">
                <button
                    type="button"
                    disabled={historyLength === 0 || viewIndex === -2}
                    onClick={onFirst}
                    className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                    title="В начало партии (Стрелка вверх)"
                >
                    <ChevronFirst size={16}/>
                </button>
                <button
                    type="button"
                    disabled={historyLength === 0 || viewIndex === -2}
                    onClick={onBack}
                    className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                    title="Ход назад (Стрелка влево)"
                >
                    <ChevronLeft size={16}/>
                </button>
                <button
                    type="button"
                    disabled={historyLength === 0 || viewIndex === -1}
                    onClick={onForward}
                    className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                    title="Ход вперед (Стрелка вправо)"
                >
                    <ChevronRight size={16}/>
                </button>
                <button
                    type="button"
                    disabled={historyLength === 0 || viewIndex === -1}
                    onClick={onLast}
                    className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                    title="К последнему ходу (Стрелка вниз)"
                >
                    <ChevronLast size={16}/>
                </button>
            </div>
        </div>
    );
}
