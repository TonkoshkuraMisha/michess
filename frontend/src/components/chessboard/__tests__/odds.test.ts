// Игра с форой (таск 21.1): позиции материальных фор легальны и без нужной фигуры, фора по времени, кто даёт фору.

import {Chess} from 'chess.js';
import {describe, expect, it} from 'vitest';
import {giverColor, ODDS, oddsFen, oddsTimes} from '../odds';

describe('форы', () => {
    it('материальные форы: позиция легальна, фигуры нет, рокировка с убранной ладьёй пропадает', () => {
        expect(oddsFen('knight', 'white')).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKBNR w KQkq - 0 1');
        expect(oddsFen('rook', 'black')).toBe('1nbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQk - 0 1');
        expect(oddsFen('queen', 'black')).toBe('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        expect(oddsFen('pawn', 'black')).toBe('rnbqkbnr/ppppp1pp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        for (const kind of ODDS) {
            for (const giver of ['white', 'black'] as const) {
                const fen = oddsFen(kind, giver);
                if (fen) expect(new Chess(fen).moves().length).toBeGreaterThan(0);
            }
        }
        expect(oddsFen('time', 'white')).toBeNull();
        expect(oddsFen('hourglass', 'white')).toBeNull();
    });

    it('фора по времени — треть часов, не меньше минуты; кто даёт фору', () => {
        expect(oddsTimes('time', 'white', 300_000, 300_000)).toEqual({white: 100_000, black: 300_000});
        expect(oddsTimes('time', 'black', 120_000, 120_000)).toEqual({white: 120_000, black: 60_000});
        expect(oddsTimes('knight', 'white', 300_000, 300_000)).toEqual({white: 300_000, black: 300_000});
        expect(giverColor('me', 'black')).toBe('black');
        expect(giverColor('opponent', 'black')).toBe('white');
    });
});
