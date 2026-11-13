// --- FILE: frontend/src/components/chessboard/AuxBoard.tsx ---
// Вспомогательная доска (таск 11.4): копия позиции партии, где игрок разыгрывает варианты за обе стороны,
// пока соперник думает. На партию не влияет; «К позиции партии» — снова текущая позиция.

import {useState} from 'react';
import type {ReactNode} from 'react';
import {Chess} from 'chess.js';
import {useI18n} from '../../i18n';
import {FILES} from './boardUtils';

interface Props {
    /** Текущая позиция партии. */
    fen: string;
    flipped: boolean;
    lightColor: string;
    darkColor: string;
    renderPiece: (piece: { type: string; color: string }) => ReactNode;
    onClose: () => void;
}

export function AuxBoard({fen, flipped, lightColor, darkColor, renderPiece, onClose}: Props) {
    const {t} = useI18n();
    // Позиция, с которой начат разбор, и сыгранные на доске ходы (SAN): доска строится из них заново.
    const [sourceFen, setSourceFen] = useState(fen);
    const [moves, setMoves] = useState<string[]>([]);
    const [selected, setSelected] = useState<string | null>(null);

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
    };

    const click = (square: string) => {
        if (selected && targets.has(square)) {
            const move = board.move({from: selected, to: square, promotion: 'q'});
            setMoves([...moves, move.san]);
            setSelected(null);
            return;
        }
        const piece = board.get(square as never);
        setSelected(piece && piece.color === board.turn() ? square : null);
    };

    const undo = () => {
        setMoves(moves.slice(0, -1));
        setSelected(null);
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
            <div className="grid grid-cols-8 grid-rows-8 w-full aspect-square border border-black/60 rounded-[2px] overflow-hidden">
                {ranks.map((rank) => files.map((file) => {
                    const square = `${file}${rank}`;
                    const piece = board.get(square as never);
                    const isDark = (FILES.indexOf(file) + Number(rank)) % 2 === 1;
                    return (
                        <div key={square} data-aux-square={square} onClick={() => click(square)}
                             style={{backgroundColor: isDark ? darkColor : lightColor}}
                             className="relative flex items-center justify-center cursor-pointer">
                            {selected === square && <div className="absolute inset-0 bg-amber-400/50 pointer-events-none"/>}
                            {targets.has(square) && (
                                <div className="absolute w-1/4 h-1/4 rounded-full bg-black/30 pointer-events-none z-10"/>
                            )}
                            {piece && renderPiece(piece)}
                        </div>
                    );
                }))}
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
