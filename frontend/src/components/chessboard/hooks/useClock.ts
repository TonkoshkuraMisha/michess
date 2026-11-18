// --- FILE: frontend/src/components/chessboard/hooks/useClock.ts ---
// Часы партии на главной доске. Хук только ведёт обратный отсчёт у стороны, которая ходит. Откуда берётся время:
// в партии с человеком и у зрителя — с сервера (white_time_ms и black_time_ms в событиях match_found, move_made,
// berserk, game_over; useGameSocket ставит их через setWhiteTimeMs и setBlackTimeMs), между событиями часы идут
// локально и каждый ход сверяются с сервером; флаг в такой партии фиксирует сервер. В партии с ботом часы целиком
// на клиенте: начальное время и добавку ставит useBotGame, он же объявляет поражение по времени.

import {useCallback, useEffect, useRef, useState} from 'react';

export type ClockColor = 'white' | 'black';

export interface UseClockOptions {
    /** Часы идут визуально (игрок, бот, зритель) — партия активна и не завершена. */
    isTicking: boolean;
    /**
     * Звуковое предупреждение о цейтноте играет только участнику партии, а не зрителю —
     * это условие строже, чем isTicking (у зрителя часы идут, а звука нет), поэтому передаётся отдельно.
     */
    isParticipant: boolean;
    currentTurn: ClockColor;
    myColor: ClockColor;
    onLowTime: () => void;
    /** «Песочные часы» (фора, таск 21.1): время, которое тратит ходящий, прибавляется сопернику. */
    hourglass?: boolean;
}

export interface UseClockResult {
    whiteTimeMs: number;
    blackTimeMs: number;
    setWhiteTimeMs: React.Dispatch<React.SetStateAction<number>>;
    setBlackTimeMs: React.Dispatch<React.SetStateAction<number>>;
    /** Сбрасывает флаг «предупреждение уже проиграно» — перед новой партией. */
    resetLowTimeWarning: () => void;
    /**
     * Добавка за ход стороне, которая его сделала (отрицательное значение снимает добавку — при возврате хода).
     * Нужна только партии с ботом: в партии с человеком время после хода присылает сервер уже с добавкой.
     */
    applyIncrement: (moverColor: ClockColor, incrementSeconds: number) => void;
}

/**
 * Шаг, с которым меняются цифры на часах (как в formatTime): секунды, а в цейтноте (< 30 с) — десятые.
 * В состояние React время попадает, только когда меняется видимое значение: раньше каждые 50 мс
 * перерисовывался весь Chessboard — доска, журнал ходов, панели (20 раз в секунду на любой партии).
 */
export function displayBucket(ms: number): number {
    const value = Math.max(0, ms);
    return value >= 30000 ? Math.floor(value / 1000) : -1 - Math.floor(value / 100);
}

/** Точное время в ref, в состоянии — его копия на шаге отображения; сеттер меняет оба. */
function useClockValue(initial: number) {
    const exactRef = useRef(initial);
    const [shown, setShown] = useState(initial);
    const set: React.Dispatch<React.SetStateAction<number>> = useCallback((value) => {
        const next = typeof value === 'function' ? value(exactRef.current) : value;
        exactRef.current = next;
        setShown(next);
    }, []);
    /** Тик часов: точное время меняется всегда, состояние — только когда меняются цифры на часах. */
    const tick = useCallback((delta: number) => {
        const before = exactRef.current;
        const after = Math.max(0, before - delta);
        exactRef.current = after;
        if (displayBucket(after) !== displayBucket(before) || after === 0) setShown(after);
    }, []);
    return [shown, set, tick] as const;
}

/**
 * Часы партии: тиканье раз в 50мс от стороны, которая сейчас ходит, звуковое предупреждение
 * о цейтноте (не больше 10 с, один раз за партию) и начисление добавки за ход. Не знает ничего об
 * источнике партии (PvP/бот/зритель) — только о том, идут ли часы и чей сейчас ход. Начальные 3 минуты —
 * заглушка до первой партии: настоящее время ставит вызывающий сеттерами.
 */
export function useClock({isTicking, isParticipant, currentTurn, myColor, onLowTime, hourglass = false}: UseClockOptions): UseClockResult {
    const [whiteTimeMs, setWhiteTimeMs, tickWhite] = useClockValue(180000);
    const [blackTimeMs, setBlackTimeMs, tickBlack] = useClockValue(180000);
    // Предупреждение о цейтноте уже прозвучало в этой партии (сбрасывает resetLowTimeWarning).
    const lowTimeWarnedRef = useRef(false);

    // Тик: с часов ходящего снимается время, реально прошедшее с прошлого тика (а не «50 мс»), поэтому часы не
    // отстают, когда вкладка в фоне и браузер замедляет таймеры. Смена хода перезапускает отсчёт.
    useEffect(() => {
        if (!isTicking) return;

        let lastTick = Date.now();

        const interval = setInterval(() => {
            const now = Date.now();
            const delta = now - lastTick;
            lastTick = now;

            if (currentTurn === 'white') {
                tickWhite(delta);
                if (hourglass) tickBlack(-delta);
            } else {
                tickBlack(delta);
                if (hourglass) tickWhite(-delta);
            }
        }, 50);

        return () => clearInterval(interval);
    }, [isTicking, currentTurn, tickWhite, tickBlack, hourglass]);

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

/** Форматирует остаток времени как mm:ss (от часа — h:mm:ss), с десятыми при цейтноте < 30 с; ноль — «00:00». */
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
