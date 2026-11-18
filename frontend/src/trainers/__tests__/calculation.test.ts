// Счёт и внимание (таск 19.7): шахи и взятия, исход размена, расстояния, правило квадрата, оценка позиции.

import {describe, expect, it} from 'vitest';
import {Chess} from 'chess.js';
import {
    captureGain, checksAndCaptures, distanceQuestion, evalVerdict, exchangeVerdict, kingCatchesPawn, kingDistance, knightDistance,
    squareFen, squareQuestion,
} from '../calculation';

/**
 * Независимая проверка правила квадрата перебором гонки: у белых только пешка (идёт вперёд, со 2-й — сразу на два
 * поля, если путь свободен), у чёрных — король (не встаёт под удар пешки). Король «догоняет», если берёт пешку или
 * нового ферзя (белый король далеко и не защищает) либо встаёт перед пешкой.
 */
function raceCatches(pawn: string, king: string, toMove: 'w' | 'b'): boolean {
    const files = 'abcdefgh';
    const f = files.indexOf(pawn[0]);
    const memo = new Map<string, boolean>();
    const search = (pr: number, kf: number, kr: number, white: boolean): boolean => {
        const key = `${pr}${kf}${kr}${white}`;
        if (memo.has(key)) return memo.get(key)!;
        let result: boolean;
        if (white) {
            const blocked = kf === f && kr === pr + 1;
            if (blocked) result = true;
            else {
                const next = pr === 2 && !(kf === f && kr === 4) ? 4 : pr + 1;
                result = search(next, kf, kr, false);
            }
        } else if (pr === 8) {
            result = Math.max(Math.abs(kf - f), Math.abs(kr - 8)) <= 1;  // бьёт ферзя
        } else if (Math.max(Math.abs(kf - f), Math.abs(kr - pr)) <= 1) {
            result = true;  // бьёт пешку
        } else {
            result = false;
            for (let df = -1; df <= 1 && !result; df++) {
                for (let dr = -1; dr <= 1 && !result; dr++) {
                    const nf = kf + df, nr = kr + dr;
                    if ((!df && !dr) || nf < 0 || nf > 7 || nr < 1 || nr > 8) continue;
                    if (nr === pr + 1 && Math.abs(nf - f) === 1) continue;  // под ударом пешки
                    result = search(pr, nf, nr, true);
                }
            }
        }
        memo.set(key, result);
        return result;
    };
    return search(Number(pawn[1]), files.indexOf(king[0]), Number(king[1]), toMove === 'w');
}

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
        // Позиция из отзыва владельца 18.11: 1.f7 Ke7 2.f8=Ф+ Kxf8 — догоняет.
        expect(kingCatchesPawn('f6', 'd6', 'w')).toBe(true);
        expect(kingCatchesPawn('a4', 'e8', 'w')).toBe(true);    // 1.a5 Kd7 2.a6 Kc7 3.a7 Kb7 4.a8=Ф+ Kxa8
        expect(kingCatchesPawn('a4', 'f8', 'w')).toBe(false);
        expect(kingCatchesPawn('a4', 'f8', 'b')).toBe(true);    // Ke7 — шаг в квадрат
        expect(kingCatchesPawn('a2', 'g8', 'b')).toBe(true);    // пешка со 2-й — квадрат от 3-й горизонтали
        expect(kingCatchesPawn('a2', 'h8', 'b')).toBe(false);
        // Сверка с перебором самой гонки на всех позициях, которые даёт тренажёр.
        for (let seed = 1; seed <= 6; seed++) {
            for (let i = 0; i < 40; i++) {
                const q = squareQuestion(seed, i);
                expect(q.answer, `${q.pawn} ${q.king} ${q.toMove}`).toBe(raceCatches(q.pawn, q.king, q.toMove));
            }
        }
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
