// Доля ошибок слабых соперников мастерской — та же кривая, что на сервере (таск 10.5).

import {describe, expect, it} from 'vitest';
import {DEFAULT_CONFIG} from '../../services/personalities';
import {errorRate, strengthNote} from '../archetypes';

describe('сила соперника мастерской', () => {
    it('доля ошибок по кривой калибровки, между точками — линейно', () => {
        expect(errorRate(600)).toBeCloseTo(0.40);
        expect(errorRate(1000)).toBeCloseTo(0.22);
        expect(errorRate(1320)).toBeCloseTo(0.07);
        expect(errorRate(1450)).toBe(0);
        expect(errorRate(2000)).toBe(0);
    });

    it('подпись: ошибки до 1450, точная сила выше', () => {
        expect(strengthNote({...DEFAULT_CONFIG, target_elo: 1320})).toContain('7');
        expect(strengthNote({...DEFAULT_CONFIG, target_elo: 1500})).not.toMatch(/%/);
    });
});
