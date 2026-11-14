// Доля ошибок слабых соперников мастерской — та же кривая, что на сервере (таск 10.5).

import {describe, expect, it} from 'vitest';
import {DEFAULT_CONFIG} from '../../services/personalities';
import {errorRate, strengthNote} from '../archetypes';

describe('сила соперника мастерской', () => {
    it('доля ошибок по кривой калибровки — прямая до 1500', () => {
        expect(errorRate(600)).toBeCloseTo(0.43);
        expect(errorRate(1000)).toBeCloseTo(0.2389, 4);
        expect(errorRate(1320)).toBeCloseTo(0.086);
        expect(errorRate(1450)).toBeCloseTo(0.0239, 4);
        expect(errorRate(1500)).toBe(0);
        expect(errorRate(2000)).toBe(0);
    });

    it('подпись: ошибки до 1500, точная сила выше', () => {
        expect(strengthNote({...DEFAULT_CONFIG, target_elo: 1320})).toContain('9%');
        expect(strengthNote({...DEFAULT_CONFIG, target_elo: 1500})).not.toMatch(/%/);
    });
});
