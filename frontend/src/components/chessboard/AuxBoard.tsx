// --- FILE: frontend/src/components/chessboard/AuxBoard.tsx ---
// Вспомогательная доска (таск 11.4): копия позиции партии, где игрок разыгрывает варианты за обе стороны,
// пока соперник думает. На партию не влияет; «К позиции партии» — снова текущая позиция.

import {useEffect, useState} from 'react';
import type {PointerEvent as ReactPointerEvent, ReactNode} from 'react';
import {Chess} from 'chess.js';
import {useI18n} from '../../i18n';
import {FILES} from './boardUtils';
import type {PromotionPiece} from './boardUtils';
import {PromotionDialog} from './PromotionDialog';
import type {PendingPromotion} from './types';
import {XrayOverlay} from '../xray/XrayOverlay';
import type {XrayMode} from '../xray/useXraySettings';

interface Props {
    /** Текущая позиция партии. */
    fen: string;
    flipped: boolean;
    lightColor: string;
    darkColor: string;
    renderPiece: (piece: { type: string; color: string }) => ReactNode;
    onClose: () => void;
    /** Режимы «Рентгена» основной доски (таск B.5); не передано — слоя нет (рентген в этой партии недоступен). */
    xrayModes?: Set<XrayMode>;
    /** «Показать за соперника»: рентген за сторону, которая не ходит на вспомогательной доске. */
    xrayForOpponent?: boolean;
}

/** Поле вспомогательной доски под точкой экрана. */
function auxSquareAt(x: number, y: number): string | null {
    const elements = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
    const cell = elements.find((el) => el instanceof HTMLElement && el.dataset.auxSquare);
    return cell instanceof HTMLElement ? cell.dataset.auxSquare ?? null : null;
}

interface Drag {
    from: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
}

const DRAG_THRESHOLD_PX = 4;

export function AuxBoard({fen, flipped, lightColor, darkColor, renderPiece, onClose, xrayModes, xrayForOpponent = false}: Props) {
    const {t} = useI18n();
    // Позиция, с которой начат разбор, и сыгранные на доске ходы (SAN): доска строится из них заново.
    const [sourceFen, setSourceFen] = useState(fen);
    const [moves, setMoves] = useState<string[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    // Превращение пешки ждёт выбора фигуры (раньше всегда ферзь — недопревращение не разыграть).
    const [promotion, setPromotion] = useState<PendingPromotion | null>(null);
    // Перетаскивание фигуры (таск B.5): как на основной доске, ход — по полю под указателем при отпускании.
    const [drag, setDrag] = useState<Drag | null>(null);

    const board = new Chess(sourceFen);
    for (const san of moves) board.move(san);

    const ranks = flipped ? ['1', '2', '3', '4', '5', '6', '7', '8'] : ['8', '7', '6', '5', '4', '3', '2', '1'];
    const files = flipped ? [...FILES].reverse() : FILES;
    const targets = new Set(
        selected ? board.moves({square: selected as never, verbose: true}).map((m) => m.to as string) : [],
    );

    const resetTo = (nextFen: string) => {
        setSourceFen(nextFen);
        setMoves([]);
        setSelected(null);
        setPromotion(null);
    };

    const play = (from: string, to: string, piece?: PromotionPiece) => {
        const move = board.move({from, to, promotion: piece});
        setMoves([...moves, move.san]);
        setSelected(null);
        setPromotion(null);
    };

    const click = (square: string) => {
        if (selected && targets.has(square)) {
            const isPromotion = board.moves({square: selected as never, verbose: true})
                .some((m) => m.to === square && m.promotion);
            if (isPromotion) setPromotion({from: selected, to: square, color: board.turn()});
            else play(selected, square);
            return;
        }
        const piece = board.get(square as never);
        setSelected(piece && piece.color === board.turn() ? square : null);
    };

    /** Ход from → to, если он легален; превращение — через выбор фигуры. */
    const attempt = (from: string, to: string) => {
        const candidates = board.moves({square: from as never, verbose: true}).filter((m) => m.to === to);
        if (candidates.length === 0) return;
        if (candidates.some((m) => m.promotion)) setPromotion({from, to, color: board.turn()});
        else play(from, to);
    };

    const pointerDown = (square: string, event: ReactPointerEvent) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const piece = board.get(square as never);
        if (!piece || piece.color !== board.turn() || promotion) return;
        setSelected(square);
        setDrag({from: square, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false});
    };

    useEffect(() => {
        if (!drag) return;
        const move = (event: PointerEvent) => setDrag((current) => current && {
            ...current, x: event.clientX, y: event.clientY,
            moved: current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > DRAG_THRESHOLD_PX,
        });
        const up = (event: PointerEvent) => {
            const target = auxSquareAt(event.clientX, event.clientY);
            if (drag.moved && target && target !== drag.from) attempt(drag.from, target);
            setDrag(null);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
        };
    });  // eslint-disable-line react-hooks/exhaustive-deps

    const dragged = drag?.moved ? board.get(drag.from as never) : null;
    const xraySide = board.turn() === (xrayForOpponent ? 'w' : 'b') ? 'b' : 'w';

    const undo = () => {
        setMoves(moves.slice(0, -1));
        setSelected(null);
        setPromotion(null);
    };

    return (
        <div className="flex flex-col gap-1.5" data-testid="aux-board">
            <div className="flex items-center justify-between">
                <span className="font-bold text-amber-400">{t('coachMode.auxTitle')}</span>
                <button type="button" onClick={onClose} data-testid="aux-close"
                        className="px-1.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 cursor-pointer">
                    {t('coachMode.auxClose')}
                </button>
            </div>
            <div className="relative">
            <div className="grid grid-cols-8 grid-rows-8 w-full aspect-square border border-black/60 rounded-[2px] overflow-hidden">
                {ranks.map((rank) => files.map((file) => {
                    const square = `${file}${rank}`;
                    const piece = board.get(square as never);
                    const isDark = (FILES.indexOf(file) + Number(rank)) % 2 === 1;
                    return (
                        <div key={square} data-aux-square={square} onClick={() => click(square)}
                             onPointerDown={(event) => pointerDown(square, event)}
                             style={{backgroundColor: isDark ? darkColor : lightColor}}
                             className="relative flex items-center justify-center cursor-pointer">
                            {selected === square && <div className="absolute inset-0 bg-amber-400/50 pointer-events-none"/>}
                            {targets.has(square) && (
                                <div className="absolute w-1/4 h-1/4 rounded-full bg-black/30 pointer-events-none z-10"/>
                            )}
                            {piece && !(drag?.moved && drag.from === square) && renderPiece(piece)}
                        </div>
                    );
                }))}
            </div>
            {xrayModes && xrayModes.size > 0 && (
                <XrayOverlay fen={board.fen()} side={xraySide} modes={xrayModes} flipped={flipped}
                             selectedSquare={selected}/>
            )}
            {dragged && drag && (
                <div className="fixed w-10 h-10 pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2"
                     data-testid="aux-drag-piece" style={{left: drag.x, top: drag.y}}>
                    {renderPiece(dragged)}
                </div>
            )}
            {promotion && (
                <PromotionDialog pendingPromotion={promotion} displayedFiles={files} displayedRanks={ranks}
                                 renderPieceSvg={renderPiece}
                                 onSelect={(piece) => play(promotion.from, promotion.to, piece)}
                                 onCancel={() => setPromotion(null)}/>
            )}
            </div>
            <p className="text-[10px] text-boxwood/60">{t('coachMode.auxNote')}</p>
            {moves.length > 0 && <p className="font-mono text-[11px]" data-testid="aux-moves">{moves.join(' ')}</p>}
            <div className="flex gap-1.5">
                <button type="button" onClick={undo} disabled={moves.length === 0} data-testid="aux-undo"
                        className="px-2 py-0.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 disabled:opacity-40 cursor-pointer">
                    {t('coachMode.auxUndo')}
                </button>
                <button type="button" onClick={() => resetTo(fen)} data-testid="aux-reset"
                        disabled={moves.length === 0 && sourceFen === fen}
                        className="px-2 py-0.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 disabled:opacity-40 cursor-pointer">
                    {t('coachMode.auxReset')}
                </button>
            </div>
        </div>
    );
}
