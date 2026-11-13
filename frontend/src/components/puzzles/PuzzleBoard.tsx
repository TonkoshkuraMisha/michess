// --- FILE: frontend/src/components/puzzles/PuzzleBoard.tsx ---
// Доска задач (таск 13.3): ход перетаскиванием фигуры (мышь, палец, перо) или двумя щелчками — фигура, затем поле;
// выбор фигуры при превращении (в задачах бывает слабое превращение), подсветка последнего хода и подсказки.
// Фигуры и цвета — из настроек игрока. С onSquare щелчок выбирает поле, а не ход (защитные упражнения, таск 13.6).
//
// Перетаскивание: фигура «прилипает» к указателю, ход — по полю под ним при отпускании. Отпустили на том же поле
// (или просто щёлкнули) — фигура остаётся выбранной, и ход можно закончить щелчком по полю. Выбор привязан к позиции:
// после ответа соперника или новой задачи старый выбор не действует.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {Chess} from 'chess.js';
import {useI18n} from '../../i18n';
import {resolveMoveSound, soundEngine} from '../../services/soundEngine';
import {
    BOARD_THEMES, getHarmoniousPieceStyle, getPieceSvgUrl, getSavedBoardThemeKey, getSavedPieceSetKey,
} from '../../config/boardAppearance';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PROMOTIONS = ['q', 'r', 'b', 'n'] as const;
/** Сдвиг указателя, после которого нажатие считается перетаскиванием, а не щелчком. */
const DRAG_THRESHOLD_PX = 4;

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
    /** Выбор поля вместо хода (защитные упражнения 13.6: «покажите угрозу»). */
    onSquare?: (square: string) => void;
    /** Стрелки поверх доски (уроки школы, таск 14.1). */
    arrows?: BoardArrow[];
    /** Подсвеченные поля. */
    highlights?: string[];
    /** «Призрачная» фигура: полупрозрачная, показывает, куда фигура может встать. */
    ghost?: { square: string; piece: string } | null;
    /** Звуки хода и неверного решения, как на основной доске (по умолчанию включены; выключатель — общий). */
    sound?: boolean;
}

export interface BoardArrow {
    from: string;
    to: string;
    color?: 'green' | 'red' | 'blue' | 'yellow';
}

const ARROW_COLORS: Record<NonNullable<BoardArrow['color']>, string> = {
    green: 'rgba(22, 163, 74, 0.85)',
    red: 'rgba(220, 38, 38, 0.85)',
    blue: 'rgba(37, 99, 235, 0.85)',
    yellow: 'rgba(234, 179, 8, 0.9)',
};

interface Drag {
    from: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
}

/** Центр поля в координатах 0..8 с учётом ориентации доски. */
function squareCenter(square: string, orientation: 'white' | 'black'): [number, number] {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1]) - 1;
    return orientation === 'white' ? [file + 0.5, 7 - rank + 0.5] : [7 - file + 0.5, rank + 0.5];
}

/** Треугольник наконечника стрелки у поля назначения. */
function arrowHead(x1: number, y1: number, x2: number, y2: number): string {
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / length;
    const uy = (y2 - y1) / length;
    const tipX = x2 - ux * 0.15;
    const tipY = y2 - uy * 0.15;
    const baseX = tipX - ux * 0.4;
    const baseY = tipY - uy * 0.4;
    return `${tipX},${tipY} ${baseX - uy * 0.22},${baseY + ux * 0.22} ${baseX + uy * 0.22},${baseY - ux * 0.22}`;
}

/** Поле доски под точкой экрана (по атрибуту data-square). */
function squareAt(x: number, y: number): string | null {
    const elements = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
    const cell = elements.find((el) => el instanceof HTMLElement && el.dataset.square);
    return cell instanceof HTMLElement ? cell.dataset.square ?? null : null;
}

export function PuzzleBoard({
    fen, orientation, interactive, lastMove, hint, mark, onMove, onSquare, arrows = [], highlights = [], ghost = null,
    sound = true,
}: Props) {
    const {t} = useI18n();
    const [selection, setSelection] = useState<{ square: string; fen: string } | null>(null);
    const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const game = useMemo(() => new Chess(fen), [fen]);
    const selected = selection && selection.fen === fen && interactive && !onSquare ? selection.square : null;
    const themeKey = getSavedBoardThemeKey();
    const pieceSet = getSavedPieceSetKey();
    const theme = BOARD_THEMES[themeKey] || BOARD_THEMES.walnut;
    const ranks = orientation === 'white' ? ['8', '7', '6', '5', '4', '3', '2', '1'] : ['1', '2', '3', '4', '5', '6', '7', '8'];
    const files = orientation === 'white' ? FILES : [...FILES].reverse();
    const targets = useMemo(() => new Set(
        selected ? game.moves({square: selected as never, verbose: true}).map((m) => m.to as string) : [],
    ), [game, selected]);

    // Звук хода: позиция сменилась ходом lastMove из предыдущей позиции (свой ход, ответ соперника, ход урока).
    // Новая задача или переход к другому шагу — не ход, без звука.
    const previousFen = useRef(fen);
    useEffect(() => {
        const before = previousFen.current;
        previousFen.current = fen;
        if (!sound || before === fen || !lastMove) return;
        const placement = fen.split(' ')[0];
        try {
            const played = new Chess(before).moves({square: lastMove.from as never, verbose: true})
                .find((m) => m.to === lastMove.to && m.after.split(' ')[0] === placement);
            if (played) soundEngine.play(resolveMoveSound(played.san));
        } catch {
            // Предыдущая позиция не разбирается — просто без звука.
        }
    }, [fen, lastMove, sound]);
    const wrongMark = mark && !mark.ok ? mark.square : null;
    useEffect(() => {
        if (sound && wrongMark) soundEngine.play('illegal');
    }, [wrongMark, sound]);

    const select = (square: string | null) => setSelection(square ? {square, fen} : null);

    const ownPiece = (square: string) => {
        const piece = game.get(square as never);
        return Boolean(piece && piece.color === game.turn());
    };

    /** Ход from → to, если он легален; превращение — через выбор фигуры. Возвращает, был ли ход. */
    const attempt = useCallback((from: string, to: string): boolean => {
        const candidates = game.moves({square: from as never, verbose: true}).filter((m) => m.to === to);
        if (candidates.length === 0) return false;
        setSelection(null);
        if (candidates.some((m) => m.promotion)) {
            setPromotion({from, to});
            return true;
        }
        onMove(`${from}${to}`);
        return true;
    }, [game, onMove]);

    const click = (square: string) => {
        if (!interactive || promotion) return;
        if (onSquare) {
            onSquare(square);
            return;
        }
        if (selected && selected !== square && attempt(selected, square)) return;
        select(ownPiece(square) ? square : null);
    };

    const pointerDown = (square: string, event: ReactPointerEvent) => {
        if (!interactive || promotion || onSquare) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (!ownPiece(square)) return;  // чужая фигура или пустое поле — это щелчок (взятие, отмена выбора)
        event.preventDefault();         // без выделения текста и «призрака» картинки браузера
        select(square);
        setDrag({from: square, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false});
    };

    useEffect(() => {
        if (!drag) return;
        const move = (event: PointerEvent) => {
            setDrag((current) => current && {
                ...current, x: event.clientX, y: event.clientY,
                moved: current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > DRAG_THRESHOLD_PX,
            });
        };
        const up = (event: PointerEvent) => {
            const from = drag.from;
            const target = squareAt(event.clientX, event.clientY);
            setDrag(null);
            // Отпустили на другом поле — ход; на том же или мимо доски — фигура остаётся выбранной (щелчок).
            if (target && target !== from) attempt(from, target);
        };
        const cancel = () => setDrag(null);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }, [drag?.from, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

    // Позиция сменилась посреди перетаскивания (ответ соперника, новая задача) — перетаскивание отменяется.
    useEffect(() => setDrag(null), [fen, interactive]);

    const dragged = drag?.moved ? game.get(drag.from as never) : null;

    return (
        <div className="relative w-full aspect-square select-none touch-none" data-testid="puzzle-board">
            <div className="grid grid-cols-8 grid-rows-8 w-full h-full border border-black/60 rounded-[2px] overflow-hidden">
                {ranks.map((rank) => files.map((file) => {
                    const square = `${file}${rank}`;
                    const piece = game.get(square as never);
                    const dark = (FILES.indexOf(file) + Number(rank)) % 2 === 1;
                    const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
                    const isHint = hint && (hint.from === square || hint.to === square);
                    const lifted = Boolean(drag?.moved && drag.from === square);
                    const grabbable = interactive && !onSquare && !promotion && piece && piece.color === game.turn();
                    return (
                        <div key={square} data-square={square} onClick={() => click(square)}
                             onPointerDown={(event) => pointerDown(square, event)}
                             style={{backgroundColor: dark ? theme.dark : theme.light}}
                             className={`relative flex items-center justify-center ${interactive ? 'cursor-pointer' : ''} ${grabbable ? 'cursor-grab' : ''}`}>
                            {isLast && <div className="absolute inset-0 bg-amber-300/35 pointer-events-none"/>}
                            {highlights.includes(square) && (
                                <div data-testid={`board-highlight-${square}`}
                                     className="absolute inset-0 bg-sky-400/40 pointer-events-none"/>
                            )}
                            {ghost?.square === square && !piece && (
                                <img src={getPieceSvgUrl(pieceSet, ghost.piece[0] as 'w' | 'b', ghost.piece[1].toLowerCase())}
                                     alt="" aria-hidden="true" data-testid={`board-ghost-${square}`} draggable={false}
                                     className="absolute inset-0 w-full h-full object-contain opacity-40 pointer-events-none"/>
                            )}
                            {selected === square && <div className="absolute inset-0 bg-amber-400/50 pointer-events-none"/>}
                            {isHint && (
                                <div data-testid={`puzzle-hint-${square}`}
                                     className="absolute inset-0 ring-4 ring-inset ring-sky-400/90 pointer-events-none"/>
                            )}
                            {targets.has(square) && (
                                <div data-testid={`puzzle-target-${square}`}
                                     className="absolute w-1/4 h-1/4 rounded-full bg-black/25 pointer-events-none z-10"/>
                            )}
                            {piece && (
                                <img src={getPieceSvgUrl(pieceSet, piece.color, piece.type)} alt={`${piece.color}${piece.type}`}
                                     draggable={false}
                                     className={`w-full h-full object-contain pointer-events-none relative ${lifted ? 'opacity-30' : ''}`}
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
            {arrows.length > 0 && (
                <svg viewBox="0 0 8 8" className="absolute inset-0 w-full h-full pointer-events-none z-20"
                     data-testid="board-arrows" aria-hidden="true">
                    {arrows.map((arrow, i) => {
                        const [x1, y1] = squareCenter(arrow.from, orientation);
                        const [x2, y2] = squareCenter(arrow.to, orientation);
                        const length = Math.hypot(x2 - x1, y2 - y1) || 1;
                        // Стрелка заканчивается чуть раньше центра поля, чтобы наконечник не закрывал фигуру.
                        const ex = x2 - ((x2 - x1) / length) * 0.3;
                        const ey = y2 - ((y2 - y1) / length) * 0.3;
                        const color = ARROW_COLORS[arrow.color ?? 'green'];
                        return (
                            <g key={`${arrow.from}${arrow.to}${i}`} data-testid={`board-arrow-${arrow.from}${arrow.to}`}>
                                <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={color} strokeWidth={0.16} strokeLinecap="round"/>
                                <polygon points={arrowHead(x1, y1, x2, y2)} fill={color}/>
                            </g>
                        );
                    })}
                </svg>
            )}
            {drag && dragged && (
                <img src={getPieceSvgUrl(pieceSet, dragged.color, dragged.type)} alt="" aria-hidden="true" draggable={false}
                     data-testid="puzzle-drag-piece"
                     className="fixed w-[12%] max-w-[90px] aspect-square object-contain pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2"
                     style={{left: drag.x, top: drag.y, ...getHarmoniousPieceStyle(pieceSet, themeKey, dragged.color)}}/>
            )}
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
