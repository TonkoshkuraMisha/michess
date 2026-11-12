// --- FILE: frontend/src/components/chessboard/boardUtils.ts ---
// Константы и чистые функции доски (вынесено из Chessboard.tsx).

import {Chess} from 'chess.js';
import {t} from '../../i18n';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export const MIN_BOARD_SIZE = 280;
export const MAX_BOARD_SIZE = 860;

export type PromotionPiece = 'q' | 'n' | 'r' | 'b';

function promotionOption(type: PromotionPiece): { type: PromotionPiece; readonly label: string } {
    return {
        type,
        get label() {
            return t(`board.pieces.${type}`);
        },
    };
}

export const PROMOTION_OPTIONS: Array<{ type: PromotionPiece; readonly label: string }> = [
    promotionOption('q'),
    promotionOption('n'),
    promotionOption('r'),
    promotionOption('b'),
];

export function getMaxViewportBoardSize(): number {
    if (typeof window === 'undefined') return 560;
    const availableHeight = window.innerHeight - 220;
    const availableWidth = window.innerWidth >= 1280
        ? window.innerWidth - 850
        : window.innerWidth - 24;
    const limit = Math.min(availableHeight, availableWidth, MAX_BOARD_SIZE);
    return Math.max(MIN_BOARD_SIZE, Math.min(limit, window.innerWidth - 24));
}

export function getDefaultBoardSize(): number {
    if (typeof window !== 'undefined') {
        return getMaxViewportBoardSize();
    }
    return 540;
}

export const PIECE_VALUES: Record<string, number> = {p: 1, n: 3, b: 3, r: 5, q: 9, k: 0};

export function calculateMaterialBalance(boardState: any[][]) {
    const startCounts: Record<string, number> = {p: 8, n: 2, b: 2, r: 2, q: 1};
    const currentWhite: Record<string, number> = {p: 0, n: 0, b: 0, r: 0, q: 0};
    const currentBlack: Record<string, number> = {p: 0, n: 0, b: 0, r: 0, q: 0};

    let whiteScore = 0;
    let blackScore = 0;

    for (const row of boardState) {
        for (const cell of row) {
            if (!cell) continue;
            const val = PIECE_VALUES[cell.type] || 0;
            if (cell.color === 'w') {
                whiteScore += val;
                if (currentWhite[cell.type] !== undefined) currentWhite[cell.type]++;
            } else {
                blackScore += val;
                if (currentBlack[cell.type] !== undefined) currentBlack[cell.type]++;
            }
        }
    }

    const whiteCapturedSymbols: string[] = [];
    const blackCapturedSymbols: string[] = [];
    const order = ['q', 'r', 'b', 'n', 'p'];
    const glyphs: Record<string, string> = {q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'};

    for (const t of order) {
        const missingBlack = Math.max(0, startCounts[t] - currentBlack[t]);
        for (let i = 0; i < missingBlack; i++) whiteCapturedSymbols.push(glyphs[t]);

        const missingWhite = Math.max(0, startCounts[t] - currentWhite[t]);
        for (let i = 0; i < missingWhite; i++) blackCapturedSymbols.push(glyphs[t]);
    }

    return {
        whiteAdvantage: Math.max(0, whiteScore - blackScore),
        blackAdvantage: Math.max(0, blackScore - whiteScore),
        whiteCapturedSymbols,
        blackCapturedSymbols
    };
}

export function cloneChessInstance(source: Chess): Chess {
    const copy = new Chess();
    const currentPgn = source.pgn();
    if (currentPgn) {
        copy.loadPgn(currentPgn);
    } else {
        copy.load(source.fen());
    }
    return copy;
}

export const STANDARD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Начальная позиция партии, если она не обычная расстановка (из заголовка FEN в PGN), иначе null. */
export function customStartFen(source: Chess): string | null {
    const fen = source.header().FEN;
    return fen && fen !== STANDARD_START_FEN ? fen : null;
}

/** Проверяет FEN теми же правилами, что и доска; возвращает текст ошибки или null. */
export function validateFen(fen: string): string | null {
    try {
        const probe = new Chess(fen.trim());
        if (probe.isGameOver()) return t('board.fenGameOver');
        return null;
    } catch {
        return t('board.fenInvalid');
    }
}

export interface HalfMovePair {
    moveNumber: number;
    /** undefined и whiteIdx === -1 — партия начата с хода чёрных, у первой пары нет хода белых. */
    whiteSan?: string;
    whiteIdx: number;
    blackSan?: string;
    blackIdx?: number;
}

/**
 * Раскладывает полуходы по парам «белые / чёрные». Партия с произвольной позиции может
 * начинаться с хода чёрных и не с первого хода — номер и сторона берутся из её FEN.
 */
export function pairHalfMoves(history: Array<{ san: string }>, startFen?: string | null): HalfMovePair[] {
    const fenParts = (startFen ?? '').trim().split(/\s+/);
    const blackStarts = fenParts[1] === 'b';
    const firstMoveNumber = Number(fenParts[5]) > 0 ? Number(fenParts[5]) : 1;

    const pairs: HalfMovePair[] = [];
    history.forEach((move, idx) => {
        const ply = idx + (blackStarts ? 1 : 0);
        const moveNumber = firstMoveNumber + Math.floor(ply / 2);
        if (ply % 2 === 0) {
            pairs.push({moveNumber, whiteSan: move.san, whiteIdx: idx});
        } else if (pairs.length === 0) {
            pairs.push({moveNumber, whiteIdx: -1, blackSan: move.san, blackIdx: idx});
        } else {
            pairs[pairs.length - 1].blackSan = move.san;
            pairs[pairs.length - 1].blackIdx = idx;
        }
    });
    return pairs;
}

export function prevIndexHelper(viewIndex: number, historyLength: number): number {
    return viewIndex === -1 ? historyLength - 1 : viewIndex;
}
