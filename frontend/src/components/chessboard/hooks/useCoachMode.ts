// --- FILE: frontend/src/components/chessboard/hooks/useCoachMode.ts ---
// Игра с наставником (таск 11.3) — только в партии с ботом и на свободной доске. После хода игрока сервер в фоне
// оценивает ход (POST /analysis/check-move); партия при этом не останавливается (решение владельца 18.11: наставник
// предлагает, но не блокирует). Если ход плохой для уровня игрока, рядом с доской появляется совет: «Почему?»,
// «Переходить» (по желанию — вместе с уже сделанным ответом бота), «Понятно» и «Не согласен». Предупреждений —
// не больше MAX_WARNINGS_PER_GAME за партию и не чаще чем раз в MIN_MOVES_BETWEEN_WARNINGS своих ходов. Подсказка по ступеням (таск 11.4,
// POST /analysis/hint): намёк словами → какой фигурой ходить → ход со стрелкой; счётчик ступеней. Любое обращение к
// наставнику делает партию учебной (правило 2): отметка assisted уходит на сервер при сохранении партии с ботом.
// «Не согласен» — POST /analysis/dispute: позиция попадает в очередь спорных оценок. Проверку хода и подсказку
// сервер отклоняет, пока у игрока идёт партия с человеком, и ограничивает квотой наставника. Включён ли наставник
// и выбранный уровень помнит localStorage (ключи regence_coach_enabled, regence_coach_level); уровень, пока игрок
// его не выбрал, определяется по рейтингу. В партии лестницы и турнира Chessboard проверку ходов не вызывает, а
// панель наставника заблокирована.

import {useCallback, useRef, useState} from 'react';
import type {Chess} from 'chess.js';
import {API_BASE_URL} from '../../../config/api';
import {readApiError} from '../../../services/apiErrors';
import type {CoachComment} from '../../../services/coach';
import type {UiMessage} from '../../../i18n';
import {getToken} from '../../../services/authToken';

export type CoachLevel = 'novice' | 'amateur' | 'strong';
export const COACH_LEVELS: readonly CoachLevel[] = ['novice', 'amateur', 'strong'];

export const COACH_ENABLED_KEY = 'regence_coach_enabled';
export const COACH_LEVEL_KEY = 'regence_coach_level';

/**
 * Ответ POST /analysis/check-move (src/services/move_check.py). Оценки — в сотых пешки с точки зрения сходившего;
 * available=false — движок оценить ход не смог, предупреждения не будет.
 */
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

/**
 * Сколько раз за партию наставник предупреждает о ходе и через сколько своих ходов после предыдущего предупреждения
 * снова может (решение владельца 18.11: «несколько раз за партию, а не на каждом шагу»). Когда предупреждать нельзя,
 * ход и на проверку не отправляется — не тратится квота наставника.
 */
export const MAX_WARNINGS_PER_GAME = 3;
export const MIN_MOVES_BETWEEN_WARNINGS = 4;

/** Можно ли сейчас предупреждать: ещё есть запас на партию и с прошлого предупреждения прошло достаточно ходов. */
export function warningAllowed(shown: number, movesSinceLast: number | null): boolean {
    return shown < MAX_WARNINGS_PER_GAME && (movesSinceLast === null || movesSinceLast >= MIN_MOVES_BETWEEN_WARNINGS);
}

/** Позиция, после которой перевес настолько велик, что «потеря» не меняет результата — без предупреждения. */
const STILL_WINNING_CP = 600;
/** Потеря, с которой о пропущенном ударе говорится и при решающем перевесе. */
const MISSED_WHILE_WINNING_CP = 200;

/**
 * Предупреждать ли игрока: новичку — только о грубых зевках (потеря от 300 сотых пешки), любителю — об ошибках
 * (от 150) и пропущенных ударах (от 50), сильному — и о неточностях (от 100; с пропущенным ударом — от 30). Пока
 * перевес решающий (после хода не меньше 600 и потеря меньше 500), мелкие потери не тревожат. Пороги — только
 * здесь, на клиенте: сервер присылает числа, а решение о предупреждении принимает эта функция.
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

// Чтение и запись настройки в localStorage; недоступное хранилище (приватный режим) — не ошибка.
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

/** Ход игрока, который проверяется или по которому игрок решает, что делать. */
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
    /** Вызывается после каждого хода игрока: при включённом наставнике отправляет ход на проверку. */
    onPlayerMove: (previousGame: Chess, fenBefore: string, uci: string, fenAfter: string) => void;
    /** Новая партия: счётчики и отметка учебной партии — с нуля. */
    reset: () => void;
    /** Ход сделан, а предыдущие стрелки и объяснение больше не к месту. */
    clearOverlay: () => void;
}

// Токен передаётся, если игрок вошёл: по нему сервер считает лимиты на игрока и проверяет правило честной игры.
function authHeaders(): Record<string, string> {
    const token = getToken();
    return token ? {'Content-Type': 'application/json', Authorization: `Bearer ${token}`} : {'Content-Type': 'application/json'};
}

/**
 * Состояние игры с наставником для главной доски. playerRating — рейтинг игрока (блиц из GET /profile/me), по
 * нему выбирается уровень, пока игрок не выбрал сам. Доской хук не управляет: вызывающий сообщает о ходе
 * (onPlayerMove) и сам возвращает позицию по takeBack. Партию наставник не останавливает никогда.
 */
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
    // Позиция и ступень последней подсказки: повторный запрос к той же позиции даёт следующую ступень.
    const hintRef = useRef<{ fen: string; step: number } | null>(null);
    const [assisted, setAssisted] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);
    // Копия pending для асинхронного кода: ответ сервера сверяется с ходом, который ждёт проверки сейчас.
    const pendingRef = useRef<PendingCheck | null>(null);
    // Частота предупреждений (MAX_WARNINGS_PER_GAME, MIN_MOVES_BETWEEN_WARNINGS): сколько показано за партию и номер
    // своего хода последнего; moves — счётчик своих ходов в партии.
    const warnRef = useRef<{ shown: number; lastMove: number | null; moves: number }>({shown: 0, lastMove: null, moves: 0});
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

    // Проверка хода — в фоне: партия не ждёт (бот отвечает, часы идут). Плохой ход даёт совет рядом с доской, а не
    // остановку; «Переходить» — по желанию игрока. Ход отправляется на проверку, только если предупредить сейчас
    // можно (warningAllowed). Партия помечается учебной при отправке хода на проверку. Ошибка сети или отказ сервера
    // (лимит, движок занят) показываются сообщением, ход остаётся.
    const onPlayerMove = useCallback((previousGame: Chess, fenBefore: string, uci: string, fenAfter: string) => {
        clearOverlay();
        updatePending(null);
        if (!enabled) return;
        const warn = warnRef.current;
        warn.moves += 1;
        if (!warningAllowed(warn.shown, warn.lastMove === null ? null : warn.moves - warn.lastMove)) return;
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
                warnRef.current.shown += 1;
                warnRef.current.lastMove = warnRef.current.moves;
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

    // Ступень выбирает клиент (1–3), но какая ступень показана и последняя ли она — берётся из ответа сервера
    // (step, final). Каждая полученная ступень считается в hintsUsed и делает партию учебной.
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
        warnRef.current = {shown: 0, lastMove: null, moves: 0};
    }, [updatePending]);

    return {
        enabled, setEnabled, level, setLevel, pending,
        explanation, showWhy, keepMove, takeBack,
        advice, adviceLoading, requestHint, hintStep, hintFinal, hintsUsed, dispute, disputeSent, assisted, error,
        onPlayerMove, reset, clearOverlay,
    };
}
