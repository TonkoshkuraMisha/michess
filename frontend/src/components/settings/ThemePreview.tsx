// --- FILE: frontend/src/components/settings/ThemePreview.tsx ---
// Предпросмотр темы-комплекта (таск 18.3): живая позиция из партии на доске, фигурах и фоне комплекта.
// Данные — комплект из config/themePresets.ts (доска, фигуры, фон зала); рисуется упрощённая доска без игровой
// логики. Используется в Settings.tsx в списке комплектов.

import {Chess} from 'chess.js';
import {useMemo} from 'react';
import {BOARD_THEMES, getHarmoniousPieceStyle, getPieceSvgUrl, lastMoveColor} from '../../config/boardAppearance';
import {pageBackgroundStyle} from '../../config/pageBackground';
import type {ThemePreset} from '../../config/themePresets';
import {BoardTextureLayer} from '../chessboard/BoardTextureLayer';

// Позиция предпросмотра.
// Итальянская партия после 4.c3: фигуры всех видов в игре, последний ход подсвечен.
const PREVIEW_FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R b KQkq - 0 4';
// Поля подсвеченного последнего хода (c2–c3).
const LAST_MOVE = ['c2', 'c3'];

/** Мини-доска комплекта preset; size — сторона доски в пикселях (без рамки). Неизвестная тема доски заменяется ореховой. */
export function ThemePreview({preset, size = 168}: { preset: ThemePreset; size?: number }) {
    const theme = BOARD_THEMES[preset.board] ?? BOARD_THEMES.walnut;
    const board = useMemo(() => new Chess(PREVIEW_FEN).board(), []);
    return (
        <div className="p-2 rounded-md" style={pageBackgroundStyle(preset.pattern, preset.palette)} data-testid={`preview-${preset.id}`}>
            <div className="relative p-1.5 rounded mx-auto" style={{backgroundColor: theme.border, width: size + 12}}>
                <BoardTextureLayer theme={theme} where="frame"/>
                <div className="relative grid grid-cols-8" style={{width: size, height: size}}>
                    {board.flatMap((row, r) => row.map((piece, f) => {
                        const square = `${'abcdefgh'[f]}${8 - r}`;
                        const isDark = (r + f) % 2 === 1;
                        return (
                            <div key={square} className="relative flex items-center justify-center"
                                 style={{backgroundColor: isDark ? theme.dark : theme.light}}>
                                <BoardTextureLayer theme={theme} where="square" isDark={isDark}/>
                                {LAST_MOVE.includes(square) && <div className="absolute inset-0" style={{backgroundColor: lastMoveColor(theme)}}/>}
                                {piece && (
                                    <img src={getPieceSvgUrl(preset.pieces, piece.color, piece.type)} alt="" draggable={false}
                                         className="relative" style={getHarmoniousPieceStyle(preset.pieces, preset.board, piece.color)}/>
                                )}
                            </div>
                        );
                    }))}
                </div>
            </div>
        </div>
    );
}
