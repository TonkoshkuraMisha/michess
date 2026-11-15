// Генераторы тренажёров видения (таск 16.5): детерминированы по seed, каждый уровень решаем.

import {describe, expect, it} from 'vitest';
import {Chess} from 'chess.js';
import {starsMove} from '../../content/basics/rules';
import {starsSolution} from '../../content/basics/rules';
import {forkCount, forkLevel, isSafe, knightTargets, pathLevel, pathScore, rng} from '../vision';

describe('генераторы тренажёров видения', () => {
    it('одинаковый seed — одинаковый уровень', () => {
        expect(pathLevel('quiet', 5, 42)).toEqual(pathLevel('quiet', 5, 42));
        expect(forkLevel(3, 7)).toEqual(forkLevel(3, 7));
        expect(rng(1)()).toBe(rng(1)());
    });

    for (const kind of ['quiet', 'knight'] as const) {
        it(`${kind}: уровни 1–10 решаемы, кратчайший путь проходит по правилам`, () => {
            for (let level = 1; level <= 10; level++) {
                for (let seed = 1; seed <= 5; seed++) {
                    const l = pathLevel(kind, level, seed);
                    expect(() => new Chess(l.fen)).not.toThrow();
                    const solution = starsSolution({fen: l.fen, hero: l.hero, stars: [l.target]})!;
                    expect(solution.par).toBe(l.par);
                    let fen = l.fen;
                    let hero = l.hero;
                    for (const uci of solution.path) {
                        const verdict = starsMove(fen, hero, uci, new Set([l.target]));
                        expect(verdict.ok).toBe(true);
                        if (!verdict.ok) return;
                        fen = verdict.fen;
                        hero = verdict.to;
                    }
                    expect(hero).toBe(l.target);
                    if (kind === 'knight') expect(new Chess(l.fen).get(l.hero as never)?.type).toBe('n');
                }
            }
        });
    }

    it('двойной удар: ответы — ходы коня на вилку, с 4-го уровня — безопасные', () => {
        for (let level = 1; level <= 8; level++) {
            for (let seed = 1; seed <= 5; seed++) {
                const l = forkLevel(level, seed);
                expect(l.answers.length).toBeGreaterThan(0);
                for (const square of l.answers) {
                    expect(knightTargets(l.knight)).toContain(square);
                    expect(forkCount(l.fen, square)).toBeGreaterThanOrEqual(2);
                    if (l.safeOnly) expect(isSafe(l.fen, square)).toBe(true);
                }
            }
        }
    });

    it('очки за путь', () => {
        expect(pathScore(3, 3)).toBe(100);
        expect(pathScore(4, 3)).toBe(75);
        expect(pathScore(10, 3)).toBe(0);
    });
});
