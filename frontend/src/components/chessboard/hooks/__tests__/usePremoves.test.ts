// Цепочка предходов (таск B.2): позиция после предходов — фигуры переставлены без проверки правил.

import {Chess} from 'chess.js';
import {describe, expect, it} from 'vitest';
import {applyPremoves} from '../usePremoves';

describe('applyPremoves', () => {
    it('цепочка: конь f3, затем g5 — фигура берётся с поля после первого предхода', () => {
        const view = applyPremoves(new Chess(), [{from: 'g1', to: 'f3'}, {from: 'f3', to: 'g5'}]);
        expect(view.get('g5' as never)).toMatchObject({type: 'n', color: 'w'});
        expect(view.get('g1' as never)).toBeFalsy();
        expect(view.get('f3' as never)).toBeFalsy();
    });

    it('рокировка переносит ладью, превращение ставит выбранную фигуру', () => {
        const castle = applyPremoves(new Chess('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1'), [{from: 'e1', to: 'c1'}]);
        expect(castle.get('d1' as never)).toMatchObject({type: 'r'});
        expect(castle.get('a1' as never)).toBeFalsy();
        const promote = applyPremoves(new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), [{from: 'a7', to: 'a8', promotion: 'n'}]);
        expect(promote.get('a8' as never)).toMatchObject({type: 'n', color: 'w'});
    });

    it('предход с пустого поля пропускается, исходная партия не меняется', () => {
        const game = new Chess();
        const view = applyPremoves(game, [{from: 'e4', to: 'e5'}]);
        expect(view.fen()).toBe(game.fen());
    });
});
