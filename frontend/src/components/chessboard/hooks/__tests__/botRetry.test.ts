import {describe, expect, it} from 'vitest';
import {botRetryDelayMs, isPermanentBotError} from '../useBotGame';

describe('повторы хода бота', () => {
    it('повторяются только временные ошибки', () => {
        for (const status of [400, 401, 404, 422]) expect(isPermanentBotError(status)).toBe(true);
        for (const status of [408, 429, 500, 502, 503, 504]) expect(isPermanentBotError(status)).toBe(false);
    });

    it('пауза растёт 1 → 2 → 4 → 8 с и дальше не растёт', () => {
        expect([0, 1, 2, 3, 4, 10].map((attempt) => botRetryDelayMs(attempt, null)))
            .toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
    });

    it('Retry-After сервера важнее, но не больше 10 с', () => {
        const withRetryAfter = (value: string) => ({headers: new Headers({'Retry-After': value})}) as Response;
        expect(botRetryDelayMs(0, withRetryAfter('3'))).toBe(3000);
        expect(botRetryDelayMs(0, withRetryAfter('120'))).toBe(10000);
        expect(botRetryDelayMs(2, withRetryAfter('abc'))).toBe(4000);
    });
});
