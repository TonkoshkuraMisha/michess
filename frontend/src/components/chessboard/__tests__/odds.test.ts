// Игра с форой (таск 21.1): позиции материальных фор легальны и без нужной фигуры, фора по времени, кто даёт фору.

import {Chess} from 'chess.js';
import {describe, expect, it} from 'vitest';
import {giverColor, hasGiver, inviteOddsFields, ODDS, oddsFen, oddsTimes} from '../odds';

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

describe('партия с форой по сети (21.1)', () => {
    it('доска клиента восстанавливается из PGN сервера с заголовками SetUp/FEN', () => {
        const fen = oddsFen('queen', 'white')!;
        const start = new Chess();
        start.loadPgn(`[SetUp "1"]\n[FEN "${fen}"]`);
        expect(start.fen()).toBe(fen);
        const played = new Chess();
        played.loadPgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. e4 e5`);
        expect(played.history()).toEqual(['e4', 'e5']);
        expect(inviteOddsFields({kind: 'queen', giver: 'me'})).toEqual({odds_kind: 'queen', odds_giver: 'creator'});
        expect(inviteOddsFields({kind: 'hourglass', giver: 'me'}).odds_kind).toBe('hourglass');
        expect(inviteOddsFields({kind: 'none', giver: 'me'}).odds_kind).toBe('');
    });

    it('у «песочных часов» и «без форы» нет дающего', () => {
        expect(hasGiver('hourglass')).toBe(false);
        expect(hasGiver('none')).toBe(false);
        expect(hasGiver('time')).toBe(true);
    });
});
