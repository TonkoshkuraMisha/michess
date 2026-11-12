// --- FILE: frontend/src/components/chessboard/hooks/useBotGame.ts ---

import {useCallback, useEffect, useRef, useState} from 'react';
import {Chess} from 'chess.js';
import {gameSocket} from '../../../services/gameSocket';
import {resolveMoveSound} from '../../../services/soundEngine';
import type {SoundEventType} from '../../../services/soundEngine';
import {API_BASE_URL} from '../../../config/api';
import {HISTORICAL_BOTS} from '../../../config/champions';
import type {BotOpponentId, HistoricalBotId, HistoricalBotProfile} from '../../../config/champions';
import {customBotProfile} from '../../../config/archetypes';
import type {CustomOpponent} from '../../../config/archetypes';
import {cloneChessInstance, customStartFen} from '../boardUtils';
import type {PendingPromotion} from '../types';
import {readErrorDetail} from '../../../services/apiErrors';

const BOT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

/** 4xx, кроме 408/429, — ошибка запроса (позиция, бот): повтор того же запроса не поможет. */
export function isPermanentBotError(status: number): boolean {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Пауза перед повтором хода бота: Retry-After сервера (не больше 10 с) или 1 → 2 → 4 → 8 с. */
export function botRetryDelayMs(attempt: number, response: Response | null): number {
    const retryAfterS = Number(response?.headers.get('Retry-After'));
    if (retryAfterS > 0) return Math.min(retryAfterS, 10) * 1000;
    return BOT_RETRY_DELAYS_MS[Math.min(attempt, BOT_RETRY_DELAYS_MS.length - 1)];
}

export interface UseBotGameOptions {
    game: Chess;
    myColor: 'white' | 'black';
    gameOverResult: string | null;
    whiteTimeMs: number;
    blackTimeMs: number;
    isSearching: boolean;
    setIsSearching: (v: boolean) => void;
    /**
     * Владеет компонент, а не этот хук: isTicking/isParticipant в useClock должны знать
     * про активную партию с ботом ещё до того, как этот хук успевает вызваться (useClock
     * вызывается раньше, чтобы отдать resetLowTimeWarning/applyIncrement сюда же).
     */
    activeBot: BotOpponentId | null;
    setActiveBot: (id: BotOpponentId | null) => void;
    effectiveWhiteBaseMinutes: number;
    effectiveBlackBaseMinutes: number;
    effectiveIncSeconds: number;
    currentUsername: string;
    currentUserRating: number;
    setGame: (g: Chess) => void;
    setHistory: (h: any[]) => void;
    setViewIndex: (i: number) => void;
    setSelectedSquare: (s: string | null) => void;
    setMyColor: (c: 'white' | 'black') => void;
    setIsManualFlip: (v: boolean) => void;
    setPendingPromotion: (p: PendingPromotion | null) => void;
    /** Снимает премув — используется только на старте/завершении партии с ботом. */
    clearPremove: () => void;
    setGameOverResult: (r: string | null) => void;
    setRatingInfo: (r: any) => void;
    setDrawOfferStatus: (s: string | null) => void;
    setRematchStatus: (s: 'none' | 'offered_by_me' | 'offered_by_opponent' | 'declined') => void;
    setWhiteTimeMs: (ms: number) => void;
    setBlackTimeMs: (ms: number) => void;
    resetLowTimeWarning: () => void;
    applyIncrement: (moverColor: 'white' | 'black', incrementSeconds: number) => void;
    moveStartTime: React.MutableRefObject<number>;
    myColorRef: React.MutableRefObject<'white' | 'black'>;
    gameIdRef: React.MutableRefObject<number | null>;
    setGameId: (id: number | null) => void;
    setLeftSectionTab: (t: 'bots' | 'lobby') => void;
    setWhitePlayer: (p: { username: string; rating: string }) => void;
    setBlackPlayer: (p: { username: string; rating: string }) => void;
    playAudio: (type: SoundEventType) => void;
    playOutcomeSound: (result: string, playerColor?: 'white' | 'black') => void;
    updateSessionStats: (result: string) => void;
}

/** Итог партии клубной лестницы — ответ сервера на сохранение. */
export interface LadderOutcome {
    counted: boolean;
    reason: string | null;
    delta: number;
    rating: number;
    step: number;
    promoted: boolean;
    opponent: string;
}

export interface BotGameStartOptions {
    /** Партия клубной лестницы: без возврата ходов, итог меняет рейтинг лестницы. */
    ladder?: boolean;
}

export function ladderOutcomeMessage(outcome: LadderOutcome): string {
    if (!outcome.counted) return `Партия не засчитана в лестницу: ${outcome.reason}.`;
    const delta = outcome.delta > 0 ? `+${outcome.delta}` : String(outcome.delta);
    return `Лестница: рейтинг ${outcome.rating} (${delta})${outcome.promoted ? ' — открыт следующий соперник!' : '.'}`;
}

export interface UseBotGameResult {
    selectedBotId: HistoricalBotId;
    setSelectedBotId: (id: HistoricalBotId) => void;
    botComment: string | null;
    isBotThinking: boolean;
    savedBotGameId: number | null;
    /** startFen — начать партию с этой позиции вместо обычной расстановки. */
    startHistoricalBotGame: (
        botId: BotOpponentId, colorPref?: 'white' | 'black' | 'random', startFen?: string | null,
        options?: BotGameStartOptions,
    ) => void;
    /** Партия с соперником из мастерской (персоналия с ползунками). */
    startCustomBotGame: (
        opponent: CustomOpponent, colorPref?: 'white' | 'black' | 'random', startFen?: string | null,
        options?: BotGameStartOptions,
    ) => void;
    /** Идёт (или только что сыграна) партия клубной лестницы. */
    isLadderGame: boolean;
    /** Итог последней сохранённой партии лестницы (для обновления панели лестницы). */
    ladderOutcome: LadderOutcome | null;
    /** Профиль бота для доски и панели — исторического или собранного в мастерской. */
    botProfileFor: (id: BotOpponentId) => HistoricalBotProfile;
    saveBotGameToDatabase: (
        botId: BotOpponentId,
        playerColor: 'white' | 'black',
        result: string,
        completedGame: Chess,
        termination?: 'resignation' | 'timeout',
    ) => Promise<void>;
    /** Полный выход из партии с ботом (матчмейкинг/вызов/реванш/сброс песочницы). */
    exitBotGame: () => void;
}

/**
 * Партия с историческим ботом: запуск, обмен ходами с /bots/move (с ретраями на 429/503),
 * поражение по флагу, сохранение завершённой партии в архив через /bots/save-game.
 */
export function useBotGame({
    game, myColor, gameOverResult, whiteTimeMs, blackTimeMs, isSearching, setIsSearching,
    activeBot, setActiveBot,
    effectiveWhiteBaseMinutes, effectiveBlackBaseMinutes, effectiveIncSeconds,
    currentUsername, currentUserRating,
    setGame, setHistory, setViewIndex, setSelectedSquare, setMyColor, setIsManualFlip, setPendingPromotion, clearPremove,
    setGameOverResult, setRatingInfo, setDrawOfferStatus, setRematchStatus,
    setWhiteTimeMs, setBlackTimeMs, resetLowTimeWarning, applyIncrement,
    moveStartTime, myColorRef, gameIdRef, setGameId, setLeftSectionTab, setWhitePlayer, setBlackPlayer,
    playAudio, playOutcomeSound, updateSessionStats,
}: UseBotGameOptions): UseBotGameResult {
    const [selectedBotId, setSelectedBotId] = useState<HistoricalBotId>('philidor');
    const [botComment, setBotComment] = useState<string | null>(null);
    const [isBotThinking, setIsBotThinking] = useState<boolean>(false);
    const [savedBotGameId, setSavedBotGameId] = useState<number | null>(null);
    const botGameSavedRef = useRef<boolean>(false);
    // Соперник из мастерской текущей (или последней) партии — ref, чтобы ход, сохранение и
    // реванш читали его без лишних зависимостей эффектов.
    const customOpponentRef = useRef<CustomOpponent | null>(null);
    const ladderRef = useRef<boolean>(false);
    const [isLadderGame, setIsLadderGame] = useState<boolean>(false);
    const [ladderOutcome, setLadderOutcome] = useState<LadderOutcome | null>(null);

    const botProfileFor = useCallback((id: BotOpponentId): HistoricalBotProfile => {
        if (id === 'custom') {
            return customBotProfile(customOpponentRef.current ?? {
                name: 'Соперник', config: {} as CustomOpponent['config'],
            });
        }
        return HISTORICAL_BOTS[id];
    }, []);

    const saveBotGameToDatabase = useCallback(async (
        botId: BotOpponentId,
        playerColor: 'white' | 'black',
        result: string,
        completedGame: Chess,
        termination?: 'resignation' | 'timeout'
    ) => {
        if (botGameSavedRef.current) return;
        const token = localStorage.getItem('token');
        if (!token) return;
        const verboseMoves = completedGame.history({verbose: true});
        if (verboseMoves.length === 0) return;
        botGameSavedRef.current = true;
        const movesUci = verboseMoves.map((m: any) => `${m.from}${m.to}${m.promotion || ''}`);
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/bots/save-game`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify({
                    bot_id: botId, player_color: playerColor, result,
                    ladder: ladderRef.current,
                    // Соперник из мастерской: сохранённый — по id, несохранённый — по имени.
                    ...(botId === 'custom' && customOpponentRef.current
                        ? (customOpponentRef.current.personalityId
                            ? {personality_id: customOpponentRef.current.personalityId}
                            : {personality_name: customOpponentRef.current.name})
                        : {}),
                    termination: termination ?? null, moves_uci: movesUci,
                    // Партия с произвольной позиции: сервер проверяет ходы от неё же.
                    start_fen: customStartFen(completedGame),
                    base_time_ms: Math.round(effectiveWhiteBaseMinutes * 60 * 1000),
                    increment_ms: Math.round(effectiveIncSeconds * 1000)
                })
            });
            if (response.ok) {
                const data = await response.json();
                if (data.game_id) setSavedBotGameId(data.game_id);
                if (data.result && data.result !== result) {
                    setGameOverResult(data.result);
                    setDrawOfferStatus(`Итог по правилам ФИДЕ: ${data.result}`);
                }
                if (data.ladder) {
                    setLadderOutcome(data.ladder);
                    setDrawOfferStatus(ladderOutcomeMessage(data.ladder));
                }
            }
        } catch (err) {
            console.error('Ошибка сохранения партии с ботом в БД:', err);
        }
    }, [effectiveWhiteBaseMinutes, effectiveIncSeconds, setGameOverResult, setDrawOfferStatus]);

    const startHistoricalBotGame = useCallback((
        botId: BotOpponentId,
        colorPref: 'white' | 'black' | 'random' = 'random',
        startFen: string | null = null,
        options: BotGameStartOptions = {},
    ) => {
        ladderRef.current = Boolean(options.ladder);
        setIsLadderGame(Boolean(options.ladder));
        if (isSearching) {
            setIsSearching(false);
            gameSocket.send('leave_queue', {});
        }

        const chosenColor: 'white' | 'black' =
            colorPref === 'random'
                ? (Math.random() < 0.5 ? 'white' : 'black')
                : colorPref;

        const whiteStartMs = Math.round(effectiveWhiteBaseMinutes * 60 * 1000);
        const blackStartMs = Math.round(effectiveBlackBaseMinutes * 60 * 1000);
        const freshGame = startFen ? new Chess(startFen) : new Chess();
        const botInfo = botProfileFor(botId);

        botGameSavedRef.current = false;
        resetLowTimeWarning();
        setSavedBotGameId(null);
        gameIdRef.current = null;
        setGameId(null);
        if (botId !== 'custom') setSelectedBotId(botId);
        setActiveBot(botId);
        setLeftSectionTab('bots');
        myColorRef.current = chosenColor;
        setMyColor(chosenColor);
        setIsManualFlip(false);
        setGame(freshGame);
        setHistory([]);
        setViewIndex(-1);
        setSelectedSquare(null);
        setPendingPromotion(null);
        clearPremove();
        setGameOverResult(null);
        setRatingInfo(null);
        setDrawOfferStatus(null);
        setRematchStatus('none');
        setWhiteTimeMs(whiteStartMs);
        setBlackTimeMs(blackStartMs);
        moveStartTime.current = Date.now();

        if (chosenColor === 'white') {
            setWhitePlayer({username: currentUsername, rating: String(currentUserRating)});
            setBlackPlayer({username: botInfo.playerLabel, rating: String(botInfo.rating)});
        } else {
            setWhitePlayer({username: botInfo.playerLabel, rating: String(botInfo.rating)});
            setBlackPlayer({username: currentUsername, rating: String(currentUserRating)});
        }

        setBotComment(`«${botInfo.motto}»`);
        playAudio('start');
    }, [
        isSearching, setIsSearching, effectiveWhiteBaseMinutes, effectiveBlackBaseMinutes, resetLowTimeWarning,
        gameIdRef, setGameId, setActiveBot, setLeftSectionTab, myColorRef, setMyColor, setIsManualFlip, setGame,
        setHistory, setViewIndex, setSelectedSquare, setPendingPromotion, clearPremove, setGameOverResult,
        setRatingInfo, setDrawOfferStatus, setRematchStatus, setWhiteTimeMs, setBlackTimeMs, moveStartTime,
        currentUsername, currentUserRating, setWhitePlayer, setBlackPlayer, playAudio, botProfileFor,
    ]);

    const startCustomBotGame = useCallback((
        opponent: CustomOpponent,
        colorPref: 'white' | 'black' | 'random' = 'random',
        startFen: string | null = null,
        options: BotGameStartOptions = {},
    ) => {
        customOpponentRef.current = opponent;
        startHistoricalBotGame('custom', colorPref, startFen, options);
    }, [startHistoricalBotGame]);

    // Ход бота: запрашивает /bots/move, ждёт имитацию обдумывания, применяет ход.
    useEffect(() => {
        if (!activeBot || gameOverResult || game.isGameOver()) return;

        const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';
        if (currentTurnColor === myColor) return;

        let isCancelled = false;
        let delayTimer: ReturnType<typeof setTimeout> | null = null;
        setIsBotThinking(true);
        const botName = botProfileFor(activeBot).shortName;
        const requestStartedAt = Date.now();
        const custom = activeBot === 'custom' ? customOpponentRef.current : null;
        const moveUrl = custom ? `${API_BASE_URL}/api/v1/bots/custom-move` : `${API_BASE_URL}/api/v1/bots/move`;
        const moveBody = (fen: string) => (custom
            ? (custom.personalityId ? {fen, personality_id: custom.personalityId} : {fen, config: custom.config})
            : {bot_id: activeBot, fen});

        (async () => {
            try {
                const authToken = localStorage.getItem('token');
                const headers: Record<string, string> = {'Content-Type': 'application/json'};
                // С токеном лимит запросов считается на пользователя, а не на общий IP.
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

                // Временные сбои — сеть, перезапуск сервера (деплой), 5xx, 429 (лимит), 503 (пул
                // движков занят) — повторяем, пока партия идёт. Раньше после сетевой ошибки или 500
                // бот молча переставал ходить и проигрывал по времени.
                let response: Response | null = null;
                for (let attempt = 0; !isCancelled; attempt++) {
                    try {
                        response = await fetch(moveUrl, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(moveBody(game.fen())),
                        });
                    } catch {
                        response = null;
                    }
                    if (response?.ok) break;
                    if (response && isPermanentBotError(response.status)) break;

                    if (attempt === 1 && !isCancelled) {
                        setBotComment('Нет связи с сервером — ход бота будет сделан, как только связь восстановится…');
                    }
                    await new Promise((resolve) => setTimeout(resolve, botRetryDelayMs(attempt, response)));
                }
                if (isCancelled || !response) return;

                if (!response.ok) {
                    // Постоянная ошибка (некорректная позиция, неизвестный бот): повтор не поможет.
                    setBotComment(`Бот не смог сделать ход: ${await readErrorDetail(response, `ошибка ${response.status}`)}`);
                    setIsBotThinking(false);
                    return;
                }
                const data = await response.json();
                if (isCancelled) return;

                const targetThinkMs = typeof data.thinking_time_ms === 'number' ? data.thinking_time_ms : 600;
                const networkElapsed = Date.now() - requestStartedAt;
                const remainingDelay = Math.max(80, targetThinkMs - networkElapsed);

                delayTimer = setTimeout(() => {
                    if (isCancelled) return;

                    const from = data.uci.slice(0, 2);
                    const to = data.uci.slice(2, 4);
                    const promotion = data.uci.length > 4 ? data.uci.slice(4, 5) : 'q';

                    const nextGame = cloneChessInstance(game);
                    const moveObj = nextGame.move({from, to, promotion});

                    if (moveObj) {
                        const newHistory = nextGame.history({verbose: true});
                        const botColor: 'white' | 'black' = myColor === 'white' ? 'black' : 'white';

                        applyIncrement(botColor, effectiveIncSeconds);
                        setGame(nextGame);
                        setHistory(newHistory);
                        setViewIndex(-1);
                        setBotComment(data.comment);
                        moveStartTime.current = Date.now();

                        // На завершающем ходу играет только исход (победа/поражение/ничья) —
                        // звук самого хода («шах» и т.п.) был бы лишним дублем перед ним.
                        if (!nextGame.isGameOver()) {
                            playAudio(resolveMoveSound(moveObj.san));
                        }

                        if (nextGame.isGameOver()) {
                            let result = '1/2-1/2';
                            if (nextGame.isCheckmate()) {
                                result = nextGame.turn() === 'w' ? '0-1' : '1-0';
                            }
                            clearPremove();
                            setGameOverResult(result);
                            setDrawOfferStatus(`Партия против ${botName} окончена и сохранена в архив (${result}).`);
                            updateSessionStats(result);
                            playOutcomeSound(result, myColor);
                            saveBotGameToDatabase(activeBot, myColor, result, nextGame);
                        }
                    }
                    setIsBotThinking(false);
                }, remainingDelay);
            } catch (err) {
                console.error('Ошибка получения хода бота:', err);
                if (!isCancelled) {
                    setIsBotThinking(false);
                }
            }
        })();

        return () => {
            isCancelled = true;
            if (delayTimer) clearTimeout(delayTimer);
        };
    }, [activeBot, game, myColor, gameOverResult, playAudio, playOutcomeSound, updateSessionStats, saveBotGameToDatabase, applyIncrement, effectiveIncSeconds, setGame, setHistory, setViewIndex, clearPremove, setGameOverResult, setDrawOfferStatus, moveStartTime, botProfileFor]);

    // Поражение по флагу в партии с ботом.
    useEffect(() => {
        if (!activeBot || gameOverResult) return;

        if (whiteTimeMs <= 0 || blackTimeMs <= 0) {
            const flagWinner = whiteTimeMs <= 0 ? '0-1' : '1-0';
            const botName = botProfileFor(activeBot).shortName;
            clearPremove();
            setPendingPromotion(null);
            setGameOverResult(flagWinner);
            setDrawOfferStatus(`Флажок упал! Партия против ${botName} завершена по времени (${flagWinner}).`);
            updateSessionStats(flagWinner);
            playOutcomeSound(flagWinner, myColor);
            saveBotGameToDatabase(activeBot, myColor, flagWinner, game, 'timeout');
        }
    }, [whiteTimeMs, blackTimeMs, activeBot, gameOverResult, myColor, game, playOutcomeSound, updateSessionStats, saveBotGameToDatabase, clearPremove, setPendingPromotion, setGameOverResult, setDrawOfferStatus, botProfileFor]);

    const exitBotGame = useCallback(() => {
        ladderRef.current = false;
        setIsLadderGame(false);
        setActiveBot(null);
        setBotComment(null);
        setIsBotThinking(false);
        setSavedBotGameId(null);
        botGameSavedRef.current = false;
    }, [setActiveBot]);

    return {
        selectedBotId, setSelectedBotId, botComment, isBotThinking, savedBotGameId,
        startHistoricalBotGame, startCustomBotGame, botProfileFor, saveBotGameToDatabase, exitBotGame,
        isLadderGame, ladderOutcome,
    };
}
