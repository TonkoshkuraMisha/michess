// --- FILE: frontend/src/components/chessboard/hooks/useCoachMode.ts ---
// Игра с наставником (таск 11.3) — только в партии с ботом и на свободной доске. После хода игрока сервер
// оценивает ход (POST /analysis/check-move); если ход плохой для уровня игрока, бот и часы ждут, а игрок решает:
// «Переходить», «Оставить» или «Не согласен» (с объяснением «Почему?»). Подсказка по ступеням (таск 11.4,
// POST /analysis/hint): намёк словами → какой фигурой ходить → ход со стрелкой; счётчик ступеней. Любое обращение к
// наставнику делает партию учебной (правило 2).

import {useCallback, useRef, useState} from 'react';
import type {Chess} from 'chess.js';
import {API_BASE_URL} from '../../../config/api';
import {readApiError} from '../../../services/apiErrors';
import type {CoachComment} from '../../../services/coach';
import type {UiMessage} from '../../../i18n';

export type CoachLevel = 'novice' | 'amateur' | 'strong';
export const COACH_LEVELS: readonly CoachLevel[] = ['novice', 'amateur', 'strong'];

export const COACH_ENABLED_KEY = 'michess_coach_enabled';
export const COACH_LEVEL_KEY = 'michess_coach_level';

export interface MoveCheck {
    available: boolean;
    cp_loss?: number;
    classification?: string;
    symbol?: string;
    eval_before?: number;
    eval_after?: number;
    best_move_uci?: string;
    reply_uci?: string;
    missed_tactic?: boolean;
    coach?: CoachComment | null;
}

/** Позиция, после которой перевес настолько велик, что «потеря» не меняет результата — без предупреждения. */
const STILL_WINNING_CP = 600;
const MISSED_WHILE_WINNING_CP = 200;

/**
 * Предупреждать ли игрока: новичку — только о грубых зевках, любителю — об ошибках и пропущенных ударах,
 * сильному — и о неточностях с пропущенным ударом. Пока перевес решающий, мелкие потери не тревожат.
 */
export function shouldWarn(check: MoveCheck, level: CoachLevel): boolean {
    if (!check.available) return false;
    const loss = check.cp_loss ?? 0;
    const missed = Boolean(check.missed_tactic);
    // Пока перевес решающий, мелочи не тревожат — но о пропущенном дорогом ударе (от 200 сп) сказать стоит:
    // так учатся реализовывать выигранное, а не только не зевать.
    const stillWinning = (check.eval_after ?? 0) >= STILL_WINNING_CP && loss < 500;
    if (stillWinning && !(missed && loss >= MISSED_WHILE_WINNING_CP)) return false;
    if (level === 'novice') return loss >= 300;
    if (level === 'amateur') return loss >= 150 || (missed && loss >= 50);
    return loss >= 100 || (missed && loss >= 30);
}

/** Уровень по рейтингу игрока, пока он не выбрал сам. */
export function levelForRating(rating: number): CoachLevel {
    if (rating < 1200) return 'novice';
    if (rating < 1900) return 'amateur';
    return 'strong';
}

function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
    try {
        const value = localStorage.getItem(key);
        return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
    } catch {
        return null;
    }
}

function store(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // приватный режим — настройка просто не запомнится
    }
}

export interface PendingCheck {
    /** checking — ждём ответ сервера; warning — ход плохой, игрок решает. */
    status: 'checking' | 'warning';
    /** Позиция до хода — для «Переходить». */
    previousGame: Chess;
    /** Позиция до хода и сам ход — для «Не согласен». */
    fenBefore: string;
    uci: string;
    /** FEN после хода: ответ сервера к другой позиции (игрок успел походить дальше) отбрасывается. */
    fenAfter: string;
    check?: MoveCheck;
}

export interface UseCoachModeResult {
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    level: CoachLevel;
    setLevel: (level: CoachLevel) => void;
    pending: PendingCheck | null;
    /** Бот и часы ждут: идёт проверка или игрок решает, переходить ли. */
    holdBot: boolean;
    /** Показать объяснение («Почему?») — текст и стрелки наставника. */
    explanation: CoachComment | null;
    showWhy: () => void;
    /** Ход оставлен — партия продолжается. */
    keepMove: () => void;
    /** «Переходить»: возвращает позицию до хода (вызывающий восстанавливает доску и часы). */
    takeBack: () => Chess | null;
    /** Последняя показанная ступень подсказки (её текст, стрелки и подсветка). */
    advice: CoachComment | null;
    adviceLoading: boolean;
    /** Следующая ступень подсказки для позиции (новая позиция — снова с первой). */
    requestHint: (fen: string) => Promise<void>;
    /** 0 — подсказок к этой позиции не было, 1–3 — показанная ступень. */
    hintStep: number;
    /** Ход уже показан: дальше подсказывать нечего. */
    hintFinal: boolean;
    /** Использовано ступеней подсказки за партию. */
    hintsUsed: number;
    /** «Не согласен»: позиция уходит на проверку, ход остаётся. */
    dispute: () => void;
    /** Спор отправлен — показать благодарность до следующего хода. */
    disputeSent: boolean;
    /** Обращались ли к наставнику в этой партии: партия учебная. */
    assisted: boolean;
    error: UiMessage | null;
    onPlayerMove: (previousGame: Chess, fenBefore: string, uci: string, fenAfter: string) => void;
    /** Новая партия: счётчики и отметка учебной партии — с нуля. */
    reset: () => void;
    /** Ход сделан, а предыдущие стрелки и объяснение больше не к месту. */
    clearOverlay: () => void;
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('token');
    return token ? {'Content-Type': 'application/json', Authorization: `Bearer ${token}`} : {'Content-Type': 'application/json'};
}

export function useCoachMode(playerRating: number): UseCoachModeResult {
    const [enabled, setEnabledState] = useState<boolean>(() => readStored(COACH_ENABLED_KEY, ['1', '0']) === '1');
    const [chosenLevel, setChosenLevel] = useState<CoachLevel | null>(() => readStored(COACH_LEVEL_KEY, COACH_LEVELS));
    const [pending, setPending] = useState<PendingCheck | null>(null);
    const [explanation, setExplanation] = useState<CoachComment | null>(null);
    const [advice, setAdvice] = useState<CoachComment | null>(null);
    const [adviceLoading, setAdviceLoading] = useState(false);
    const [hintsUsed, setHintsUsed] = useState(0);
    const [hintStep, setHintStep] = useState(0);
    const [hintFinal, setHintFinal] = useState(false);
    const [disputeSent, setDisputeSent] = useState(false);
    const hintRef = useRef<{ fen: string; step: number } | null>(null);
    const [assisted, setAssisted] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);
    const pendingRef = useRef<PendingCheck | null>(null);
    const level = chosenLevel ?? levelForRating(playerRating);

    const updatePending = useCallback((next: PendingCheck | null) => {
        pendingRef.current = next;
        setPending(next);
    }, []);

    const setEnabled = useCallback((value: boolean) => {
        setEnabledState(value);
        store(COACH_ENABLED_KEY, value ? '1' : '0');
        if (!value) updatePending(null);
    }, [updatePending]);

    const setLevel = useCallback((value: CoachLevel) => {
        setChosenLevel(value);
        store(COACH_LEVEL_KEY, value);
    }, []);

    const clearOverlay = useCallback(() => {
        setExplanation(null);
        setAdvice(null);
        setHintStep(0);
        setHintFinal(false);
        setDisputeSent(false);
        hintRef.current = null;
    }, []);

    const onPlayerMove = useCallback((previousGame: Chess, fenBefore: string, uci: string, fenAfter: string) => {
        clearOverlay();
        if (!enabled) return;
        setAssisted(true);
        setError(null);
        updatePending({status: 'checking', previousGame, fenBefore, uci, fenAfter});
        void (async () => {
            let check: MoveCheck | null = null;
            try {
                const res = await fetch(`${API_BASE_URL}/api/v1/analysis/check-move`, {
                    method: 'POST', headers: authHeaders(), body: JSON.stringify({fen: fenBefore, move: uci}),
                });
                if (res.ok) check = await res.json();
                else setError(await readApiError(res));
            } catch {
                setError({key: 'coachMode.unavailable'});
            }
            // Игрок успел сыграть дальше (свободная доска) — ответ к старой позиции не нужен.
            if (pendingRef.current?.fenAfter !== fenAfter) return;
            if (check && shouldWarn(check, level)) {
                updatePending({status: 'warning', previousGame, fenBefore, uci, fenAfter, check});
            } else {
                updatePending(null);
            }
        })();
    }, [enabled, level, clearOverlay, updatePending]);

    const showWhy = useCallback(() => {
        const current = pendingRef.current;
        if (current?.check?.coach) setExplanation(current.check.coach);
    }, []);

    const keepMove = useCallback(() => {
        updatePending(null);
        setExplanation(null);
    }, [updatePending]);

    const takeBack = useCallback((): Chess | null => {
        const current = pendingRef.current;
        if (!current) return null;
        updatePending(null);
        setExplanation(null);
        return current.previousGame;
    }, [updatePending]);

    const dispute = useCallback(() => {
        const current = pendingRef.current;
        if (!current) return;
        const body = {fen: current.fenBefore, move: current.uci, cp_loss: current.check?.cp_loss ?? null};
        updatePending(null);
        setExplanation(null);
        setDisputeSent(true);
        // Отправка — без ожидания: игрок продолжает партию, а сбой очереди его не касается.
        void fetch(`${API_BASE_URL}/api/v1/analysis/dispute`, {
            method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
        }).catch(() => undefined);
    }, [updatePending]);

    const requestHint = useCallback(async (fen: string) => {
        const previous = hintRef.current;
        const step = previous && previous.fen === fen ? Math.min(3, previous.step + 1) : 1;
        setAdviceLoading(true);
        setError(null);
        setExplanation(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/analysis/hint`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify({fen, step}),
            });
            if (res.ok) {
                const body = await res.json();
                hintRef.current = {fen, step: body.step};
                setAdvice(body);
                setHintStep(body.step);
                setHintFinal(Boolean(body.final));
                setHintsUsed((n) => n + 1);
                setAssisted(true);
            } else {
                setError(await readApiError(res));
            }
        } catch {
            setError({key: 'coachMode.unavailable'});
        } finally {
            setAdviceLoading(false);
        }
    }, []);

    const reset = useCallback(() => {
        updatePending(null);
        setExplanation(null);
        setAdvice(null);
        setHintStep(0);
        setHintFinal(false);
        setDisputeSent(false);
        hintRef.current = null;
        setHintsUsed(0);
        setAssisted(false);
        setError(null);
    }, [updatePending]);

    return {
        enabled, setEnabled, level, setLevel, pending,
        holdBot: enabled && pending !== null,
        explanation, showWhy, keepMove, takeBack,
        advice, adviceLoading, requestHint, hintStep, hintFinal, hintsUsed, dispute, disputeSent, assisted, error,
        onPlayerMove, reset, clearOverlay,
    };
}
