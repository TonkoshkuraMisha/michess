// --- FILE: frontend/src/components/chessboard/hooks/useClock.ts ---

import {useCallback, useEffect, useRef, useState} from 'react';

export type ClockColor = 'white' | 'black';

export interface UseClockOptions {
    /** Часы идут визуально (игрок, бот, зритель) — партия активна и не завершена. */
    isTicking: boolean;
    /**
     * Звуковое предупреждение о цейтноте играет только участнику партии, а не зрителю —
     * это условие уже строго хуже isTicking, поэтому передаётся отдельно.
     */
    isParticipant: boolean;
    currentTurn: ClockColor;
    myColor: ClockColor;
    onLowTime: () => void;
}

export interface UseClockResult {
    whiteTimeMs: number;
    blackTimeMs: number;
    setWhiteTimeMs: React.Dispatch<React.SetStateAction<number>>;
    setBlackTimeMs: React.Dispatch<React.SetStateAction<number>>;
    /** Сбрасывает флаг «предупреждение уже проиграно» — перед новой партией. */
    resetLowTimeWarning: () => void;
    /** Добавляет бонус Фишера победившей ходом стороне. */
    applyIncrement: (moverColor: ClockColor, incrementSeconds: number) => void;
}

/**
 * Часы партии: тиканье раз в 50мс от стороны, которая сейчас ходит, звуковое предупреждение
 * о цейтноте (<10с, один раз за партию) и начисление добавления за ход. Не знает ничего о
 * источнике партии (PvP/бот/зритель) — только о том, идут ли часы и чей сейчас ход.
 */
export function useClock({isTicking, isParticipant, currentTurn, myColor, onLowTime}: UseClockOptions): UseClockResult {
    const [whiteTimeMs, setWhiteTimeMs] = useState(180000);
    const [blackTimeMs, setBlackTimeMs] = useState(180000);
    const lowTimeWarnedRef = useRef(false);

    useEffect(() => {
        if (!isTicking) return;

        let lastTick = Date.now();

        const interval = setInterval(() => {
            const now = Date.now();
            const delta = now - lastTick;
            lastTick = now;

            if (currentTurn === 'white') {
                setWhiteTimeMs(prev => Math.max(0, prev - delta));
            } else {
                setBlackTimeMs(prev => Math.max(0, prev - delta));
            }
        }, 50);

        return () => clearInterval(interval);
    }, [isTicking, currentTurn]);

    // Звуковое предупреждение о цейтноте (< 10 секунд на часах игрока)
    useEffect(() => {
        if (!isParticipant || lowTimeWarnedRef.current) return;
        const myRemainingMs = myColor === 'white' ? whiteTimeMs : blackTimeMs;
        if (myRemainingMs > 0 && myRemainingMs <= 10000) {
            lowTimeWarnedRef.current = true;
            onLowTime();
        }
    }, [whiteTimeMs, blackTimeMs, isParticipant, myColor, onLowTime]);

    const resetLowTimeWarning = useCallback(() => {
        lowTimeWarnedRef.current = false;
    }, []);

    const applyIncrement = useCallback((moverColor: ClockColor, incrementSeconds: number) => {
        const incMs = Math.round(incrementSeconds * 1000);
        if (moverColor === 'white') {
            setWhiteTimeMs(prev => prev + incMs);
        } else {
            setBlackTimeMs(prev => prev + incMs);
        }
    }, []);

    return {whiteTimeMs, blackTimeMs, setWhiteTimeMs, setBlackTimeMs, resetLowTimeWarning, applyIncrement};
}

/** Форматирует остаток времени как m:ss (или h:mm:ss), с десятыми при цейтноте < 30 с. */
export function formatTime(ms: number): string {
    const totalMs = Math.max(0, ms);
    const totalSecs = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    if (hours > 0) {
        return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    if (totalMs < 30000 && totalMs > 0) {
        const tenths = Math.floor((totalMs % 1000) / 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
    }

    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
