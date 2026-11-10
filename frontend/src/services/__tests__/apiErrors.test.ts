// --- FILE: frontend/src/services/__tests__/apiErrors.test.ts ---

import {describe, expect, it} from 'vitest';
import {formatErrorDetail} from '../apiErrors';

describe('formatErrorDetail', () => {
    it('returns a string detail as is', () => {
        expect(formatErrorDetail('Username already registered.', 'fallback')).toBe('Username already registered.');
    });

    it('joins pydantic validation messages without the "Value error" prefix', () => {
        const detail = [
            {loc: ['body', 'username'], msg: 'Value error, Имя не может смешивать латиницу и кириллицу'},
            {loc: ['body', 'password'], msg: 'String should have at least 8 characters'},
        ];
        expect(formatErrorDetail(detail, 'fallback')).toBe(
            'Имя не может смешивать латиницу и кириллицу; String should have at least 8 characters',
        );
    });

    it('falls back for unknown shapes', () => {
        expect(formatErrorDetail(undefined, 'Ошибка регистрации')).toBe('Ошибка регистрации');
        expect(formatErrorDetail([{}], 'Ошибка')).toBe('Ошибка');
    });
});
