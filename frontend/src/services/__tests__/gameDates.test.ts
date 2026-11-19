// --- FILE: frontend/src/services/__tests__/gameDates.test.ts ---
// Дата партии для списков и просмотра (services/gameDates.ts): неизвестные части PGN-даты убираются, неизвестный
// год — даты из PGN нет, тогда берётся время окончания партии; нет ничего — null (текст выбирает вызывающий).

import {describe, expect, it} from 'vitest';
import {enUS} from 'date-fns/locale';
import {gameDisplayDate, pgnDisplayDate} from '../gameDates';

describe('дата партии', () => {
    it('PGN: неизвестные месяц и день убираются', () => {
        expect(pgnDisplayDate('1860.??.??')).toBe('1860');
        expect(pgnDisplayDate('1972.07.??')).toBe('1972.07');
        expect(pgnDisplayDate('2024.03.15')).toBe('2024.03.15');
    });

    it('PGN: неизвестный год или пустая дата — даты нет', () => {
        expect(pgnDisplayDate('????.??.??')).toBeNull();
        expect(pgnDisplayDate(null)).toBeNull();
        expect(pgnDisplayDate('')).toBeNull();
    });

    it('без даты в PGN — время окончания партии на языке игрока', () => {
        expect(gameDisplayDate('????.??.??', '2026-11-19T12:00:00Z', enUS)).toBe('19 Nov 2026');
        expect(gameDisplayDate(null, '2026-11-19T12:00:00Z', enUS)).toBe('19 Nov 2026');
    });

    it('дата из PGN важнее времени окончания; нет ничего — null', () => {
        expect(gameDisplayDate('1860.??.??', '2026-11-19T12:00:00Z', enUS)).toBe('1860');
        expect(gameDisplayDate(null, null, enUS)).toBeNull();
    });
});
