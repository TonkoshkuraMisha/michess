// --- FILE: frontend/src/components/chessboard/PromotionDialog.tsx ---

import {X} from 'lucide-react';
import {PROMOTION_OPTIONS} from './boardUtils';
import type {PromotionPiece} from './boardUtils';
import type {PendingPromotion} from './types';

export interface PromotionDialogProps {
    pendingPromotion: PendingPromotion;
    /** Файлы/ранги в порядке отображения доски (с учётом переворота) — чтобы встать рядом с полем. */
    displayedFiles: readonly string[];
    displayedRanks: readonly string[];
    renderPieceSvg: (piece: { type: string; color: string }) => React.ReactNode;
    onSelect: (pieceType: PromotionPiece) => void;
    onCancel: () => void;
}

/** Всплывающий выбор фигуры при превращении пешки — встаёт рядом с полем назначения хода. */
export function PromotionDialog({
    pendingPromotion, displayedFiles, displayedRanks, renderPieceSvg, onSelect, onCancel,
}: PromotionDialogProps) {
    const fileIdx = displayedFiles.indexOf(pendingPromotion.to[0]);
    const rankIdx = displayedRanks.indexOf(pendingPromotion.to[1]);
    const openDownwards = rankIdx <= 3;
    const clampedLeftPercent = Math.min(Math.max((fileIdx + 0.5) * 12.5, 22), 78);

    return (
        <div
            className="absolute inset-0 z-50 bg-black/55 backdrop-blur-[1px] flex items-center justify-center rounded-[2px]"
            onClick={onCancel}
        >
            <div
                style={{
                    left: `${clampedLeftPercent}%`,
                    top: openDownwards ? '6%' : 'auto',
                    bottom: openDownwards ? 'auto' : '6%',
                    transform: 'translateX(-50%)'
                }}
                onClick={(e) => e.stopPropagation()}
                className="absolute bg-[#1A120B] border-2 border-amber-500 rounded-lg p-3 shadow-2xl flex flex-col items-center gap-2.5"
            >
                <div className="flex items-center justify-between w-full gap-3 px-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                        Превращение пешки ({pendingPromotion.to})
                    </span>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="text-boxwood/60 hover:text-amber-300 transition cursor-pointer"
                        title="Отмена (Esc)"
                    >
                        <X size={15}/>
                    </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    {PROMOTION_OPTIONS.map((opt) => (
                        <button
                            key={opt.type}
                            type="button"
                            onClick={() => onSelect(opt.type)}
                            className="w-16 h-18 rounded-md bg-acacia-dark hover:bg-amber-800/70 border border-amber-600/50 hover:border-amber-300 transition flex flex-col items-center justify-between py-2 px-1 shadow cursor-pointer group"
                            title={opt.label}
                        >
                            <div className="w-10 h-10 flex items-center justify-center overflow-hidden shrink-0">
                                {renderPieceSvg({type: opt.type, color: pendingPromotion.color})}
                            </div>
                            <span className="text-xs font-bold text-amber-200 group-hover:text-white leading-none">
                                {opt.label}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
