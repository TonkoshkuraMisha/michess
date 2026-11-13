// --- FILE: frontend/src/components/puzzles/puzzleNotation.ts ---
// Запись ходов задач фигурной нотацией (♘f3 вместо Nf3): понятна на любом языке, как у наставника.

import {Chess} from 'chess.js';

export function toMove(uci: string) {
    return {from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined};
}

const FIGURINES: Record<'w' | 'b', Record<string, string>> = {
    w: {K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘'},
    b: {K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞'},
};

/** SAN → фигурная запись: «Nf3» → «♘f3», «e8=Q» → «e8=♕». */
export function figurine(san: string, color: 'w' | 'b'): string {
    return san.replace(/^[KQRBN]/, (letter) => FIGURINES[color][letter])
        .replace(/=([QRBN])/, (_, letter: string) => `=${FIGURINES[color][letter]}`);
}

/** Решение в привычной записи: «24. ♘f6+ ♚f8 25. ♖xf7#» — ходы от позиции fen. */
export function solutionSan(fen: string, line: string[]): string {
    const game = new Chess(fen);
    const parts: string[] = [];
    for (const uci of line) {
        const number = game.moveNumber();
        const white = game.turn() === 'w';
        const move = game.move(toMove(uci));
        const san = figurine(move.san, move.color);
        if (white) parts.push(`${number}. ${san}`);
        else parts.push(parts.length === 0 ? `${number}… ${san}` : san);
    }
    return parts.join(' ');
}

/** Ходы без номеров: «♘f3», «♛xb2» — каждый от позиции после предыдущих. */
export function sanMoves(fen: string, line: string[]): string[] {
    const game = new Chess(fen);
    return line.map((uci) => {
        const move = game.move(toMove(uci));
        return figurine(move.san, move.color);
    });
}
