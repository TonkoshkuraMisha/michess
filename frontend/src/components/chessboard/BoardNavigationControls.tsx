// --- FILE: frontend/src/components/chessboard/BoardNavigationControls.tsx ---
// Кнопки перемотки партии на главной доске: в начало, ход назад, ход вперёд, к живой позиции. Только разметка:
// какую позицию показывать (viewIndex), решает Chessboard; те же действия — на клавишах-стрелках.

import {ChevronFirst, ChevronLeft, ChevronRight, ChevronLast} from 'lucide-react';
import {useI18n} from '../../i18n';

export interface BoardNavigationControlsProps {
    historyLength: number;
    /** -1 — живая позиция, -2 — самое начало партии (до первого хода). */
    viewIndex: number;
    onFirst: () => void;
    onBack: () => void;
    onForward: () => void;
    onLast: () => void;
}

/**
 * Кнопки перемотки журнала ходов — дублируют клавиши со стрелками (влево и вправо — на ход, вверх — в начало,
 * вниз — к живой позиции). «Назад» отключены в начале партии, «вперёд» — на живой позиции.
 */
export function BoardNavigationControls({
    historyLength, viewIndex, onFirst, onBack, onForward, onLast,
}: BoardNavigationControlsProps) {
    const {t} = useI18n();
    return (
        <div
            className="bg-acacia-dark p-2 rounded-md border border-amber-900/40 flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-boxwood/80 pl-1">{t('board.navigation')}</span>
            <div className="flex gap-1.5">
                <button
                    type="button"
                    disabled={historyLength === 0 || viewIndex === -2}
                    onClick={onFirst}
                    className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                    title={t('board.toStart')}
                >
                    <ChevronFirst size={16}/>
                </button>
                <button
                    type="button"
                    disabled={historyLength === 0 || viewIndex === -2}
                    onClick={onBack}
                    className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                    title={t('board.back')}
                >
                    <ChevronLeft size={16}/>
                </button>
                <button
                    type="button"
                    disabled={historyLength === 0 || viewIndex === -1}
                    onClick={onForward}
                    className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                    title={t('board.forward')}
                >
                    <ChevronRight size={16}/>
                </button>
                <button
                    type="button"
                    disabled={historyLength === 0 || viewIndex === -1}
                    onClick={onLast}
                    className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                    title={t('board.toEnd')}
                >
                    <ChevronLast size={16}/>
                </button>
            </div>
        </div>
    );
}
