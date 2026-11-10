// --- FILE: frontend/src/components/chessboard/__tests__/boardUtils.test.ts ---

import {describe, expect, it} from 'vitest';
import {Chess} from 'chess.js';
import {calculateMaterialBalance, cloneChessInstance, prevIndexHelper} from '../boardUtils';
import {DEFAULT_DGT_OPTION, TIME_CONTROLS} from '../../../config/timeControls';

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
    it('provides 36 DGT 2500 programs with the default among them', () => {
        const options = TIME_CONTROLS.flatMap((g) => g.options);
        expect(options).toHaveLength(36);
        expect(options).toContain(DEFAULT_DGT_OPTION);
    });
});
