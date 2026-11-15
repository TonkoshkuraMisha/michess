// Партии мастеров (таск 14.7): данные партий корректны, а каждый ход, упомянутый в текстах («33.Nxg5», «37...Rxf1+»),
// совпадает с ходом партии под этим номером — тексты не могут разойтись с партией.

import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {Chess} from 'chess.js';
import type {ClassicGame} from '../index';
import {scoreStop} from '../index';

const DIR = join(__dirname, '..');
const GAMES: ClassicGame[] = readdirSync(DIR).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf-8')) as ClassicGame);
const MOVE_REF = /(\d+)(\.\.\.|\.)(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)([+#]?)/g;

function sans(game: ClassicGame): string[] {
    const chess = new Chess();
    return game.moves.map((uci) => chess.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]}).san);
}

describe('партии мастеров с объяснениями', () => {
    it('тридцать партий', () => {
        expect(GAMES).toHaveLength(30);
        expect(new Set(GAMES.map((g) => g.id)).size).toBe(30);
    });

    for (const game of GAMES) {
        it(`${game.id}: ходы, оценки, остановки, тексты`, () => {
            const list = sans(game);
            expect(game.evals).toHaveLength(list.length);
            for (const key of Object.keys(game.comments)) expect(Number(key)).toBeLessThan(list.length);
            for (const stop of game.stops) {
                expect(stop.move).toBe(game.moves[stop.ply]);
                expect(scoreStop(stop, stop.move).score).toBe(100);
            }
            for (const part of ['intro', 'summary'] as const) {
                for (const language of ['en', 'uk', 'ru'] as const) {
                    const text = game[part][language];
                    expect(text.length, `${part}.${language}`).toBeGreaterThan(40);
                    for (const [, number, dots, san, suffix] of text.matchAll(MOVE_REF)) {
                        const ply = (Number(number) - 1) * 2 + (dots === '...' ? 1 : 0);
                        expect(`${number}${dots}${list[ply]}`, `${part}.${language}`).toBe(`${number}${dots}${san}${suffix}`);
                    }
                }
            }
        });
    }

    it('баллы на остановке — как в «Угадай ход мастера»', () => {
        const stop = {ply: 0, move: 'e2e4', best_cp: 50, gap_cp: 200, lines: [['e2e4', 50], ['d2d4', 30], ['a2a3', -150]] as [string, number][]};
        expect(scoreStop(stop, 'e2e4')).toEqual({score: 100, loss: 0});
        expect(scoreStop(stop, 'd2d4')).toEqual({score: 80, loss: 20});
        expect(scoreStop(stop, 'a2a3')).toEqual({score: 46, loss: 200});
        expect(scoreStop(stop, 'h2h3')).toEqual({score: 36, loss: 250});
    });
});
