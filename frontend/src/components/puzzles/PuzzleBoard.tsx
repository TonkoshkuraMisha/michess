// --- FILE: frontend/src/components/puzzles/PuzzleBoard.tsx ---
// Доска задач (таск 13.3): ход двумя щелчками (удобно и на телефоне), выбор фигуры при превращении (в задачах бывает
// слабое превращение), подсветка последнего хода и подсказки. Фигуры и цвета — из настроек игрока.

import {useMemo, useState} from 'react';
import {Chess} from 'chess.js';
import {useI18n} from '../../i18n';
import {
    BOARD_THEMES, getHarmoniousPieceStyle, getPieceSvgUrl, getSavedBoardThemeKey, getSavedPieceSetKey,
} from '../../config/boardAppearance';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PROMOTIONS = ['q', 'r', 'b', 'n'] as const;

interface Props {
    fen: string;
    orientation: 'white' | 'black';
    /** Можно ли ходить (сторона решающего и его очередь). */
    interactive: boolean;
    lastMove?: { from: string; to: string } | null;
    /** Подсказка: поле фигуры и, после второй подсказки, поле хода. */
    hint?: { from: string; to: string | null } | null;
    /** Отметка результата хода на поле. */
    mark?: { square: string; ok: boolean } | null;
    onMove: (uci: string) => void;
}

export function PuzzleBoard({fen, orientation, interactive, lastMove, hint, mark, onMove}: Props) {
    const {t} = useI18n();
    const [selected, setSelected] = useState<string | null>(null);
    const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
    const game = useMemo(() => new Chess(fen), [fen]);
    const themeKey = getSavedBoardThemeKey();
    const pieceSet = getSavedPieceSetKey();
    const theme = BOARD_THEMES[themeKey] || BOARD_THEMES.walnut;
    const ranks = orientation === 'white' ? ['8', '7', '6', '5', '4', '3', '2', '1'] : ['1', '2', '3', '4', '5', '6', '7', '8'];
    const files = orientation === 'white' ? FILES : [...FILES].reverse();
    const targets = useMemo(() => new Set(
        selected ? game.moves({square: selected as never, verbose: true}).map((m) => m.to as string) : [],
    ), [game, selected]);

    const click = (square: string) => {
        if (!interactive || promotion) return;
        if (selected && targets.has(square)) {
            const candidates = game.moves({square: selected as never, verbose: true}).filter((m) => m.to === square);
            setSelected(null);
            if (candidates.some((m) => m.promotion)) {
                setPromotion({from: selected, to: square});
                return;
            }
            onMove(`${selected}${square}`);
            return;
        }
        const piece = game.get(square as never);
        setSelected(piece && piece.color === game.turn() ? square : null);
    };

    return (
        <div className="relative w-full aspect-square select-none" data-testid="puzzle-board">
            <div className="grid grid-cols-8 grid-rows-8 w-full h-full border border-black/60 rounded-[2px] overflow-hidden">
                {ranks.map((rank) => files.map((file) => {
                    const square = `${file}${rank}`;
                    const piece = game.get(square as never);
                    const dark = (FILES.indexOf(file) + Number(rank)) % 2 === 1;
                    const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
                    const isHint = hint && (hint.from === square || hint.to === square);
                    return (
                        <div key={square} data-square={square} onClick={() => click(square)}
                             style={{backgroundColor: dark ? theme.dark : theme.light}}
                             className={`relative flex items-center justify-center ${interactive ? 'cursor-pointer' : ''}`}>
                            {isLast && <div className="absolute inset-0 bg-amber-300/35 pointer-events-none"/>}
                            {selected === square && <div className="absolute inset-0 bg-amber-400/50 pointer-events-none"/>}
                            {isHint && (
                                <div data-testid={`puzzle-hint-${square}`}
                                     className="absolute inset-0 ring-4 ring-inset ring-sky-400/90 pointer-events-none"/>
                            )}
                            {targets.has(square) && (
                                <div className="absolute w-1/4 h-1/4 rounded-full bg-black/25 pointer-events-none z-10"/>
                            )}
                            {piece && (
                                <img src={getPieceSvgUrl(pieceSet, piece.color, piece.type)} alt={`${piece.color}${piece.type}`}
                                     draggable={false} className="w-full h-full object-contain pointer-events-none relative"
                                     style={getHarmoniousPieceStyle(pieceSet, themeKey, piece.color)}/>
                            )}
                            {mark?.square === square && (
                                <span data-testid={mark.ok ? 'puzzle-mark-ok' : 'puzzle-mark-wrong'}
                                      className={`absolute top-0.5 right-0.5 w-5 h-5 rounded-full text-[12px] leading-5 text-center font-bold text-white z-20 ${mark.ok ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                                    {mark.ok ? '✓' : '✗'}
                                </span>
                            )}
                        </div>
                    );
                }))}
            </div>
            {promotion && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-30" role="dialog"
                     aria-label={t('puzzles.promotion')}>
                    <div className="flex gap-2 bg-acacia-dark p-3 rounded-md border border-amber-600">
                        {PROMOTIONS.map((type) => (
                            <button key={type} type="button" data-testid={`puzzle-promote-${type}`}
                                    onClick={() => {
                                        onMove(`${promotion.from}${promotion.to}${type}`);
                                        setPromotion(null);
                                    }}
                                    className="w-14 h-14 bg-boxwood/80 rounded hover:bg-boxwood cursor-pointer">
                                <img src={getPieceSvgUrl(pieceSet, game.turn(), type)} alt={type} className="w-full h-full"/>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
