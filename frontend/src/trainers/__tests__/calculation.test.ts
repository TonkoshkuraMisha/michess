// Счёт и внимание (таск 19.7): шахи и взятия, исход размена, расстояния, правило квадрата, оценка позиции.

import {describe, expect, it} from 'vitest';
import {Chess} from 'chess.js';
import {
    captureGain, checksAndCaptures, distanceQuestion, evalVerdict, exchangeVerdict, kingCatchesPawn, kingDistance, knightDistance,
    squareFen, squareQuestion,
} from '../calculation';

describe('шахи и взятия', () => {
    it('за обе стороны, включая ту, что не ходит', () => {
        // Итальянская позиция, ход белых: Кxe5 — взятие; Сb5 — не шах (пешка d7 и конь c6 закрывают).
        const found = checksAndCaptures('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
        expect(found.has('f3e5')).toBe(true);
        expect(found.has('f1b5')).toBe(false);
        // После 1.e4 e5 — ни шахов, ни взятий.
        expect(checksAndCaptures('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2').size).toBe(0);
        // Ход белых, но шахи чёрных тоже считаются: Фe2+ — шах за чёрных; Крxd2 — взятие за белых.
        const both = checksAndCaptures('4k3/8/8/8/8/8/3q4/4K3 w - - 0 1');
        expect(both.has('e1d2')).toBe(true);
        expect(both.has('d2e2')).toBe(true);
        expect(both.has('d2a5')).toBe(true);    // Фa5+ — шах по диагонали
        expect(both.has('d2d5')).toBe(false);   // Фd5 — ни шаха, ни взятия
    });
});

describe('размен', () => {
    it('незащищённая фигура — выигрыш; защищённая пешкой — потеря; равный размен', () => {
        expect(captureGain('4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1', 'd5')).toBe(300);
        expect(exchangeVerdict(captureGain('4k3/8/4p3/3n4/8/8/8/3QK3 w - - 0 1', 'd5'))).toBe('lose');   // Фxd5 exd5
        expect(exchangeVerdict(captureGain('4k3/8/4p3/3n4/8/2N5/8/4K3 w - - 0 1', 'd5'))).toBe('equal'); // Кxd5 exd5
    });

    it('рентген: ладья за ладьёй поддерживает взятие', () => {
        // Белые: ладьи d1, d2; чёрные: конь d5 защищён ладьёй d8. Лxd5 Лxd5 Лxd5 — белые выигрывают коня.
        expect(captureGain('3rk3/8/8/3n4/8/8/3R4/3RK3 w - - 0 1', 'd5')).toBe(300);
    });
});

describe('расстояния и правило квадрата', () => {
    it('конь: a1→b3 — 1, a1→h8 — 6, a1→b2 — 4; король — по Чебышёву', () => {
        expect(knightDistance('a1', 'b3')).toBe(1);
        expect(knightDistance('a1', 'h8')).toBe(6);
        expect(knightDistance('a1', 'b2')).toBe(4);
        expect(kingDistance('a1', 'h8')).toBe(7);
        for (let i = 0; i < 50; i++) {
            const q = distanceQuestion(3, i);
            expect(q.answer).toBeGreaterThanOrEqual(q.piece === 'k' ? 0 : 1);
        }
    });

    it('правило квадрата: король в квадрате догоняет; ход пешки сдвигает квадрат; пешка со 2-й идёт на два поля', () => {
        expect(kingCatchesPawn('a4', 'e8', 'b')).toBe(true);    // король e8 до a8 — 4 хода, пешке — 4
        expect(kingCatchesPawn('a4', 'e8', 'w')).toBe(false);
        expect(kingCatchesPawn('a2', 'f8', 'b')).toBe(true);    // 5 ходов пешке (через a4), королю — 5
        expect(kingCatchesPawn('a2', 'g8', 'b')).toBe(false);
        for (let i = 0; i < 30; i++) {
            const q = squareQuestion(5, i);
            expect(() => new Chess(squareFen(q))).not.toThrow();
        }
    });

    it('оценка: перевес ≥ 1,5, равенство ≤ 0,6, между — не спрашиваем', () => {
        expect(evalVerdict(200)).toBe('white');
        expect(evalVerdict(-150)).toBe('black');
        expect(evalVerdict(40)).toBe('equal');
        expect(evalVerdict(100)).toBeNull();
    });
});
