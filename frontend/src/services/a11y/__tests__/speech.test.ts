// Доступность (таск 26.3): ход, клетка и позиция словами на трёх языках; переход фокуса стрелками.

import {Chess} from 'chess.js';
import {describe, expect, it} from 'vitest';
import {makeI18n} from '../../../i18n';
import {moveWords, positionWords, squareLabel, stepSquare} from '../speech';
import type {Translate, VerboseMove} from '../speech';

const ru = makeI18n('ru').t as Translate;
const en = makeI18n('en').t as Translate;

function lastMove(...sans: string[]): VerboseMove {
    const game = new Chess();
    sans.forEach((san) => game.move(san));
    return game.history({verbose: true}).at(-1) as VerboseMove;
}

describe('ходы словами', () => {
    it('обычный ход, взятие с шахом, рокировка', () => {
        expect(moveWords(lastMove('Nf3'), ru)).toBe('Белые: конь g1 — f3');
        expect(moveWords(lastMove('e4', 'd5', 'exd5'), ru)).toBe('Белые: пешка e4 берёт d5');
        expect(moveWords(lastMove('e4', 'f5', 'Qh5+'), ru)).toBe('Белые: ферзь d1 — h5, шах');
        expect(moveWords(lastMove('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O'), ru)).toBe('Белые: короткая рокировка');
        expect(moveWords(lastMove('f3', 'e5', 'g4', 'Qh4#'), en)).toBe('Black: queen d8 to h4, checkmate');
    });

    it('взятие на проходе и превращение', () => {
        expect(moveWords(lastMove('e4', 'a6', 'e5', 'd5', 'exd6'), ru)).toBe('Белые: пешка e5 берёт d6, взятие на проходе');
        const game = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
        game.move('a8=Q');
        expect(moveWords(game.history({verbose: true})[0] as VerboseMove, ru)).toBe('Белые: пешка a7 — a8, превращение в ферзя');
    });
});

describe('клетки и позиция', () => {
    it('подпись клетки; в игре вслепую фигура не называется', () => {
        expect(squareLabel('e4', {type: 'n', color: 'w'}, ru)).toBe('e4, белый конь');
        expect(squareLabel('e4', null, ru)).toBe('e4, пусто');
        expect(squareLabel('e4', {type: 'n', color: 'w'}, ru, true)).toBe('e4');
    });

    it('позиция по сторонам, от короля к пешкам', () => {
        const board = new Chess('4k3/8/8/8/8/8/1P2P3/4K2R w K - 0 1').board();
        expect(positionWords(board, ru)).toBe('Белые: король на e1; ладья на h1; пешка на b2, e2. Чёрные: король на e8.');
    });

    it('стрелки — по экрану: при перевёрнутой доске направления меняются; за краем — на месте', () => {
        expect(stepSquare('e4', 'ArrowUp', false)).toBe('e5');
        expect(stepSquare('e4', 'ArrowRight', false)).toBe('f4');
        expect(stepSquare('e4', 'ArrowUp', true)).toBe('e3');
        expect(stepSquare('e4', 'ArrowRight', true)).toBe('d4');
        expect(stepSquare('h8', 'ArrowUp', false)).toBe('h8');
        expect(stepSquare('a1', 'ArrowLeft', false)).toBe('a1');
    });
});
