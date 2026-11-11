// --- FILE: frontend/src/components/chessboard/hooks/useBotGame.ts ---

import {useCallback, useEffect, useRef, useState} from 'react';
import {Chess} from 'chess.js';
import {gameSocket} from '../../../services/gameSocket';
import {resolveMoveSound} from '../../../services/soundEngine';
import type {SoundEventType} from '../../../services/soundEngine';
import {API_BASE_URL} from '../../../config/api';
import {HISTORICAL_BOTS} from '../../../config/champions';
import type {HistoricalBotId} from '../../../config/champions';
import {cloneChessInstance} from '../boardUtils';
import type {PendingPromotion} from '../types';

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
    activeBot: HistoricalBotId | null;
    setActiveBot: (id: HistoricalBotId | null) => void;
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

export interface UseBotGameResult {
    selectedBotId: HistoricalBotId;
    setSelectedBotId: (id: HistoricalBotId) => void;
    botComment: string | null;
    isBotThinking: boolean;
    savedBotGameId: number | null;
    startHistoricalBotGame: (botId: HistoricalBotId, colorPref?: 'white' | 'black' | 'random') => void;
    saveBotGameToDatabase: (
        botId: HistoricalBotId,
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

    const saveBotGameToDatabase = useCallback(async (
        botId: HistoricalBotId,
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
                    termination: termination ?? null, moves_uci: movesUci,
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
            }
        } catch (err) {
            console.error('Ошибка сохранения партии с ботом в БД:', err);
        }
    }, [effectiveWhiteBaseMinutes, effectiveIncSeconds, setGameOverResult, setDrawOfferStatus]);

    const startHistoricalBotGame = useCallback((botId: HistoricalBotId, colorPref: 'white' | 'black' | 'random' = 'random') => {
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
        const freshGame = new Chess();
        const botInfo = HISTORICAL_BOTS[botId];

        botGameSavedRef.current = false;
        resetLowTimeWarning();
        setSavedBotGameId(null);
        gameIdRef.current = null;
        setGameId(null);
        setSelectedBotId(botId);
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
        currentUsername, currentUserRating, setWhitePlayer, setBlackPlayer, playAudio,
    ]);

    // Ход бота: запрашивает /bots/move, ждёт имитацию обдумывания, применяет ход.
    useEffect(() => {
        if (!activeBot || gameOverResult || game.isGameOver()) return;

        const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';
        if (currentTurnColor === myColor) return;

        let isCancelled = false;
        let delayTimer: ReturnType<typeof setTimeout> | null = null;
        setIsBotThinking(true);
        const botName = HISTORICAL_BOTS[activeBot].shortName;
        const requestStartedAt = Date.now();

        (async () => {
            try {
                const authToken = localStorage.getItem('token');
                const headers: Record<string, string> = {'Content-Type': 'application/json'};
                // С токеном лимит запросов считается на пользователя, а не на общий IP.
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

                let response: Response | null = null;
                // 429 (лимит) и 503 (пул движков занят) — временные: ждём Retry-After и повторяем.
                for (let attempt = 0; attempt < 4 && !isCancelled; attempt++) {
                    response = await fetch(`${API_BASE_URL}/api/v1/bots/move`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            bot_id: activeBot,
                            fen: game.fen()
                        })
                    });
                    if (response.status !== 429 && response.status !== 503) break;
                    const retryAfterS = Number(response.headers.get('Retry-After')) || 2;
                    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterS, 10) * 1000));
                }
                if (!response) return;

                if (!response.ok || isCancelled) {
                    if (!isCancelled) setIsBotThinking(false);
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
    }, [activeBot, game, myColor, gameOverResult, playAudio, playOutcomeSound, updateSessionStats, saveBotGameToDatabase, applyIncrement, effectiveIncSeconds, setGame, setHistory, setViewIndex, clearPremove, setGameOverResult, setDrawOfferStatus, moveStartTime]);

    // Поражение по флагу в партии с ботом.
    useEffect(() => {
        if (!activeBot || gameOverResult) return;

        if (whiteTimeMs <= 0 || blackTimeMs <= 0) {
            const flagWinner = whiteTimeMs <= 0 ? '0-1' : '1-0';
            const botName = HISTORICAL_BOTS[activeBot].shortName;
            clearPremove();
            setPendingPromotion(null);
            setGameOverResult(flagWinner);
            setDrawOfferStatus(`Флажок упал! Партия против ${botName} завершена по времени (${flagWinner}).`);
            updateSessionStats(flagWinner);
            playOutcomeSound(flagWinner, myColor);
            saveBotGameToDatabase(activeBot, myColor, flagWinner, game, 'timeout');
        }
    }, [whiteTimeMs, blackTimeMs, activeBot, gameOverResult, myColor, game, playOutcomeSound, updateSessionStats, saveBotGameToDatabase, clearPremove, setPendingPromotion, setGameOverResult, setDrawOfferStatus]);

    const exitBotGame = useCallback(() => {
        setActiveBot(null);
        setBotComment(null);
        setIsBotThinking(false);
        setSavedBotGameId(null);
        botGameSavedRef.current = false;
    }, [setActiveBot]);

    return {
        selectedBotId, setSelectedBotId, botComment, isBotThinking, savedBotGameId,
        startHistoricalBotGame, saveBotGameToDatabase, exitBotGame,
    };
}
