// «Хвост» (таск 16.5): рост хвоста, запрет хода на хвост и под бой, укус хвоста, детерминированность, конец игры.

import {describe, expect, it} from 'vitest';
import {attacked, boardFen, legalMoves, newGame, spawnEvery, step} from '../tail';
import type {TailState} from '../tail';

function base(extra: Partial<TailState> = {}): TailState {
    return {hero: 'N', head: 'd4', tail: [], food: 'e6', enemies: {}, eaten: 0, moves: 0, over: false, seed: 1, level: 1, ...extra};
}

describe('Хвост', () => {
    it('съеденная пешка — хвост на поле, откуда пришла голова; новая пешка появляется', () => {
        const next = step(base(), 'e6')!;
        expect(next.head).toBe('e6');
        expect(next.tail).toEqual(['d4']);
        expect(next.eaten).toBe(1);
        expect(next.food).not.toBe('e6');
        const moved = step({...next, food: 'h1'}, 'c5')!;          // без еды хвост тянется, но не растёт
        expect(moved.tail).toEqual(['e6']);
    });

    it('на свой хвост и под бой ходить нельзя; дальнобойная голова не проходит сквозь хвост', () => {
        const knight = base({tail: ['e6']});
        expect(legalMoves(knight)).not.toContain('e6');
        expect(step(knight, 'e6')).toBeNull();
        const guarded = base({enemies: {f8: 'n'}, food: 'h8'});   // конь f8 бьёт e6
        expect(legalMoves(guarded)).not.toContain('e6');
        const rook = base({hero: 'R', head: 'a1', tail: ['a3'], food: 'h8'});
        expect(legalMoves(rook)).toContain('a2');
        expect(legalMoves(rook)).not.toContain('a4');
    });

    it('фигура соперника откусывает хвост с ближайшего побитого поля', () => {
        const state = base({head: 'a1', tail: ['b3', 'c5', 'd7'], food: 'h1', enemies: {e3: 'r'}, moves: 0});
        // Ход головы a1→c2: хвост сдвигается (a1, b3, c5), ладья e3 бьёт по третьей горизонтали b3 → хвост до b3 отрезан.
        const next = step(state, 'c2')!;
        expect(next.tail).toEqual(['a1']);
        expect(attacked(next).has('b3')).toBe(true);
    });

    it('соперники появляются по расписанию и не нападают на голову', () => {
        let state = newGame(4, 9);
        let spawned = 0;
        for (let i = 0; i < 40 && !state.over; i++) {
            const moves = legalMoves(state);
            const target = moves.includes(state.food) ? state.food : moves[0];
            const before = Object.keys(state.enemies).length;
            state = step(state, target)!;
            if (state.moves % spawnEvery(4) === 0) {
                expect(Object.keys(state.enemies).length >= before).toBe(true);
                spawned++;
            }
            expect(attacked(state).has(state.head)).toBe(false);
        }
        expect(spawned).toBeGreaterThan(0);
    });

    it('одинаковый seed — одинаковая игра; позиция для доски', () => {
        expect(newGame(3, 5)).toEqual(newGame(3, 5));
        const state = base({tail: ['c2'], enemies: {h8: 'r'}});
        expect(boardFen(state)).toBe('7r/8/4p3/8/3N4/8/2N5/8 w - - 0 1');
    });

    it('без ходов игра окончена', () => {
        // Конь в углу: оба хода закрыты хвостом.
        const trapped = step(base({head: 'b3', tail: [], food: 'a1', enemies: {}}), 'a1');
        expect(trapped).not.toBeNull();
        const stuck: TailState = base({head: 'a1', tail: ['b3', 'c2'], food: 'h8'});
        expect(legalMoves(stuck)).toEqual([]);
    });
});
