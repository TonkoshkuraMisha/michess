// Часы партии: точное время идёт каждые 50 мс, а перерисовка — только когда меняются цифры на часах
// (раньше весь Chessboard перерисовывался 20 раз в секунду).

import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {displayBucket, formatTime, useClock} from '../useClock';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function clock(initialMs: number) {
    let renders = 0;
    const hook = renderHook(() => {
        renders += 1;
        return useClock({isTicking: true, isParticipant: true, currentTurn: 'white', myColor: 'white', onLowTime: vi.fn()});
    });
    act(() => hook.result.current.setWhiteTimeMs(initialMs));
    const before = renders;
    return {hook, rendersSince: () => renders - before};
}

/** Тики по одному, каждый в своём act(): иначе React объединил бы все обновления в одну перерисовку. */
function tickFor(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
        act(() => {
            vi.advanceTimersByTime(50);
        });
    }
}

describe('useClock', () => {
    it('вне цейтнота — перерисовка раз в секунду, а не каждые 50 мс', () => {
        const {hook, rendersSince} = clock(60_000);
        tickFor(3_000);
        expect(rendersSince()).toBeLessThanOrEqual(4);  // было 60: каждый тик 50 мс
        expect(formatTime(hook.result.current.whiteTimeMs)).toBe('00:57');
    });

    it('в цейтноте — десятые, перерисовка раз в 100 мс', () => {
        const {hook, rendersSince} = clock(10_000);
        tickFor(1_000);
        expect(rendersSince()).toBeGreaterThanOrEqual(9);
        expect(rendersSince()).toBeLessThanOrEqual(11);
        expect(formatTime(hook.result.current.whiteTimeMs)).toBe('00:09.0');
    });

    it('флаг падает ровно в ноль, добавление учитывает точное время', () => {
        const {hook} = clock(1_000);
        act(() => {
            vi.advanceTimersByTime(1_500);
        });
        expect(hook.result.current.whiteTimeMs).toBe(0);

        act(() => hook.result.current.setWhiteTimeMs(60_400));
        act(() => {
            vi.advanceTimersByTime(300);  // цифры не изменились (00:60 → 00:60), состояние не обновлялось
        });
        act(() => hook.result.current.applyIncrement('white', 2));
        expect(hook.result.current.whiteTimeMs).toBe(62_100);  // 60 400 − 300 + 2 000 — от точного времени
    });

    it('шаг отображения совпадает с formatTime', () => {
        expect(displayBucket(30_000)).not.toBe(displayBucket(29_999));
        expect(displayBucket(45_100)).toBe(displayBucket(45_900));
        expect(displayBucket(5_150)).toBe(displayBucket(5_199));
        expect(displayBucket(5_150)).not.toBe(displayBucket(5_050));
    });
});
