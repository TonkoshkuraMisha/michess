import {describe, expect, it} from 'vitest';
import {Chess} from 'chess.js';
import {BASICS, progressId} from '../levels';
import {boardState, goalMove, goalReachable, rating, starsMove, starsPar, starsSolution} from '../rules';

const LESSON_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

describe('уровни азбуки', () => {
    it('8 разделов по 6–10 уровней, id прогресса подходит серверу', () => {
        expect(BASICS).toHaveLength(8);
        for (const section of BASICS) {
            expect(section.levels.length, section.id).toBeGreaterThanOrEqual(6);
            expect(section.levels.length, section.id).toBeLessThanOrEqual(10);
            expect(progressId(section.id)).toMatch(LESSON_ID);
        }
        expect(progressId('kingPawn')).toBe('basics-king-pawn');
    });

    for (const section of BASICS) {
        section.levels.forEach((level, i) => {
            it(`${section.id} #${i + 1} корректен`, () => {
                const game = new Chess(level.fen);
                if (level.kind === 'stars') {
                    expect(game.get(level.hero as never)?.color).toBe('w');
                    for (const star of level.stars) {
                        const piece = game.get(star as never);
                        if (section.id === 'capture') expect(piece?.color, star).toBe('b');
                        else expect(piece, star).toBeFalsy();
                    }
                    const solution = starsSolution(level);
                    expect(solution, JSON.stringify(level.stars)).not.toBeNull();
                    // Найденный кратчайший путь проходит по настоящим правилам (chess.js).
                    let fen = level.fen;
                    let hero = level.hero;
                    const left = new Set(level.stars);
                    for (const uci of solution!.path) {
                        const verdict = starsMove(fen, hero, uci, left);
                        expect(verdict.ok, uci).toBe(true);
                        if (!verdict.ok) return;
                        fen = verdict.fen;
                        hero = verdict.to;
                        left.delete(verdict.to);
                    }
                    expect(left.size).toBe(0);
                } else if (level.kind === 'goal') {
                    expect(goalReachable(level.fen, level.goal)).toBe(true);
                } else {
                    expect(boardState(level.fen)).toBeTruthy();
                }
            });
        });
    }
});

describe('правила азбуки', () => {
    it('минимум ходов ладьи и оценка', () => {
        expect(starsPar({fen: '7k/8/8/8/8/8/8/R6K w - - 0 1', hero: 'a1', stars: ['a6', 'f6']})).toBe(2);
        expect(rating(2, 2)).toBe(3);
        expect(rating(4, 2)).toBe(2);
        expect(rating(5, 2)).toBe(1);
    });

    it('под бой, чужой фигурой и взятие не по звезде — нельзя', () => {
        const fen = '7k/8/8/4b3/8/8/8/R6K w - - 0 1';
        expect(starsMove(fen, 'a1', 'a1b2', new Set())).toEqual({ok: false, reason: 'illegal'});
        expect(starsMove(fen, 'a1', 'a1d1', new Set()).ok).toBe(true);
        expect(starsMove('7k/8/8/8/8/8/8/R4b1K w - - 0 1', 'a1', 'a1f1', new Set())).toEqual({ok: false, reason: 'noCapture'});
        expect(starsMove(fen, 'a1', 'h1g1', new Set())).toEqual({ok: false, reason: 'wrongPiece'});
        expect(starsMove('7k/8/8/4b3/8/8/8/R6K w - - 0 1', 'a1', 'a1a3', new Set()).ok).toBe(true);
        expect(starsMove('7k/8/8/8/8/8/8/R2b3K w - - 0 1', 'a1', 'a1a4', new Set())).toEqual({ok: false, reason: 'danger'});
    });

    it('пешка превращается в ферзя и ходит дальше как ферзь', () => {
        const after = starsMove('7k/4P3/8/8/8/8/8/K7 w - - 0 1', 'e7', 'e7e8', new Set());
        expect(after.ok && new Chess(after.fen).get('e8')).toEqual({type: 'q', color: 'w'});
    });

    it('цели: мат, пат вместо мата, рокировка через бой невозможна', () => {
        expect(goalMove('7k/8/6K1/8/8/8/8/Q7 w - - 0 1', 'mate', 'a1a8').ok).toBe(true);
        expect(goalMove('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1', 'mate', 'f1f7')).toMatchObject({ok: false, reason: 'stalemate'});
        expect(goalMove('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1', 'castle', 'e1g1')).toMatchObject({ok: false, reason: 'illegal'});
        expect(goalMove('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1', 'castle', 'e1c1').ok).toBe(true);
        expect(goalMove('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'enpassant', 'e5d6').ok).toBe(true);
    });

    it('что на доске', () => {
        expect(boardState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBe('stalemate');
        expect(boardState('7k/7Q/6K1/8/8/8/8/8 b - - 0 1')).toBe('mate');
        expect(boardState('4k3/8/8/8/8/8/8/R3K3 b - - 0 1')).toBe('none');
        expect(boardState('R3k3/8/8/8/8/8/8/4K3 b - - 0 1')).toBe('check');
    });
});
