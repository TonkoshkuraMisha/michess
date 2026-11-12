// --- FILE: frontend/src/components/chessboard/__tests__/boardUtils.test.ts ---

import {describe, expect, it} from 'vitest';
import {Chess} from 'chess.js';
import {
    calculateMaterialBalance, cloneChessInstance, customStartFen, pairHalfMoves, prevIndexHelper,
    STANDARD_START_FEN, validateFen,
} from '../boardUtils';
import {DEFAULT_TIME_CONTROL, TIME_CONTROLS} from '../../../config/timeControls';

describe('calculateMaterialBalance', () => {
    it('is even in the starting position', () => {
        const balance = calculateMaterialBalance(new Chess().board());
        expect(balance.whiteAdvantage).toBe(0);
        expect(balance.blackAdvantage).toBe(0);
        expect(balance.whiteCapturedSymbols).toEqual([]);
    });

    it('counts a captured piece for the capturing side', () => {
        const game = new Chess();
        ['e4', 'd5', 'exd5'].forEach((m) => game.move(m));
        const balance = calculateMaterialBalance(game.board());
        expect(balance.whiteAdvantage).toBe(1);
        expect(balance.whiteCapturedSymbols).toEqual(['♟']);
    });
});

describe('cloneChessInstance', () => {
    it('keeps move history and is independent of the source', () => {
        const game = new Chess();
        ['e4', 'e5', 'Nf3'].forEach((m) => game.move(m));
        const copy = cloneChessInstance(game);
        expect(copy.history()).toEqual(['e4', 'e5', 'Nf3']);
        copy.move('Nc6');
        expect(game.history()).toHaveLength(3);
    });
});

describe('prevIndexHelper', () => {
    it('maps the live view (-1) to the last move', () => {
        expect(prevIndexHelper(-1, 10)).toBe(9);
        expect(prevIndexHelper(4, 10)).toBe(4);
    });
});

describe('time controls', () => {
    it('groups popular presets into bullet/blitz/rapid/classical with the default among them', () => {
        expect(TIME_CONTROLS.map((g) => g.category)).toEqual(['bullet', 'blitz', 'rapid', 'classical']);
        const options = TIME_CONTROLS.flatMap((g) => g.options);
        expect(options).toContain(DEFAULT_TIME_CONTROL);
        options.forEach((opt) => expect(opt.category).toBe(
            TIME_CONTROLS.find((g) => g.options.includes(opt))?.category
        ));
    });
});

describe('партия с произвольной начальной позиции', () => {
    const BLACK_TO_MOVE = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 40';

    it('customStartFen отличает свою позицию от обычной расстановки', () => {
        expect(customStartFen(new Chess())).toBeNull();
        expect(customStartFen(new Chess(STANDARD_START_FEN))).toBeNull();
        expect(customStartFen(new Chess(BLACK_TO_MOVE))).toBe(BLACK_TO_MOVE);
    });

    it('клон партии с позиции сохраняет начальную позицию и ходы', () => {
        const game = new Chess(BLACK_TO_MOVE);
        game.move('Kf8');
        const copy = cloneChessInstance(game);

        expect(copy.fen()).toBe(game.fen());
        expect(customStartFen(copy)).toBe(BLACK_TO_MOVE);
        copy.undo();
        expect(copy.fen()).toBe(BLACK_TO_MOVE);
    });

    it('validateFen отклоняет мусор, невозможные и законченные позиции', () => {
        expect(validateFen(BLACK_TO_MOVE)).toBeNull();
        expect(validateFen(`  ${BLACK_TO_MOVE}  `)).toBeNull();
        expect(validateFen('not a fen')).toMatch(/Некорректная позиция/);
        expect(validateFen('8/8/8/8/8/8/8/8 w - - 0 1')).toMatch(/Некорректная позиция/);
        expect(validateFen('k7/7Q/1K6/8/8/8/8/8 b - - 0 1')).toBeNull();
        expect(validateFen('k7/Q7/1K6/8/8/8/8/8 b - - 0 1')).toMatch(/уже окончена/);  // мат
    });

    it('pairHalfMoves: обычная партия', () => {
        const pairs = pairHalfMoves([{san: 'e4'}, {san: 'e5'}, {san: 'Nf3'}]);
        expect(pairs).toEqual([
            {moveNumber: 1, whiteSan: 'e4', whiteIdx: 0, blackSan: 'e5', blackIdx: 1},
            {moveNumber: 2, whiteSan: 'Nf3', whiteIdx: 2},
        ]);
    });

    it('pairHalfMoves: партия с хода чёрных на 40-м ходу', () => {
        const pairs = pairHalfMoves([{san: 'Kf8'}, {san: 'Rd8+'}, {san: 'Ke7'}], BLACK_TO_MOVE);
        expect(pairs).toEqual([
            {moveNumber: 40, whiteIdx: -1, blackSan: 'Kf8', blackIdx: 0},
            {moveNumber: 41, whiteSan: 'Rd8+', whiteIdx: 1, blackSan: 'Ke7', blackIdx: 2},
        ]);
    });

    it('pairHalfMoves: без ходов и с ходом белых не с первого хода', () => {
        expect(pairHalfMoves([], BLACK_TO_MOVE)).toEqual([]);
        expect(pairHalfMoves([{san: 'Qa7#'}], 'k7/7Q/1K6/8/8/8/8/8 w - - 0 57')).toEqual([
            {moveNumber: 57, whiteSan: 'Qa7#', whiteIdx: 0},
        ]);
    });
});
