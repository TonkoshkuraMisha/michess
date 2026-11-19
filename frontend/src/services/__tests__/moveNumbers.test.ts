// --- FILE: frontend/src/services/__tests__/moveNumbers.test.ts ---
// Запись ходов с номерами (services/moveNumbers.ts): с начальной позиции и из своей позиции, где первым ходят чёрные.

import {describe, expect, it} from 'vitest';
import {numberedMoves} from '../moveNumbers';

describe('ходы с номерами', () => {
    it('с начальной позиции — номер у хода белых', () => {
        expect(numberedMoves(['e4', 'c6', 'd4'])).toEqual(['1. e4', 'c6', '2. d4']);
        expect(numberedMoves([])).toEqual([]);
    });

    it('из своей позиции — номер из FEN, первый ход чёрных с многоточием', () => {
        const blackToMove = '6k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 12';
        expect(numberedMoves(['Kf8', 'Kf1', 'Ke7'], blackToMove)).toEqual(['12… Kf8', '13. Kf1', 'Ke7']);
        const whiteToMove = '6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 30';
        expect(numberedMoves(['Kf1', 'Kf8'], whiteToMove)).toEqual(['30. Kf1', 'Kf8']);
    });
});
