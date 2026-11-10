// --- FILE: frontend/src/components/chessboard/__tests__/boardUtils.test.ts ---

import {describe, expect, it} from 'vitest';
import {Chess} from 'chess.js';
import {calculateMaterialBalance, cloneChessInstance, prevIndexHelper} from '../boardUtils';
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
