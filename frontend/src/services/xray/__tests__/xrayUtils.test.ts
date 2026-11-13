// «Рентген» доски (таск 12.1): расчёты на известных позициях.

import {Chess} from 'chess.js';
import {describe, expect, it, vi} from 'vitest';
import {
    attackMap, captures, checks, controlMap, defenses, destinationSafety, gameFor, hangingPieces, legalMoves,
    lineTactics, overloadedDefenders, pawnFlags, piecesOf, xrayFor,
} from '../xrayUtils';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('контроль полей', () => {
    it('начальная позиция: третья горизонталь — у белых, шестая — у чёрных, симметрично', () => {
        const control = controlMap(piecesOf(START));
        expect(control.get('e3')).toEqual({white: 2, black: 0});
        expect(control.get('f3')).toEqual({white: 3, black: 0});
        expect(control.get('f6')).toEqual({white: 0, black: 3});
        expect(control.get('e4')).toEqual({white: 0, black: 0});
        const total = (color: 'white' | 'black') => [...control.values()].reduce((sum, c) => sum + c[color], 0);
        expect(total('white')).toBe(total('black'));
    });

    it('батарея: ферзь за ладьёй бьёт поля за ладьёй', () => {
        const pieces = piecesOf('4k3/8/8/8/8/8/4R3/4Q1K1 w - - 0 1');
        const e7 = attackMap(pieces).get('e7') ?? [];
        expect(e7.map((a) => [a.from, a.xray])).toEqual(expect.arrayContaining([['e2', false], ['e1', true]]));
        expect(controlMap(pieces).get('e7')?.white).toBe(2);
    });

    it('без батареи: чужая фигура закрывает линию', () => {
        const pieces = piecesOf('4k3/8/8/8/8/4n3/4R3/4Q1K1 w - - 0 1');
        expect(controlMap(pieces).get('e5')?.white).toBe(0);
    });
});

describe('фигуры под ударом и перегрузка', () => {
    it('незащищённая фигура и фигура, которую бьёт более дешёвая', () => {
        // Конь d5 не защищён и под ударом пешки e6; слон c4 защищён, но под ударом пешки b5.
        const pieces = piecesOf('4k3/8/4p3/1p1N4/2B5/8/3P4/4K3 w - - 0 1');
        expect(hangingPieces(pieces, 'w').sort()).toEqual(['c4', 'd5']);
        expect(hangingPieces(pieces, 'b')).toEqual(['b5']);
    });

    it('защищённая фигура под ударом равноценной — не висит', () => {
        // Конь e3 защищён пешкой d2 и атакован конём d5 — размен, не выигрыш.
        const pieces = piecesOf('4k3/8/8/3n4/8/4N3/3P4/4K3 w - - 0 1');
        expect(hangingPieces(pieces, 'w')).toEqual([]);
    });

    it('перегруженный защитник: одна ладья защищает две атакованные фигуры', () => {
        // Ладья d1 защищает коня d4 и слона b1; перегружена, только когда атакованы обе фигуры.
        const pieces = piecesOf('3rk3/8/8/8/3N4/8/8/1B1R2K1 b - - 0 1');
        const pieces2 = piecesOf('4k3/8/8/8/r2N4/8/8/rB1R2K1 b - - 0 1');
        expect(overloadedDefenders(pieces, 'w')).toEqual([]);
        expect(overloadedDefenders(pieces2, 'w')).toEqual([{defender: 'd1', duties: expect.arrayContaining(['d4', 'b1'])}]);
    });
});

describe('связки и сквозные удары', () => {
    it('абсолютная связка слоном', () => {
        const lines = lineTactics(piecesOf('4k3/8/2n5/8/B7/8/8/4K3 w - - 0 1'), 'w');
        expect(lines).toEqual([{kind: 'pin', attacker: 'a4', front: 'c6', behind: 'e8', absolute: true}]);
    });

    it('связка ферзя с ладьёй — относительная', () => {
        const lines = lineTactics(piecesOf('r3k3/8/8/8/n7/8/8/R3K3 w - - 0 1'), 'w');
        expect(lines).toEqual([{kind: 'pin', attacker: 'a1', front: 'a4', behind: 'a8', absolute: false}]);
    });

    it('сквозной удар: король впереди, ферзь за ним', () => {
        const skewer = lineTactics(piecesOf('4q3/8/8/4k3/8/8/8/K3R3 w - - 0 1'), 'w');
        expect(skewer).toEqual([{kind: 'skewer', attacker: 'e1', front: 'e5', behind: 'e8', absolute: true}]);
        // Ферзь впереди слабее нападающего не считается: ладья против ферзя за ладьёй — не сквозной удар.
        expect(lineTactics(piecesOf('4r3/8/8/4q3/8/8/8/K3Q2k w - - 0 1'), 'w')).toEqual([]);
    });

    it('своя фигура на линии — ни связки, ни удара', () => {
        expect(lineTactics(piecesOf('4k3/8/2n5/1P6/B7/8/8/4K3 w - - 0 1'), 'w')).toEqual([]);
    });
});

describe('ходы, взятия, защиты, шахи', () => {
    it('взятие: незащищённой фигуры — выигрыш, защищённой равноценной — размен', () => {
        const fen = '4k3/8/8/3n1b2/8/4N3/8/4K3 w - - 0 1';
        const list = captures(fen, 'w');
        expect(list).toEqual(expect.arrayContaining([
            {from: 'e3', to: 'd5', kind: 'winning'},
            {from: 'e3', to: 'f5', kind: 'winning'},
        ]));
        const defended = captures('4k3/8/4p3/3n4/8/4N3/8/4K3 w - - 0 1', 'w');
        expect(defended).toEqual([{from: 'e3', to: 'd5', kind: 'exchange'}]);
    });

    it('взятия за сторону, которая не ходит', () => {
        expect(captures('4k3/8/8/3n4/8/4N3/8/4K3 w - - 0 1', 'b')).toEqual([{from: 'd5', to: 'e3', kind: 'winning'}]);
    });

    it('защиты: пешки и фигуры прикрывают свои', () => {
        const list = defenses(piecesOf(START), 'w');
        expect(list).toContainEqual({from: 'e1', to: 'e2'});
        expect(list).toContainEqual({from: 'g1', to: 'e2'});
        expect(list.some((a) => a.to === 'e1')).toBe(false);
    });

    it('шахи и мат', () => {
        const list = checks('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'w');
        expect(list).toEqual([{from: 'a1', to: 'a8', mate: true}]);
        expect(checks(START, 'w')).toEqual([]);
    });

    it('все ходы начальной позиции — 20, превращение — одна стрелка', () => {
        expect(legalMoves(START, 'w')).toHaveLength(20);
        expect(legalMoves('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'w').filter((m) => m.from === 'a7')).toHaveLength(1);
    });

    it('невозможная позиция для другой стороны — пусто, а не ошибка', () => {
        // Белые дают шах; если бы ходили чёрные — нормально, а ход белых при шахе чёрному королю невозможен.
        const fen = '4k3/4Q3/8/8/8/8/8/4K3 b - - 0 1';
        expect(gameFor(fen, 'w')).toBeNull();
        expect(legalMoves(fen, 'w')).toEqual([]);
    });
});

describe('пешки', () => {
    it('изолированные и проходные', () => {
        const flags = pawnFlags(piecesOf('4k3/p7/8/3P4/8/8/6PP/4K3 w - - 0 1'), 'w');
        expect(flags.isolated).toEqual(['d5']);
        expect(flags.passed.sort()).toEqual(['d5', 'g2', 'h2']);
        expect(pawnFlags(piecesOf('4k3/p7/8/3P4/8/8/6PP/4K3 w - - 0 1'), 'b').passed).toEqual(['a7']);
    });
});

describe('безопасность полей для фигуры', () => {
    it('конь: поле под пешкой — опасно, свободное — безопасно', () => {
        const list = destinationSafety('4k3/8/8/8/3p4/8/8/4KN2 w - - 0 1', 'f1');
        const byTarget = Object.fromEntries(list.map((s) => [s.square, s.safe]));
        expect(byTarget.e3).toBe(false);
        expect(byTarget.g3).toBe(true);
        expect(byTarget.d2).toBe(true);
    });

    it('пустое поле — ничего', () => {
        expect(destinationSafety(START, 'e4')).toEqual([]);
    });
});

describe('полный рентген', () => {
    it('собирает всё; ходы chess.js генерируются один раз на расчёт', () => {
        const fen = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP1B1PPP/R2QKB1R w KQ - 0 8';
        const spy = vi.spyOn(Chess.prototype, 'moves');
        const report = xrayFor(fen, 'w');
        xrayFor(fen, 'b');
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
        expect(report.control.size).toBe(64);
        expect(report.moves.length).toBeGreaterThan(20);
    });

    it('пересчёт на каждый ход незаметен', () => {
        // Отдельно ~3 мс; грубая граница — с запасом на параллельный прогон с покрытием.
        const fen = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP1B1PPP/R2QKB1R w KQ - 0 8';
        const startedAt = performance.now();
        for (let i = 0; i < 20; i++) xrayFor(fen, i % 2 ? 'b' : 'w');
        expect((performance.now() - startedAt) / 20).toBeLessThan(50);
    });
});
