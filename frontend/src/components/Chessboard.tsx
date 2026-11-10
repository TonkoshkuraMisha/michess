// --- FILE: frontend/src/components/Chessboard.tsx ---

import {useState, useEffect, useRef, useCallback} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {
    ChevronFirst, ChevronLeft, ChevronRight, ChevronLast, Users, Sword, Flag,
    Handshake, Loader2, Play, RotateCcw, Clock, ChevronDown, ChevronUp, Palette,
    RefreshCw, ListOrdered, Undo2, Bot, MessageSquareQuote, Download, Eye,
    Sliders, Zap, X, Link2, Copy, Check, Send, MessageSquare, Radio, Volume2, VolumeX
} from 'lucide-react';
import {gameSocket} from '../services/gameSocket';
import {soundEngine, resolveMoveSound} from '../services/soundEngine';
import type {SoundEventType} from '../services/soundEngine';
import {API_BASE_URL} from '../config/api';
import {
    BOARD_THEMES,
    PIECE_SETS,
    getSavedBoardThemeKey,
    getSavedPieceSetKey,
    getPieceSvgUrl,
    getHarmoniousPieceStyle
} from '../config/boardAppearance';
import type {BoardTheme} from '../config/boardAppearance';
import {HISTORICAL_BOTS, HISTORICAL_BOTS_LIST} from '../config/champions';
import type {HistoricalBotId, HistoricalBotProfile} from '../config/champions';
import {DEFAULT_DGT_OPTION, TIME_CONTROLS} from '../config/timeControls';
import type {DgtTimingMode, Dgt2500Option, Dgt2500Group} from '../config/timeControls';
import {
    FILES, RANKS, MIN_BOARD_SIZE, MAX_BOARD_SIZE, PROMOTION_OPTIONS,
    getMaxViewportBoardSize, getDefaultBoardSize, calculateMaterialBalance, cloneChessInstance, prevIndexHelper
} from './chessboard/boardUtils';
import type {PromotionPiece} from './chessboard/boardUtils';
import {QUICK_CHAT_PRESETS} from './chessboard/types';
import type {LiveGameItem, ChatMessageItem, QueuePlayer} from './chessboard/types';

export {MIN_BOARD_SIZE, MAX_BOARD_SIZE, getMaxViewportBoardSize, getDefaultBoardSize, TIME_CONTROLS};
export type {PromotionPiece, DgtTimingMode, Dgt2500Option, Dgt2500Group};

export {BOARD_THEMES, HISTORICAL_BOTS};
export type {BoardTheme, HistoricalBotId, HistoricalBotProfile};

export default function Chessboard() {
    const navigate = useNavigate();
    const {inviteCode} = useParams<{ inviteCode?: string }>();

    const [leftSectionTab, setLeftSectionTab] = useState<'bots' | 'lobby'>('bots');
    const [lobbyTab, setLobbyTab] = useState<'lobby' | 'live'>('lobby');
    const [showInvitePanel, setShowInvitePanel] = useState(false);
    const [showAppearanceDropdown, setShowAppearanceDropdown] = useState(false);
    const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => soundEngine.isMuted());
    const appearanceDropdownRef = useRef<HTMLDivElement>(null);

    const [liveGames, setLiveGames] = useState<LiveGameItem[]>([]);
    const [spectatingGameId, setSpectatingGameId] = useState<number | null>(null);
    const [inviteColorPref, setInviteColorPref] = useState<'white' | 'black' | 'random'>('random');
    const [createdInviteCode, setCreatedInviteCode] = useState<string | null>(null);
    const [inviteCopied, setInviteCopied] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
    const [chatInput, setChatInput] = useState('');

    const [game, setGame] = useState(new Chess());
    const [history, setHistory] = useState<any[]>([]);
    const [viewIndex, setViewIndex] = useState<number>(-1);
    const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
    const [isManualFlip, setIsManualFlip] = useState<boolean>(false);

    const [pendingPromotion, setPendingPromotion] = useState<{
        from: string;
        to: string;
        color: 'w' | 'b';
        isPremove?: boolean;
    } | null>(null);

    const [premove, setPremove] = useState<{
        from: string;
        to: string;
        promotion?: PromotionPiece;
    } | null>(null);

    const [boardThemeKey, setBoardThemeKey] = useState<string>(() => getSavedBoardThemeKey());
    const [pieceSetKey, setPieceSetKey] = useState<string>(() => getSavedPieceSetKey());

    const [gameId, setGameId] = useState<number | null>(null);
    const gameIdRef = useRef<number | null>(null);
    const [myColor, setMyColor] = useState<'white' | 'black'>('white');
    const myColorRef = useRef<'white' | 'black'>('white');
    const [isSearching, setIsSearching] = useState(false);
    const [queuePlayers, setQueuePlayers] = useState<QueuePlayer[]>([]);
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [currentUsername, setCurrentUsername] = useState<string>('Вы');
    const currentUsernameRef = useRef<string>('Вы');
    const [currentUserRating, setCurrentUserRating] = useState<number>(1200);
    const [stateVersion, setStateVersion] = useState(0);
    const stateVersionRef = useRef<number>(0);

    const [selectedBotId, setSelectedBotId] = useState<HistoricalBotId>('philidor');
    const [activeBot, setActiveBot] = useState<HistoricalBotId | null>(null);
    const [botComment, setBotComment] = useState<string | null>(null);
    const [isBotThinking, setIsBotThinking] = useState<boolean>(false);
    const [savedBotGameId, setSavedBotGameId] = useState<number | null>(null);

    const [selectedTimeControl, setSelectedTimeControl] = useState<Dgt2500Option>(DEFAULT_DGT_OPTION);
    const [manualBaseMinutes, setManualBaseMinutes] = useState<number>(5);
    const [manualIncSeconds, setManualIncSeconds] = useState<number>(3);
    const [isTimeDropdownOpen, setIsTimeDropdownOpen] = useState(false);
    const timeDropdownRef = useRef<HTMLDivElement>(null);
    const boardContainerRef = useRef<HTMLDivElement>(null);
    const notationScrollRef = useRef<HTMLDivElement>(null);

    const [whitePlayer, setWhitePlayer] = useState({username: 'Белые', rating: '1200'});
    const [blackPlayer, setBlackPlayer] = useState({username: 'Черные', rating: '1200'});
    const [ratingInfo, setRatingInfo] = useState<{
        white_delta?: number;
        black_delta?: number;
        white_new_rating?: number;
        black_new_rating?: number;
    } | null>(null);

    const moveStartTime = useRef<number>(Date.now());
    const botGameSavedRef = useRef<boolean>(false);
    const lowTimeWarnedRef = useRef<boolean>(false);
    const appliedPeriodsRef = useRef<{ white: Set<number>; black: Set<number> }>({
        white: new Set(),
        black: new Set()
    });

    const [dragState, setDragState] = useState<{
        from: string;
        piece: { type: string; color: string };
        x: number;
        y: number;
    } | null>(null);

    const [boardSize, setBoardSize] = useState<number>(() => {
        const maxFit = getMaxViewportBoardSize();
        const savedSize = localStorage.getItem('michess_board_size');
        if (savedSize) {
            const parsed = Number(savedSize);
            if (!Number.isNaN(parsed) && parsed >= MIN_BOARD_SIZE) {
                return Math.min(parsed, maxFit);
            }
        }
        return maxFit;
    });
    const [isResizing, setIsResizing] = useState(false);
    const resizeStartRef = useRef<{ startX: number; startY: number; startSize: number } | null>(null);

    useEffect(() => {
        const handleWindowResize = () => {
            const maxFit = getMaxViewportBoardSize();
            setBoardSize(prev => Math.min(prev, maxFit));
        };
        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, []);

    const [whiteTimeMs, setWhiteTimeMs] = useState(180000);
    const [blackTimeMs, setBlackTimeMs] = useState(180000);

    const [sessionStats, setSessionStats] = useState({wins: 0, losses: 0, draws: 0});
    const [gameOverResult, setGameOverResult] = useState<string | null>(null);
    const [drawOfferStatus, setDrawOfferStatus] = useState<string | null>(null);
    const [rematchStatus, setRematchStatus] = useState<'none' | 'offered_by_me' | 'offered_by_opponent' | 'declined'>('none');

    const activeTheme = BOARD_THEMES[boardThemeKey] || BOARD_THEMES.walnut;
    const activePieceSet = PIECE_SETS[pieceSetKey] || PIECE_SETS.merida;
    const selectedBotProfile = HISTORICAL_BOTS[selectedBotId];
    const activeBotProfile = activeBot ? HISTORICAL_BOTS[activeBot] : null;

    const effectiveWhiteBaseMinutes = selectedTimeControl.isManual ? manualBaseMinutes : selectedTimeControl.base;
    const effectiveBlackBaseMinutes = selectedTimeControl.isManual
        ? manualBaseMinutes
        : (selectedTimeControl.blackBase ?? selectedTimeControl.base);
    const effectiveIncSeconds = selectedTimeControl.isManual ? manualIncSeconds : selectedTimeControl.inc;

    const isBoardFlipped = (myColor === 'black') !== isManualFlip;

    const playAudio = useCallback((type: SoundEventType) => {
        soundEngine.play(type);
    }, []);

    const playOutcomeSound = useCallback((result: string, playerColor: 'white' | 'black' = myColorRef.current) => {
        if (!result || result === '*') {
            soundEngine.play('decline');
            return;
        }
        if (result === '1/2-1/2' || result.includes('draw')) {
            soundEngine.play('draw');
            return;
        }
        const whiteWon = result === '1-0' || result === 'white_won_on_time';
        const isWin = (whiteWon && playerColor === 'white') || (!whiteWon && playerColor === 'black');
        soundEngine.play(isWin ? 'victory' : 'defeat');
    }, []);

    const handleToggleSound = () => {
        const nextMuted = soundEngine.toggleMute();
        setIsSoundMuted(nextMuted);
        if (!nextMuted) {
            soundEngine.play('move');
        }
    };

    const updateSessionStats = useCallback((result: string) => {
        if (!result || result === '*') return;
        setSessionStats(prev => {
            if (result === '1/2-1/2' || result.includes('draw')) {
                return {...prev, draws: prev.draws + 1};
            }
            const whiteWon = result === '1-0' || result === 'white_won_on_time';
            const userIsWhite = myColorRef.current === 'white';
            if ((whiteWon && userIsWhite) || (!whiteWon && !userIsWhite)) {
                return {...prev, wins: prev.wins + 1};
            } else {
                return {...prev, losses: prev.losses + 1};
            }
        });
    }, []);

    const applyMatchFoundSnapshot = useCallback((data: any) => {
        if (!data || !data.game_id) return;
        const incomingGid = Number(data.game_id);
        const assignedColor: 'white' | 'black' = data.color === 'black' ? 'black' : 'white';
        const ver = Number(data.state_version || 0);
        const isNewMatch = gameIdRef.current !== incomingGid;

        setIsSearching(false);
        setSpectatingGameId(null);
        setCreatedInviteCode(null);
        setShowInvitePanel(false);
        setActiveBot(null);
        setBotComment(null);
        setSavedBotGameId(null);
        botGameSavedRef.current = false;

        if (isNewMatch) {
            lowTimeWarnedRef.current = false;
            setChatMessages([]);
            appliedPeriodsRef.current = {white: new Set(), black: new Set()};
            setIsManualFlip(false);
            setRatingInfo(null);
            setGameOverResult(null);
            setRematchStatus('none');
            setSelectedSquare(null);
            setPendingPromotion(null);
            setPremove(null);
        }

        gameIdRef.current = incomingGid;
        setGameId(incomingGid);
        myColorRef.current = assignedColor;
        setMyColor(assignedColor);
        setStateVersion(ver);
        stateVersionRef.current = ver;

        const initialWhiteTime = data.white_time_ms !== undefined ? Number(data.white_time_ms) : Number(data.base_time_ms || 180000);
        const initialBlackTime = data.black_time_ms !== undefined ? Number(data.black_time_ms) : Number(data.base_time_ms || 180000);
        setWhiteTimeMs(initialWhiteTime);
        setBlackTimeMs(initialBlackTime);

        if (data.white_username) {
            setWhitePlayer({username: data.white_username, rating: String(data.white_rating || '1200')});
        }
        if (data.black_username) {
            setBlackPlayer({username: data.black_username, rating: String(data.black_rating || '1200')});
        }

        const restoredGame = new Chess();
        if (data.pgn) {
            try {
                restoredGame.loadPgn(data.pgn);
            } catch {
                if (data.fen) restoredGame.load(data.fen);
            }
        } else if (data.fen) {
            restoredGame.load(data.fen);
        }

        setGame(restoredGame);
        setHistory(restoredGame.history({verbose: true}));
        setViewIndex(-1);
        moveStartTime.current = Date.now();

        if (isNewMatch) {
            setDrawOfferStatus(`Партия началась! Вы играете ${assignedColor === 'white' ? 'Белыми' : 'Чёрными'}.`);
            playAudio('start');
            setTimeout(() => setDrawOfferStatus(null), 3000);
        }
    }, [playAudio]);

    const applyMoveMadeSnapshot = useCallback((data: any) => {
        if (data.state_version !== undefined) {
            const ver = Number(data.state_version);
            setStateVersion(ver);
            stateVersionRef.current = ver;
        }
        if (data.white_time_ms !== undefined) setWhiteTimeMs(Number(data.white_time_ms));
        if (data.black_time_ms !== undefined) setBlackTimeMs(Number(data.black_time_ms));
        moveStartTime.current = Date.now();

        const nextGame = new Chess();
        let loaded = false;

        if (data.pgn) {
            try {
                nextGame.loadPgn(data.pgn);
                loaded = true;
            } catch {
                loaded = false;
            }
        }

        if (!loaded && data.fen) {
            try {
                nextGame.load(data.fen);
                loaded = true;
            } catch {
                loaded = false;
            }
        }

        if (loaded) {
            const newHistory = nextGame.history({verbose: true});
            const lastSan = data.san || (newHistory.length > 0 ? newHistory[newHistory.length - 1].san : '');
            setGame(nextGame);
            setHistory(newHistory);
            setViewIndex(-1);
            playAudio(resolveMoveSound(lastSan));
        }

        if (data.game_over) {
            setPremove(null);
            setPendingPromotion(null);
            setGameOverResult(data.result);
            setRatingInfo(data);
            playOutcomeSound(data.result);
            updateSessionStats(data.result);
        }
    }, [playAudio, playOutcomeSound, updateSessionStats]);

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
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    bot_id: botId,
                    player_color: playerColor,
                    result,
                    // Для позиции, не завершённой на доске, сервер требует причину окончания.
                    termination: termination ?? null,
                    moves_uci: movesUci,
                    base_time_ms: Math.round(effectiveWhiteBaseMinutes * 60 * 1000),
                    increment_ms: Math.round(effectiveIncSeconds * 1000)
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.game_id) {
                    setSavedBotGameId(data.game_id);
                }
                // Итог определяет сервер: например, флаг при недостатке материала у соперника — ничья.
                if (data.result && data.result !== result) {
                    setGameOverResult(data.result);
                    setDrawOfferStatus(`Итог по правилам ФИДЕ: ${data.result}`);
                }
            }
        } catch (err) {
            console.error('Ошибка сохранения партии с ботом в БД:', err);
        }
    }, [effectiveWhiteBaseMinutes, effectiveIncSeconds]);

    const applyDgtClockAfterMove = useCallback((
        moverColor: 'white' | 'black',
        elapsedMs: number,
        totalHalfMovesAfter: number
    ) => {
        const mode = selectedTimeControl.mode;
        const baseMs = Math.round(
            (moverColor === 'white' ? effectiveWhiteBaseMinutes : effectiveBlackBaseMinutes) * 60 * 1000
        );
        const completedMovesForSide = Math.ceil(totalHalfMovesAfter / 2);

        let incSeconds = effectiveIncSeconds;
        if (selectedTimeControl.incrementFromMove) {
            if (completedMovesForSide >= selectedTimeControl.incrementFromMove) {
                const extraInc = selectedTimeControl.periods?.find(p => p.extraIncSeconds)?.extraIncSeconds;
                incSeconds = extraInc ?? effectiveIncSeconds;
            } else {
                incSeconds = 0;
            }
        }
        const incMs = Math.round(incSeconds * 1000);

        let periodExtraMs = 0;
        if (selectedTimeControl.periods) {
            selectedTimeControl.periods.forEach((period, idx) => {
                if (
                    period.moves &&
                    completedMovesForSide >= period.moves &&
                    !appliedPeriodsRef.current[moverColor].has(idx)
                ) {
                    appliedPeriodsRef.current[moverColor].add(idx);
                    periodExtraMs += Math.round(period.extraMinutes * 60 * 1000);
                }
            });
        }

        const updateTimer = (prevMs: number) => {
            if (mode === 'gong' || mode === 'move_timer') {
                return baseMs;
            }
            if (mode === 'delay' || mode === 'us_delay') {
                return prevMs + Math.min(elapsedMs, incMs) + periodExtraMs;
            }
            if (mode === 'fischer' || mode === 'byo_yomi') {
                return prevMs + incMs + periodExtraMs;
            }
            return prevMs + periodExtraMs;
        };

        if (moverColor === 'white') {
            setWhiteTimeMs(updateTimer);
        } else {
            setBlackTimeMs(updateTimer);
        }
    }, [selectedTimeControl, effectiveWhiteBaseMinutes, effectiveBlackBaseMinutes, effectiveIncSeconds]);

    const handleThemeChange = (themeId: string) => {
        setBoardThemeKey(themeId);
        localStorage.setItem('michess_board_theme', themeId);
    };

    const handlePieceSetChange = (setId: string) => {
        setPieceSetKey(setId);
        localStorage.setItem('michess_piece_set', setId);
    };

    const startHistoricalBotGame = (botId: HistoricalBotId, colorPref: 'white' | 'black' | 'random' = 'random') => {
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
        lowTimeWarnedRef.current = false;
        appliedPeriodsRef.current = {white: new Set(), black: new Set()};
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
        setPremove(null);
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
    };

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
                        const elapsed = Date.now() - moveStartTime.current;
                        const newHistory = nextGame.history({verbose: true});
                        const botColor: 'white' | 'black' = myColor === 'white' ? 'black' : 'white';

                        applyDgtClockAfterMove(botColor, elapsed, newHistory.length);
                        setGame(nextGame);
                        setHistory(newHistory);
                        setViewIndex(-1);
                        setBotComment(data.comment);
                        moveStartTime.current = Date.now();

                        playAudio(resolveMoveSound(moveObj.san));

                        if (nextGame.isGameOver()) {
                            let result = '1/2-1/2';
                            if (nextGame.isCheckmate()) {
                                result = nextGame.turn() === 'w' ? '0-1' : '1-0';
                            }
                            setPremove(null);
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
    }, [activeBot, game, myColor, gameOverResult, playAudio, playOutcomeSound, updateSessionStats, saveBotGameToDatabase, applyDgtClockAfterMove]);

    useEffect(() => {
        if (!isResizing) return;

        const prevCursor = document.body.style.cursor;
        const prevUserSelect = document.body.style.userSelect;
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';

        const handleResizeMove = (e: PointerEvent) => {
            if (!resizeStartRef.current) return;
            const {startX, startY, startSize} = resizeStartRef.current;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            const delta = Math.round((deltaX + deltaY) / 2);

            const dynamicMax = getMaxViewportBoardSize();
            const nextSize = Math.min(Math.max(startSize + delta, MIN_BOARD_SIZE), dynamicMax);
            setBoardSize(nextSize);
            localStorage.setItem('michess_board_size', String(nextSize));
        };

        const handleResizeEnd = () => {
            setIsResizing(false);
            resizeStartRef.current = null;
        };

        window.addEventListener('pointermove', handleResizeMove);
        window.addEventListener('pointerup', handleResizeEnd);
        window.addEventListener('pointercancel', handleResizeEnd);

        return () => {
            document.body.style.cursor = prevCursor;
            document.body.style.userSelect = prevUserSelect;
            window.removeEventListener('pointermove', handleResizeMove);
            window.removeEventListener('pointerup', handleResizeEnd);
            window.removeEventListener('pointercancel', handleResizeEnd);
        };
    }, [isResizing]);

    const handleResizePointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeStartRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startSize: boardSize
        };
        setIsResizing(true);
    };

    const handleResizeDoubleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const defaultSize = getDefaultBoardSize();
        setBoardSize(defaultSize);
        localStorage.setItem('michess_board_size', String(defaultSize));
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setPendingPromotion(null);
                setPremove(null);
                setSelectedSquare(null);
                setShowAppearanceDropdown(false);
                return;
            }
            if (history.length === 0) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setViewIndex(prev => {
                    const current = prev === -1 ? history.length - 1 : prev;
                    const nextIdx = current <= 0 ? -2 : current - 1;
                    if (nextIdx >= 0 && history[nextIdx]) {
                        playAudio(resolveMoveSound(history[nextIdx].san));
                    } else {
                        playAudio('move');
                    }
                    return nextIdx;
                });
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setViewIndex(prev => {
                    if (prev === -1) return -1;
                    const nextIdx = prev === -2
                        ? (history.length > 1 ? 0 : -1)
                        : (prev + 1 >= history.length - 1 ? -1 : prev + 1);
                    const targetMove = nextIdx === -1 ? history[history.length - 1] : history[nextIdx];
                    if (targetMove) {
                        playAudio(resolveMoveSound(targetMove.san));
                    }
                    return nextIdx;
                });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setViewIndex(-2);
                playAudio('move');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setViewIndex(-1);
                playAudio('move');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [history, playAudio]);

    useEffect(() => {
        if (notationScrollRef.current) {
            const activeEl = notationScrollRef.current.querySelector('.active-move-btn');
            if (activeEl) {
                activeEl.scrollIntoView({behavior: 'smooth', block: 'nearest'});
            } else if (viewIndex === -1) {
                notationScrollRef.current.scrollTop = notationScrollRef.current.scrollHeight;
            }
        }
    }, [history.length, viewIndex]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (timeDropdownRef.current && !timeDropdownRef.current.contains(event.target as Node)) {
                setIsTimeDropdownOpen(false);
            }
            if (appearanceDropdownRef.current && !appearanceDropdownRef.current.contains(event.target as Node)) {
                setShowAppearanceDropdown(false);
            }
        };

        if (isTimeDropdownOpen || showAppearanceDropdown) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isTimeDropdownOpen, showAppearanceDropdown]);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        fetch(`${API_BASE_URL}/api/v1/profile/me`, {
            headers: {'Authorization': `Bearer ${token}`}
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data) {
                    setCurrentUserId(data.id);
                    if (data.username) {
                        setCurrentUsername(data.username);
                        currentUsernameRef.current = data.username;
                    }
                    if (data.rating) setCurrentUserRating(data.rating);
                }
            })
            .catch(() => {
            });
    }, []);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        gameSocket.connect(token);

        const handleMatchFound = (data: any) => {
            applyMatchFoundSnapshot(data);
        };

        const handleMoveMade = (data: any) => {
            applyMoveMadeSnapshot(data);
        };

        const handleGameOver = (data: any) => {
            setPremove(null);
            setPendingPromotion(null);
            setGameOverResult(prev => {
                if (!prev) {
                    playOutcomeSound(data.result);
                    updateSessionStats(data.result);
                }
                return data.result;
            });
            setRatingInfo(data);
            if (data.white_time_ms !== undefined) setWhiteTimeMs(data.white_time_ms);
            if (data.black_time_ms !== undefined) setBlackTimeMs(data.black_time_ms);
            if (data.reason === 'aborted' || data.result === '*') {
                setDrawOfferStatus('Партия отменена на 1-м ходу (рейтинг не изменён).');
            } else if (data.result) {
                setDrawOfferStatus(`Партия окончена. Результат: ${data.result}`);
            }
        };

        const handleDrawOffered = () => {
            setDrawOfferStatus('Соперник предлагает ничью.');
            playAudio('offer');
        };

        const handleDrawDeclined = () => {
            setDrawOfferStatus('Предложение ничьей отклонено.');
            playAudio('decline');
            setTimeout(() => setDrawOfferStatus(null), 3000);
        };

        const handleRematchOffered = () => {
            setRematchStatus('offered_by_opponent');
            playAudio('offer');
        };

        const handleRematchDeclined = () => {
            setRematchStatus('declined');
            playAudio('decline');
        };

        const handleInviteCreated = (data: any) => {
            if (data.code) {
                setCreatedInviteCode(data.code);
                const url = `${window.location.origin}/challenge/${data.code}`;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).catch(() => {
                    });
                }
                setInviteCopied(true);
                playAudio('offer');
                setTimeout(() => setInviteCopied(false), 3000);
            }
        };

        const handleSpectateStarted = (data: any) => {
            setIsSearching(false);
            setActiveBot(null);
            gameIdRef.current = null;
            setGameId(null);
            setSpectatingGameId(data.game_id);
            setWhitePlayer({username: data.white_username || 'Белые', rating: String(data.white_rating || 1200)});
            setBlackPlayer({username: data.black_username || 'Черные', rating: String(data.black_rating || 1200)});
            setWhiteTimeMs(data.white_time_ms ?? data.base_time_ms ?? 180000);
            setBlackTimeMs(data.black_time_ms ?? data.base_time_ms ?? 180000);

            const restored = new Chess();
            if (data.pgn) {
                try {
                    restored.loadPgn(data.pgn);
                } catch {
                    if (data.fen) restored.load(data.fen);
                }
            } else if (data.fen) {
                restored.load(data.fen);
            }
            setGame(restored);
            setHistory(restored.history({verbose: true}));
            setViewIndex(-1);
            setGameOverResult(null);
            setChatMessages([]);
            setDrawOfferStatus(`Режим зрителя: ${data.white_username} vs ${data.black_username}`);
            playAudio('start');
        };

        const handleChatMessage = (data: any) => {
            if (data.text && data.sender) {
                setChatMessages(prev => [...prev.slice(-49), {
                    sender: data.sender,
                    text: data.text,
                    timestamp: data.timestamp || Date.now()
                }]);
                if (data.sender !== currentUsernameRef.current) {
                    playAudio('chat');
                }
            }
        };

        const handleServerError = (data: any) => {
            console.warn('Сервер отклонил действие:', data);
            if (data.code) {
                // Отказ матчмейкинга (уже в партии, вне диапазона рейтинга, вызов неактуален...):
                // показываем причину и выходим из режима поиска, ход на доске не трогаем.
                setIsSearching(false);
                if (data.message) setDrawOfferStatus(data.message);
                return;
            }
            setPremove(null);
            playAudio('illegal');
            if (data.pgn || data.fen) {
                const syncedGame = new Chess();
                if (data.pgn) {
                    try {
                        syncedGame.loadPgn(data.pgn);
                    } catch {
                        if (data.fen) syncedGame.load(data.fen);
                    }
                } else if (data.fen) {
                    syncedGame.load(data.fen);
                }
                setGame(syncedGame);
                setHistory(syncedGame.history({verbose: true}));
            }
            if (data.state_version !== undefined) {
                const ver = Number(data.state_version);
                setStateVersion(ver);
                stateVersionRef.current = ver;
            }
        };

        gameSocket.on('match_found', handleMatchFound);
        gameSocket.on('move_made', handleMoveMade);
        gameSocket.on('game_over', handleGameOver);
        gameSocket.on('draw_offered', handleDrawOffered);
        gameSocket.on('draw_declined', handleDrawDeclined);
        gameSocket.on('rematch_offered', handleRematchOffered);
        gameSocket.on('rematch_declined', handleRematchDeclined);
        gameSocket.on('invite_created', handleInviteCreated);
        gameSocket.on('spectate_started', handleSpectateStarted);
        gameSocket.on('chat_message', handleChatMessage);
        gameSocket.on('error', handleServerError);

        return () => {
            gameSocket.off('match_found', handleMatchFound);
            gameSocket.off('move_made', handleMoveMade);
            gameSocket.off('game_over', handleGameOver);
            gameSocket.off('draw_offered', handleDrawOffered);
            gameSocket.off('draw_declined', handleDrawDeclined);
            gameSocket.off('rematch_offered', handleRematchOffered);
            gameSocket.off('rematch_declined', handleRematchDeclined);
            gameSocket.off('invite_created', handleInviteCreated);
            gameSocket.off('spectate_started', handleSpectateStarted);
            gameSocket.off('chat_message', handleChatMessage);
            gameSocket.off('error', handleServerError);
        };
    }, [applyMatchFoundSnapshot, applyMoveMadeSnapshot, playAudio, playOutcomeSound, updateSessionStats]);

    useEffect(() => {
        if (!inviteCode || !localStorage.getItem('token')) return;
        const timer = setTimeout(() => {
            gameSocket.send('accept_invite', {code: inviteCode});
            navigate('/', {replace: true});
        }, 450);
        return () => clearTimeout(timer);
    }, [inviteCode, navigate]);

    useEffect(() => {
        const syncLobbyAndActiveGame = async () => {
            const token = localStorage.getItem('token');
            try {
                if (token && !activeBot && !spectatingGameId) {
                    const activeRes = await fetch(`${API_BASE_URL}/api/v1/profile/games/my-active`, {
                        headers: {'Authorization': `Bearer ${token}`}
                    });
                    if (activeRes.ok) {
                        const activeData = await activeRes.json();
                        if (activeData && activeData.active && activeData.game_id) {
                            if (gameIdRef.current !== Number(activeData.game_id)) {
                                applyMatchFoundSnapshot(activeData);
                                return;
                            } else if (Number(activeData.state_version || 0) > stateVersionRef.current) {
                                applyMoveMadeSnapshot(activeData);
                            }
                        }
                    }
                }

                if (!gameIdRef.current) {
                    const [qRes, liveRes] = await Promise.all([
                        fetch(`${API_BASE_URL}/api/v1/profile/matchmaking/queue`),
                        fetch(`${API_BASE_URL}/api/v1/profile/games/live`)
                    ]);
                    if (qRes.ok) {
                        setQueuePlayers(await qRes.json());
                    }
                    if (liveRes.ok) {
                        setLiveGames(await liveRes.json());
                    }
                } else {
                    setQueuePlayers([]);
                }
            } catch (e) {
                console.error('Failed to sync lobby/active game data', e);
            }
        };

        syncLobbyAndActiveGame();
        const interval = setInterval(syncLobbyAndActiveGame, 1500);
        return () => clearInterval(interval);
    }, [activeBot, spectatingGameId, applyMatchFoundSnapshot, applyMoveMadeSnapshot]);

    const currentTurnChar = game.turn();

    useEffect(() => {
        if ((!gameId && !activeBot && !spectatingGameId) || gameOverResult) return;

        let lastTick = Date.now();
        const currentTurnColor = currentTurnChar === 'w' ? 'white' : 'black';
        const isHourglass = !gameId && selectedTimeControl.mode === 'hourglass';
        const isScrabble = !gameId && selectedTimeControl.mode === 'scrabble';

        const interval = setInterval(() => {
            const now = Date.now();
            const delta = now - lastTick;
            lastTick = now;

            if (currentTurnColor === 'white') {
                setWhiteTimeMs(prev => isScrabble ? prev - delta : Math.max(0, prev - delta));
                if (isHourglass) {
                    setBlackTimeMs(prev => prev + delta);
                }
            } else {
                setBlackTimeMs(prev => isScrabble ? prev - delta : Math.max(0, prev - delta));
                if (isHourglass) {
                    setWhiteTimeMs(prev => prev + delta);
                }
            }
        }, 50);

        return () => clearInterval(interval);
    }, [gameId, activeBot, spectatingGameId, gameOverResult, currentTurnChar, selectedTimeControl.mode]);

    // Звуковое предупреждение о цейтноте (< 10 секунд на часах игрока)
    useEffect(() => {
        if ((!gameId && !activeBot) || gameOverResult || lowTimeWarnedRef.current) return;
        const myRemainingMs = myColor === 'white' ? whiteTimeMs : blackTimeMs;
        if (myRemainingMs > 0 && myRemainingMs <= 10000) {
            lowTimeWarnedRef.current = true;
            playAudio('low_time');
        }
    }, [whiteTimeMs, blackTimeMs, gameId, activeBot, gameOverResult, myColor, playAudio]);

    useEffect(() => {
        if (!activeBot || gameOverResult || selectedTimeControl.mode === 'scrabble') return;

        if (whiteTimeMs <= 0 || blackTimeMs <= 0) {
            const flagWinner = whiteTimeMs <= 0 ? '0-1' : '1-0';
            const botName = HISTORICAL_BOTS[activeBot].shortName;
            setPremove(null);
            setPendingPromotion(null);
            setGameOverResult(flagWinner);
            setDrawOfferStatus(`Флажок упал! Партия против ${botName} завершена по времени (${flagWinner}).`);
            updateSessionStats(flagWinner);
            playOutcomeSound(flagWinner, myColor);
            saveBotGameToDatabase(activeBot, myColor, flagWinner, game, 'timeout');
        }
    }, [whiteTimeMs, blackTimeMs, activeBot, gameOverResult, selectedTimeControl.mode, myColor, game, playOutcomeSound, updateSessionStats, saveBotGameToDatabase]);

    const executeMove = useCallback((
        from: string,
        to: string,
        explicitPromotion?: PromotionPiece,
        isPremoveMove: boolean = false
    ): boolean => {
        if (gameOverResult || viewIndex !== -1 || spectatingGameId) return false;

        const piece = game.get(from as any);
        const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';

        if (!piece || piece.color !== (game.turn() === 'w' ? 'w' : 'b') || ((gameId || activeBot || spectatingGameId) && currentTurnColor !== myColor)) {
            setSelectedSquare(null);
            return false;
        }

        const targetRank = to[1];
        const isPawnPromotion =
            piece.type === 'p' &&
            ((piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1'));

        if (isPawnPromotion && !explicitPromotion && !isPremoveMove) {
            try {
                const probeGame = cloneChessInstance(game);
                const testMove = probeGame.move({from, to, promotion: 'q'});
                if (testMove) {
                    setPendingPromotion({
                        from,
                        to,
                        color: piece.color as 'w' | 'b',
                        isPremove: false
                    });
                    setSelectedSquare(null);
                    setDragState(null);
                    return true;
                }
            } catch {
                setSelectedSquare(null);
                setDragState(null);
                return false;
            }
        }

        const chosenPromotion: PromotionPiece = explicitPromotion || 'q';

        try {
            const nextGame = cloneChessInstance(game);
            const move = nextGame.move({
                from,
                to,
                ...(isPawnPromotion ? {promotion: chosenPromotion} : {})
            });

            if (move) {
                const timeTaken = isPremoveMove ? 0 : Math.max(0, Date.now() - moveStartTime.current);
                const uciMove = (move as any).uci || `${move.from}${move.to}${move.promotion || ''}`;
                const newHistory = nextGame.history({verbose: true});

                if (activeBot) {
                    applyDgtClockAfterMove(myColor, timeTaken, newHistory.length);
                }

                setPendingPromotion(null);
                setGame(nextGame);
                setHistory(newHistory);
                setViewIndex(-1);
                playAudio(resolveMoveSound(move.san));
                moveStartTime.current = Date.now();

                if (gameId) {
                    const commandId = typeof crypto !== 'undefined' && crypto.randomUUID
                        ? crypto.randomUUID()
                        : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

                    gameSocket.send('make_move', {
                        game_id: gameId,
                        move: uciMove,
                        command_id: commandId,
                        state_version: stateVersionRef.current,
                        time_taken_ms: timeTaken,
                        window_blurred: document.hidden,
                        is_premove: isPremoveMove
                    });
                } else if (activeBot && nextGame.isGameOver()) {
                    let result = '1/2-1/2';
                    if (nextGame.isCheckmate()) {
                        result = nextGame.turn() === 'w' ? '0-1' : '1-0';
                    }
                    const botName = HISTORICAL_BOTS[activeBot].shortName;
                    setGameOverResult(result);
                    setDrawOfferStatus(`Партия против ${botName} окончена и сохранена в архив (${result}).`);
                    updateSessionStats(result);
                    playOutcomeSound(result, myColor);
                    saveBotGameToDatabase(activeBot, myColor, result, nextGame);
                }
                setSelectedSquare(null);
                setDragState(null);
                return true;
            }
        } catch {
            setSelectedSquare(null);
        }
        setDragState(null);
        return false;
    }, [game, gameId, activeBot, spectatingGameId, myColor, stateVersion, viewIndex, gameOverResult, playAudio, playOutcomeSound, updateSessionStats, saveBotGameToDatabase, applyDgtClockAfterMove]);

    const scheduleOrPromotePremove = useCallback((from: string, to: string, explicitPromotion?: PromotionPiece) => {
        if (from === to) return;
        const piece = game.get(from as any);
        const myColorChar = myColor === 'white' ? 'w' : 'b';
        if (!piece || piece.color !== myColorChar) {
            setSelectedSquare(null);
            return;
        }

        const targetRank = to[1];
        const isPawnPromotion =
            piece.type === 'p' &&
            ((piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1'));

        if (isPawnPromotion && !explicitPromotion) {
            setPendingPromotion({
                from,
                to,
                color: myColorChar,
                isPremove: true
            });
            setSelectedSquare(null);
            setDragState(null);
            return;
        }

        setPremove({
            from,
            to,
            promotion: isPawnPromotion ? (explicitPromotion || 'q') : undefined
        });
        playAudio('premove');
        setPendingPromotion(null);
        setSelectedSquare(null);
        setDragState(null);
    }, [game, myColor, playAudio]);

    useEffect(() => {
        if (!premove || gameOverResult || viewIndex !== -1) return;
        if (!gameId && !activeBot) return;

        const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';
        if (currentTurnColor !== myColor) return;

        const currentPremove = premove;
        setPremove(null);
        executeMove(currentPremove.from, currentPremove.to, currentPremove.promotion || 'q', true);
    }, [game, premove, gameId, activeBot, myColor, gameOverResult, viewIndex, executeMove]);

    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (!dragState) return;
            setDragState(prev => prev ? {...prev, x: e.clientX, y: e.clientY} : null);
        };

        const handlePointerUp = (e: PointerEvent) => {
            if (!dragState) return;

            let targetSquare: string | null = null;

            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const squareEl = Array.from(elements || []).find(el => el.hasAttribute('data-square'));
            if (squareEl) {
                targetSquare = squareEl.getAttribute('data-square');
            }

            if (!targetSquare && boardContainerRef.current) {
                const rect = boardContainerRef.current.getBoundingClientRect();
                const padding = 10;
                const innerLeft = rect.left + padding;
                const innerTop = rect.top + padding;
                const innerWidth = rect.width - padding * 2;
                const innerHeight = rect.height - padding * 2;

                const x = e.clientX - innerLeft;
                const y = e.clientY - innerTop;

                if (x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight) {
                    const fileIdx = Math.floor((x / innerWidth) * 8);
                    const rankIdx = Math.floor((y / innerHeight) * 8);

                    const files = isBoardFlipped ? [...FILES].reverse() : FILES;
                    const ranks = isBoardFlipped
                        ? ['1', '2', '3', '4', '5', '6', '7', '8']
                        : ['8', '7', '6', '5', '4', '3', '2', '1'];

                    if (files[fileIdx] && ranks[rankIdx]) {
                        targetSquare = `${files[fileIdx]}${ranks[rankIdx]}`;
                    }
                }
            }

            if (targetSquare && targetSquare !== dragState.from) {
                const turnColor = game.turn() === 'w' ? 'white' : 'black';
                if ((gameId || activeBot || spectatingGameId) && turnColor !== myColor) {
                    scheduleOrPromotePremove(dragState.from, targetSquare);
                } else {
                    executeMove(dragState.from, targetSquare);
                }
            }

            setDragState(null);
        };

        if (dragState) {
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
            window.addEventListener('pointercancel', handlePointerUp);
        }

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [dragState, isBoardFlipped, game, gameId, activeBot, spectatingGameId, myColor, executeMove, scheduleOrPromotePremove]);

    const formatTime = (ms: number) => {
        const isOvertimeUpcount = ms < 0 && selectedTimeControl.mode === 'scrabble';
        const totalMs = isOvertimeUpcount ? Math.abs(ms) : Math.max(0, ms);
        const totalSecs = Math.floor(totalMs / 1000);
        const hours = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        const prefix = isOvertimeUpcount ? '+' : '';

        if (hours > 0) {
            return `${prefix}${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        if (!isOvertimeUpcount && totalMs < 30000 && totalMs > 0) {
            const tenths = Math.floor((totalMs % 1000) / 100);
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
        }

        return `${prefix}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const startMatchmaking = async () => {
        gameIdRef.current = null;
        setGameId(null);
        setActiveBot(null);
        setBotComment(null);
        setSavedBotGameId(null);
        botGameSavedRef.current = false;
        lowTimeWarnedRef.current = false;
        appliedPeriodsRef.current = {white: new Set(), black: new Set()};
        setPendingPromotion(null);
        setPremove(null);
        setGameOverResult(null);
        setRatingInfo(null);
        setIsSearching(true);
        setLeftSectionTab('lobby');
        setLobbyTab('lobby');
        setIsTimeDropdownOpen(false);
        setDrawOfferStatus(`Вы опубликовали вызов в лобби (Опция DGT #${selectedTimeControl.optionNumber})...`);

        const baseMs = Math.round(effectiveWhiteBaseMinutes * 60 * 1000);
        const incMs = Math.round(effectiveIncSeconds * 1000);

        gameSocket.send('join_queue', {
            base_time_ms: baseMs,
            increment_ms: incMs
        });

        const token = localStorage.getItem('token');
        if (token) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/v1/profile/matchmaking/join`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({base_time_ms: baseMs, increment_ms: incMs})
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.active && data.game_id) {
                        applyMatchFoundSnapshot(data);
                    }
                }
            } catch {
                // Игнорируем ошибку, если сработал WebSocket
            }
        }
    };

    const cancelMatchmaking = async () => {
        setIsSearching(false);
        setDrawOfferStatus(null);
        gameSocket.send('leave_queue', {});
        const token = localStorage.getItem('token');
        if (token) {
            fetch(`${API_BASE_URL}/api/v1/profile/matchmaking/leave`, {
                method: 'POST',
                headers: {'Authorization': `Bearer ${token}`}
            }).catch(() => {
            });
        }
    };

    const acceptChallenge = async (targetUserId: number) => {
        setActiveBot(null);
        setBotComment(null);
        setSavedBotGameId(null);
        setPendingPromotion(null);
        setPremove(null);
        botGameSavedRef.current = false;

        gameSocket.send('accept_challenge', {target_user_id: targetUserId});

        const token = localStorage.getItem('token');
        if (!token) return;

        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/profile/matchmaking/accept/${targetUserId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.game_id) {
                    applyMatchFoundSnapshot(data);
                }
            }
        } catch (err) {
            console.error('Ошибка при принятии вызова по HTTP:', err);
        }
    };

    const handleCreatePrivateInvite = () => {
        gameSocket.send('create_invite', {
            base_time_ms: Math.round(effectiveWhiteBaseMinutes * 60 * 1000),
            increment_ms: Math.round(effectiveIncSeconds * 1000),
            color_pref: inviteColorPref
        });
    };

    const handleCopyInviteLink = () => {
        if (!createdInviteCode) return;
        const url = `${window.location.origin}/challenge/${createdInviteCode}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).catch(() => {
            });
        }
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2500);
    };

    const handleSpectateGame = (targetGameId: number) => {
        gameSocket.send('spectate_game', {game_id: targetGameId});
    };

    const handleLeaveSpectate = () => {
        if (spectatingGameId) {
            gameSocket.send('leave_spectate', {game_id: spectatingGameId});
        }
        setSpectatingGameId(null);
        handleResetSandbox();
    };

    const handleSendChatMessage = (textToSend?: string) => {
        const activeGid = gameId || spectatingGameId;
        const finalMsg = (textToSend ?? chatInput).trim();
        if (!activeGid || !finalMsg) return;
        gameSocket.send('chat_message', {
            game_id: activeGid,
            text: finalMsg.slice(0, 140)
        });
        if (!textToSend) setChatInput('');
    };

    const handleAbortGame = () => {
        if ((!gameId && !activeBot) || gameOverResult || history.length >= 2) return;
        setPendingPromotion(null);
        setPremove(null);
        if (gameId) {
            gameSocket.send('abort_game', {game_id: gameId});
        } else if (activeBot) {
            setGameOverResult('*');
            setDrawOfferStatus('Партия отменена без изменения счёта.');
            playAudio('decline');
        }
    };

    const handleOfferRematch = () => {
        if (gameId && gameOverResult) {
            gameSocket.send('offer_rematch', {game_id: gameId});
            setRematchStatus('offered_by_me');
            playAudio('premove');
        } else if (activeBot && gameOverResult) {
            const nextColor = myColor === 'white' ? 'black' : 'white';
            startHistoricalBotGame(activeBot, nextColor);
        }
    };

    const handleAcceptRematch = () => {
        if (!gameId) return;
        gameSocket.send('accept_rematch', {game_id: gameId});
    };

    const handleDeclineRematch = () => {
        if (!gameId) return;
        gameSocket.send('decline_rematch', {game_id: gameId});
        setRematchStatus('none');
        playAudio('decline');
    };

    const handleResign = () => {
        if ((!gameId && !activeBot) || gameOverResult) return;
        if (window.confirm('Вы действительно хотите сдаться?')) {
            setPendingPromotion(null);
            setPremove(null);
            if (gameId) {
                gameSocket.send('resign', {game_id: gameId});
            } else if (activeBot) {
                const res = myColor === 'white' ? '0-1' : '1-0';
                const botName = HISTORICAL_BOTS[activeBot].shortName;
                setGameOverResult(res);
                setDrawOfferStatus(`Вы сдались. Победа ${botName} (${res}).`);
                updateSessionStats(res);
                playOutcomeSound(res, myColor);
                saveBotGameToDatabase(activeBot, myColor, res, game, 'resignation');
            }
        }
    };

    const handleOfferDraw = () => {
        if (!gameId || gameOverResult) return;
        gameSocket.send('offer_draw', {game_id: gameId});
        setDrawOfferStatus('Вы предложили ничью...');
        playAudio('premove');
    };

    const acceptDraw = () => {
        if (!gameId) return;
        gameSocket.send('accept_draw', {game_id: gameId});
        setDrawOfferStatus(null);
    };

    const declineDraw = () => {
        if (!gameId) return;
        gameSocket.send('decline_draw', {game_id: gameId});
        setDrawOfferStatus(null);
        playAudio('decline');
    };

    const handleResetSandbox = () => {
        if (gameId && !gameOverResult) return;
        gameIdRef.current = null;
        setGameId(null);
        setActiveBot(null);
        setBotComment(null);
        setSavedBotGameId(null);
        botGameSavedRef.current = false;
        lowTimeWarnedRef.current = false;
        appliedPeriodsRef.current = {white: new Set(), black: new Set()};
        setIsBotThinking(false);
        setGameOverResult(null);
        setRatingInfo(null);
        setDrawOfferStatus(null);
        setSelectedSquare(null);
        setPendingPromotion(null);
        setPremove(null);
        setViewIndex(-1);
        setGame(new Chess());
        setHistory([]);
    };

    const handleUndoSandboxMove = () => {
        if (gameId || history.length === 0 || isBotThinking || !!gameOverResult) return;
        const nextGame = cloneChessInstance(game);
        nextGame.undo();
        if (activeBot && nextGame.history().length > 0) {
            const turnAfterFirstUndo = nextGame.turn() === 'w' ? 'white' : 'black';
            if (turnAfterFirstUndo !== myColor) {
                nextGame.undo();
            }
        }
        setGame(nextGame);
        setHistory(nextGame.history({verbose: true}));
        setGameOverResult(null);
        setDrawOfferStatus(null);
        setPendingPromotion(null);
        setPremove(null);
        setViewIndex(-1);
        setSelectedSquare(null);
        playAudio('move');
    };

    const handlePromotionSelect = (pieceType: PromotionPiece) => {
        if (!pendingPromotion) return;
        const {from, to, isPremove} = pendingPromotion;
        setPendingPromotion(null);
        if (isPremove) {
            scheduleOrPromotePremove(from, to, pieceType);
        } else {
            executeMove(from, to, pieceType, false);
        }
    };

    const handleSquareClick = (squareId: string) => {
        if (viewIndex !== -1 || gameOverResult || spectatingGameId) return;

        if (pendingPromotion) {
            setPendingPromotion(null);
            return;
        }

        const turnChar = game.turn();
        const currentTurnColor = turnChar === 'w' ? 'white' : 'black';
        const myColorChar = myColor === 'white' ? 'w' : 'b';
        const isOpponentTurn = (gameId || activeBot || spectatingGameId) && currentTurnColor !== myColor;

        if (isOpponentTurn) {
            if (selectedSquare) {
                if (selectedSquare === squareId) {
                    setSelectedSquare(null);
                } else {
                    const pieceOnTarget = game.get(squareId as any);
                    if (pieceOnTarget && pieceOnTarget.color === myColorChar) {
                        setSelectedSquare(squareId);
                    } else {
                        scheduleOrPromotePremove(selectedSquare, squareId);
                    }
                }
            } else {
                const piece = game.get(squareId as any);
                if (piece && piece.color === myColorChar) {
                    setSelectedSquare(squareId);
                } else if (premove) {
                    setPremove(null);
                }
            }
            return;
        }

        if (selectedSquare) {
            if (selectedSquare === squareId) {
                setSelectedSquare(null);
            } else {
                const pieceOnTarget = game.get(squareId as any);
                if (pieceOnTarget && pieceOnTarget.color === turnChar && ((!gameId && !activeBot) || currentTurnColor === myColor)) {
                    setSelectedSquare(squareId);
                } else {
                    executeMove(selectedSquare, squareId);
                }
            }
        } else {
            const piece = game.get(squareId as any);
            if (piece && piece.color === turnChar && ((!gameId && !activeBot) || currentTurnColor === myColor)) {
                setSelectedSquare(squareId);
            }
        }
    };

    const currentGame = viewIndex === -1 ? game : (() => {
        const tg = new Chess();
        const limit = viewIndex === -2 ? -1 : viewIndex;
        for (let i = 0; i <= limit; i++) {
            if (history[i]) tg.move(history[i]);
        }
        return tg;
    })();
    const boardState = currentGame.board();
    const material = calculateMaterialBalance(boardState);

    const activeMoveIndex = viewIndex === -1 ? history.length - 1 : viewIndex;
    const lastMove = activeMoveIndex >= 0 ? history[activeMoveIndex] : null;

    const legalTargetSquares = new Set<string>();
    if (selectedSquare && viewIndex === -1 && !gameOverResult) {
        const currentTurnColor = currentGame.turn() === 'w' ? 'white' : 'black';
        const isMyTurnNow = (!gameId && !activeBot) || currentTurnColor === myColor;
        if (isMyTurnNow) {
            try {
                const movesForSquare = currentGame.moves({square: selectedSquare as any, verbose: true});
                movesForSquare.forEach((m: any) => legalTargetSquares.add(m.to));
            } catch {
                // Игнорируем некорректный квадрат
            }
        }
    }

    const displayedRanks = isBoardFlipped ? ['1', '2', '3', '4', '5', '6', '7', '8'] : ['8', '7', '6', '5', '4', '3', '2', '1'];
    const displayedFiles = isBoardFlipped ? [...FILES].reverse() : FILES;

    const topIsWhite = isBoardFlipped;
    const topPlayerInfo = topIsWhite ? whitePlayer : blackPlayer;
    const bottomPlayerInfo = topIsWhite ? blackPlayer : whitePlayer;
    const topPlayerTime = topIsWhite ? whiteTimeMs : blackTimeMs;
    const bottomPlayerTime = topIsWhite ? blackTimeMs : whiteTimeMs;
    const topIdlePreviewMs = Math.round((topIsWhite ? effectiveWhiteBaseMinutes : effectiveBlackBaseMinutes) * 60 * 1000);
    const bottomIdlePreviewMs = Math.round((!topIsWhite ? effectiveWhiteBaseMinutes : effectiveBlackBaseMinutes) * 60 * 1000);
    const topCaptured = topIsWhite ? material.whiteCapturedSymbols : material.blackCapturedSymbols;
    const bottomCaptured = topIsWhite ? material.blackCapturedSymbols : material.whiteCapturedSymbols;
    const topAdvantage = topIsWhite ? material.whiteAdvantage : material.blackAdvantage;
    const bottomAdvantage = topIsWhite ? material.blackAdvantage : material.whiteAdvantage;

    const isBotOnTop = !!activeBotProfile && ((topIsWhite && myColor === 'black') || (!topIsWhite && myColor === 'white'));
    const isBotOnBottom = !!activeBotProfile && !isBotOnTop;

    const movePairs = history.reduce((acc: Array<{
        moveNumber: number;
        whiteSan: string;
        whiteIdx: number;
        blackSan?: string;
        blackIdx?: number;
    }>, move: any, idx: number) => {
        if (idx % 2 === 0) {
            acc.push({
                moveNumber: Math.floor(idx / 2) + 1,
                whiteSan: move.san,
                whiteIdx: idx
            });
        } else {
            acc[acc.length - 1].blackSan = move.san;
            acc[acc.length - 1].blackIdx = idx;
        }
        return acc;
    }, []);

    const handleSelectMoveFromList = (targetIdx: number) => {
        setSelectedSquare(null);
        if (history[targetIdx]) {
            playAudio(resolveMoveSound(history[targetIdx].san));
        }
        if (targetIdx >= history.length - 1) {
            setViewIndex(-1);
        } else {
            setViewIndex(targetIdx);
        }
    };

    const renderPieceSvg = (piece: { type: string; color: string }) => {
        const styleProps = getHarmoniousPieceStyle(pieceSetKey, boardThemeKey, piece.color);
        return (
            <div className="relative w-full h-full pointer-events-none flex items-center justify-center">
                <img
                    src={getPieceSvgUrl(pieceSetKey, piece.color, piece.type)}
                    className="object-contain select-none transition-transform duration-75"
                    style={styleProps}
                    draggable={false}
                    alt={`${piece.color}${piece.type}`}
                />
            </div>
        );
    };

    if (!localStorage.getItem('token')) {
        return (
            <div
                className="my-auto flex flex-col items-center justify-center p-8 bg-acacia rounded-lg shadow-heavy border-4 border-acacia-dark text-boxwood-light text-center">
                <div className="text-2xl font-bold mb-2">Требуется авторизация</div>
                <p className="text-base text-boxwood/85 mb-2">
                    Пожалуйста, войдите в систему в правом верхнем углу, чтобы начать игру.
                </p>
            </div>
        );
    }

    const filteredQueue = queuePlayers.filter(p => p.user_id !== currentUserId);
    const responsiveBoardPx = typeof window !== 'undefined' ? Math.min(boardSize, window.innerWidth - 24) : boardSize;

    return (
        <div
            className="w-full max-w-[1920px] h-full flex flex-col xl:flex-row items-center xl:items-stretch justify-between gap-3 px-1 xl:overflow-hidden relative">

            {dragState && (
                <div
                    className="fixed pointer-events-none z-50 scale-110"
                    style={{
                        left: `${dragState.x}px`,
                        top: `${dragState.y}px`,
                        width: `${responsiveBoardPx / 8}px`,
                        height: `${responsiveBoardPx / 8}px`,
                        transform: 'translate(-50%, -50%)'
                    }}
                >
                    {renderPieceSvg(dragState.piece)}
                </div>
            )}

            {/* ЛЕВАЯ КОЛОНКА: ИГРОВОЙ ЦЕНТР (ЧАСЫ DGT2500, ИСТОРИЧЕСКИЕ БОТЫ, ЛОББИ И LIVE) */}
            <div
                className="w-full xl:w-[400px] 2xl:w-[440px] xl:h-full bg-acacia p-3 rounded-lg shadow-heavy border-2 border-acacia-dark flex flex-col gap-2 text-boxwood-light order-2 xl:order-1 shrink-0 xl:overflow-hidden">

                <div className="border-b border-acacia-light pb-2 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-acacia-dark rounded-md border border-amber-600/30 text-amber-400">
                            <Sword size={16}/>
                        </div>
                        <div>
                            <div className="text-[11px] tracking-wider uppercase text-boxwood/75 font-bold">
                                Игровой зал
                            </div>
                            <div className="text-xs font-bold flex items-center gap-1.5 font-mono">
                                <span className="text-boxwood/80 font-sans">Счёт сессии:</span>
                                <span className="text-emerald-400">+{sessionStats.wins}</span>
                                <span className="text-red-400">-{sessionStats.losses}</span>
                                <span className="text-gray-300">={sessionStats.draws}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={handleToggleSound}
                            className={`p-1.5 rounded-md border transition cursor-pointer shadow-sm ${
                                isSoundMuted
                                    ? 'bg-red-950/60 border-red-800/60 text-red-300 hover:bg-red-900/60'
                                    : 'bg-acacia-dark hover:bg-black/50 border-amber-800/50 text-amber-300'
                            }`}
                            title={isSoundMuted ? 'Включить звук' : 'Выключить звук'}
                        >
                            {isSoundMuted ? <VolumeX size={15}/> : <Volume2 size={15}/>}
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsManualFlip(prev => !prev)}
                            className="px-2.5 py-1 rounded-md bg-acacia-dark hover:bg-black/50 border border-amber-800/50 text-xs font-bold text-amber-200 flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                            title="Перевернуть доску"
                        >
                            <RefreshCw size={13} className="text-amber-400"/> Перевернуть
                        </button>
                    </div>
                </div>

                <div
                    className="bg-acacia-dark p-2.5 rounded-md border border-amber-900/50 flex flex-col gap-2 shadow-inner shrink-0">
                    <div className="flex items-center justify-between">
                        <label
                            className="text-xs uppercase tracking-wider text-boxwood/85 flex items-center gap-1.5 font-bold">
                            <Clock className="text-amber-500" size={13}/> Часы FIDE DGT2500 (36 прогр.)
                        </label>
                        <span
                            className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-900/45 text-amber-300 border border-amber-600/30">
                            OPT #{selectedTimeControl.optionNumber}
                        </span>
                    </div>

                    <div className="relative w-full" ref={timeDropdownRef}>
                        <button
                            type="button"
                            disabled={isSearching || !!gameId}
                            onClick={() => setIsTimeDropdownOpen(!isTimeDropdownOpen)}
                            className="w-full bg-black/45 border border-amber-700/50 hover:bg-black/65 disabled:opacity-50 transition text-amber-200 rounded-md px-2.5 py-1.5 text-xs sm:text-sm font-bold outline-none cursor-pointer flex justify-between items-center shadow-inner gap-2"
                        >
                            <span className="truncate">
                                [{selectedTimeControl.optionNumber}] {selectedTimeControl.label}
                                {selectedTimeControl.isManual ? ` (${manualBaseMinutes}м + ${manualIncSeconds}с)` : ''}
                            </span>
                            {isTimeDropdownOpen ? <ChevronUp className="text-amber-400 shrink-0" size={15}/> :
                                <ChevronDown className="text-amber-400 shrink-0" size={15}/>}
                        </button>

                        {isTimeDropdownOpen && (
                            <div
                                className="absolute z-50 w-full top-full mt-1 bg-[#1A120B] border-2 border-amber-700/60 rounded-md shadow-2xl max-h-72 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-black/20 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                                {TIME_CONTROLS.map((group, gIdx) => (
                                    <div key={gIdx}>
                                        <div
                                            className="px-3 py-1.5 text-xs uppercase tracking-wider text-amber-400 bg-black/90 font-bold sticky top-0 z-10 border-b border-t border-amber-900/40 first:border-t-0">
                                            {group.group}
                                        </div>
                                        {group.options.map((opt) => {
                                            const isSelected = selectedTimeControl.optionNumber === opt.optionNumber;
                                            return (
                                                <button
                                                    key={opt.optionNumber}
                                                    type="button"
                                                    className={`w-full text-left px-3 py-2 text-xs sm:text-sm transition flex justify-between items-start gap-2 border-b border-amber-950/30 cursor-pointer ${
                                                        isSelected
                                                            ? 'bg-amber-900/45 text-amber-300 font-bold'
                                                            : 'text-amber-100/90 hover:bg-amber-900/25 hover:text-amber-200'
                                                    }`}
                                                    onClick={() => {
                                                        setSelectedTimeControl(opt);
                                                        if (opt.isManual) {
                                                            setManualBaseMinutes(Math.max(1, Math.round(opt.base)));
                                                            setManualIncSeconds(opt.inc);
                                                        }
                                                        setIsTimeDropdownOpen(false);
                                                    }}
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span
                                                                className="font-mono text-xs px-1.5 py-0.5 rounded bg-black/50 text-amber-400 border border-amber-700/40 shrink-0">
                                                                {opt.optionNumber}
                                                            </span>
                                                            <span className="truncate font-bold">{opt.label}</span>
                                                        </div>
                                                        <div className="text-xs text-boxwood/70 mt-0.5 leading-snug">
                                                            {opt.details}
                                                        </div>
                                                    </div>
                                                    {isSelected && <div
                                                        className="w-2 h-2 rounded-full bg-amber-500 shrink-0 mt-1.5"/>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {selectedTimeControl.isManual && (
                        <div
                            className="p-2 rounded bg-black/40 border border-amber-700/40 flex flex-col gap-1.5 text-xs">
                            <div
                                className="text-[11px] uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
                                <Sliders size={12}/> Ручная настройка DGT2500
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="flex flex-col gap-0.5 text-xs text-boxwood/85">
                                    <span>Время (мин):</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={240}
                                        value={manualBaseMinutes}
                                        onChange={(e) => setManualBaseMinutes(Math.max(1, Math.min(240, Number(e.target.value) || 1)))}
                                        className="bg-black/60 border border-amber-700/50 rounded px-2 py-1 text-amber-200 font-mono text-xs outline-none"
                                    />
                                </label>
                                <label className="flex flex-col gap-0.5 text-xs text-boxwood/85">
                                    <span>Бонус / Delay (сек):</span>
                                    <input
                                        type="number"
                                        min={0}
                                        max={180}
                                        value={manualIncSeconds}
                                        onChange={(e) => setManualIncSeconds(Math.max(0, Math.min(180, Number(e.target.value) || 0)))}
                                        className="bg-black/60 border border-amber-700/50 rounded px-2 py-1 text-amber-200 font-mono text-xs outline-none"
                                    />
                                </label>
                            </div>
                        </div>
                    )}

                    {!gameId ? (
                        <div className="grid grid-cols-[1fr_auto] gap-2">
                            <button
                                onClick={isSearching ? cancelMatchmaking : startMatchmaking}
                                className={`flex items-center justify-center gap-2 px-3 py-1.5 font-bold text-xs sm:text-sm rounded-md transition shadow border cursor-pointer ${
                                    isSearching
                                        ? 'bg-red-900/85 text-red-100 border-red-700 hover:bg-red-900'
                                        : 'bg-boxwood text-acacia-dark border-amber-700/50 hover:bg-boxwood-light'
                                }`}
                            >
                                {isSearching ? <Loader2 className="animate-spin" size={15}/> : <Users size={15}/>}
                                {isSearching ? 'Отменить поиск' : 'Найти соперника'}
                            </button>

                            <button
                                type="button"
                                onClick={() => setShowInvitePanel(prev => !prev)}
                                className={`px-2.5 py-1.5 rounded-md border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow ${
                                    showInvitePanel
                                        ? 'bg-amber-700 text-white border-amber-400'
                                        : 'bg-black/45 hover:bg-black/65 text-amber-200 border-amber-700/50'
                                }`}
                                title="Создать ссылку для игры с другом"
                            >
                                <Link2 size={14}/> С другом
                            </button>
                        </div>
                    ) : (
                        <div
                            className="text-center py-1.5 px-3 rounded bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 text-xs sm:text-sm font-bold">
                            {gameOverResult ? `Партия завершена (${gameOverResult})` : 'Идет рейтинговая партия'}
                        </div>
                    )}

                    {showInvitePanel && !gameId && (
                        <div className="p-2 rounded bg-black/45 border border-amber-700/40 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between text-xs font-bold text-amber-200">
                                <span>Цвет в партии с другом:</span>
                                <div
                                    className="flex items-center gap-1 bg-black/50 p-0.5 rounded border border-amber-900/50">
                                    {(['white', 'random', 'black'] as const).map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setInviteColorPref(c)}
                                            className={`px-2 py-0.5 rounded text-xs font-bold transition cursor-pointer ${
                                                inviteColorPref === c ? 'bg-amber-700 text-white' : 'text-boxwood/70 hover:text-amber-200'
                                            }`}
                                        >
                                            {c === 'white' ? '♔ Белые' : c === 'black' ? '♚ Чёрные' : '🎲 Случайно'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {!createdInviteCode ? (
                                <button
                                    type="button"
                                    onClick={handleCreatePrivateInvite}
                                    className="w-full py-1.5 px-3 rounded bg-amber-800/70 hover:bg-amber-700 text-amber-100 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow"
                                >
                                    <Link2 size={13}/> Сгенерировать и скопировать ссылку
                                </button>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    <input
                                        type="text"
                                        readOnly
                                        value={`${window.location.origin}/challenge/${createdInviteCode}`}
                                        className="flex-1 bg-black/60 border border-amber-700/50 rounded px-2 py-1 text-xs font-mono text-amber-200 outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleCopyInviteLink}
                                        className="px-2.5 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                                    >
                                        {inviteCopied ? <Check size={13}/> : <Copy size={13}/>}
                                        {inviteCopied ? 'Скопировано' : 'Копия'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div
                    className="grid grid-cols-2 gap-1.5 p-1 bg-acacia-dark rounded-md border border-amber-900/50 shrink-0">
                    <button
                        type="button"
                        onClick={() => setLeftSectionTab('bots')}
                        className={`py-1.5 px-2.5 rounded text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            leftSectionTab === 'bots'
                                ? 'bg-amber-700 text-white shadow border border-amber-500/50'
                                : 'text-boxwood/75 hover:text-amber-200 hover:bg-white/5'
                        }`}
                    >
                        <Bot size={15}/> Исторические боты
                    </button>
                    <button
                        type="button"
                        onClick={() => setLeftSectionTab('lobby')}
                        className={`py-1.5 px-2.5 rounded text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            leftSectionTab === 'lobby'
                                ? 'bg-amber-700 text-white shadow border border-amber-500/50'
                                : 'text-boxwood/75 hover:text-amber-200 hover:bg-white/5'
                        }`}
                    >
                        <Radio size={14}
                               className={filteredQueue.length + liveGames.length > 0 ? 'text-emerald-400 animate-pulse' : ''}/>
                        <span>Лобби / Live</span>
                        <span className="text-xs font-mono px-1.5 py-0.2 rounded bg-black/40 text-amber-300">
                            {filteredQueue.length + liveGames.length}
                        </span>
                    </button>
                </div>

                {leftSectionTab === 'bots' ? (
                    <div
                        className="flex-1 min-h-0 bg-acacia-dark p-2.5 rounded-md border border-amber-700/40 flex flex-col justify-between gap-2 shadow-inner overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                        <div className="grid grid-cols-2 gap-1.5">
                            {HISTORICAL_BOTS_LIST.map((botItem) => {
                                const isSelected = selectedBotId === botItem.id;
                                return (
                                    <button
                                        key={botItem.id}
                                        type="button"
                                        onClick={() => setSelectedBotId(botItem.id)}
                                        className={`p-1.5 rounded-md text-left transition cursor-pointer flex items-center gap-2 border ${
                                            isSelected
                                                ? 'bg-amber-800/80 text-white border-amber-400 shadow'
                                                : 'bg-black/35 text-boxwood/85 border-amber-900/40 hover:border-amber-600/50 hover:bg-black/55'
                                        }`}
                                    >
                                        <img
                                            src={botItem.avatar}
                                            alt={botItem.shortName}
                                            onError={(e) => {
                                                const img = e.target as HTMLImageElement;
                                                if (!img.src.endsWith(botItem.fallbackAvatar)) {
                                                    img.src = botItem.fallbackAvatar;
                                                }
                                            }}
                                            className={`w-8 h-8 rounded-full object-cover shrink-0 border ${
                                                isSelected ? 'border-amber-300' : 'border-amber-700/60'
                                            }`}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-bold truncate leading-tight">
                                                {botItem.shortName}
                                            </div>
                                            <div className="text-[11px] font-mono text-amber-300/90">
                                                Эло {botItem.rating}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="p-2.5 rounded-md bg-black/40 border border-amber-800/50 flex flex-col gap-2">
                            <div className="flex items-center gap-2.5">
                                <img
                                    src={selectedBotProfile.avatar}
                                    alt={selectedBotProfile.name}
                                    onError={(e) => {
                                        const img = e.target as HTMLImageElement;
                                        if (!img.src.endsWith(selectedBotProfile.fallbackAvatar)) {
                                            img.src = selectedBotProfile.fallbackAvatar;
                                        }
                                    }}
                                    className="w-12 h-12 rounded-lg object-cover border-2 border-amber-500/80 shadow-md shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1">
                                        <span className="text-sm font-bold text-amber-200 truncate">
                                            {selectedBotProfile.name}
                                        </span>
                                        {activeBot === selectedBotProfile.id && !gameOverResult && (
                                            <span
                                                className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-600/50 shrink-0">
                                                В игре
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-amber-400 font-semibold">
                                        {selectedBotProfile.title}
                                    </div>
                                    <div className="text-[11px] text-boxwood/75 font-mono">
                                        Годы: {selectedBotProfile.era} • Рейтинг ~{selectedBotProfile.rating}
                                    </div>
                                </div>
                            </div>

                            <p className="text-xs italic text-boxwood/90 leading-snug bg-black/30 p-2 rounded border border-amber-900/30">
                                «{selectedBotProfile.motto}»
                            </p>

                            <div className="grid grid-cols-3 gap-1.5">
                                <button
                                    type="button"
                                    disabled={!!gameId && !gameOverResult}
                                    onClick={() => startHistoricalBotGame(selectedBotId, 'white')}
                                    className="py-1.5 px-2 text-xs font-bold rounded-md bg-boxwood text-acacia-dark hover:bg-boxwood-light disabled:opacity-40 transition cursor-pointer shadow"
                                >
                                    ♔ Белыми
                                </button>
                                <button
                                    type="button"
                                    disabled={!!gameId && !gameOverResult}
                                    onClick={() => startHistoricalBotGame(selectedBotId, 'random')}
                                    className="py-1.5 px-2 text-xs font-bold rounded-md bg-amber-700 text-white border border-amber-500/50 hover:bg-amber-600 disabled:opacity-40 transition cursor-pointer shadow"
                                >
                                    🎲 Случайно
                                </button>
                                <button
                                    type="button"
                                    disabled={!!gameId && !gameOverResult}
                                    onClick={() => startHistoricalBotGame(selectedBotId, 'black')}
                                    className="py-1.5 px-2 text-xs font-bold rounded-md bg-black/70 text-amber-200 border border-amber-700/60 hover:bg-black disabled:opacity-40 transition cursor-pointer shadow"
                                >
                                    ♚ Чёрными
                                </button>
                            </div>
                        </div>

                        {activeBotProfile && (
                            <div
                                className="p-2 rounded-md bg-black/55 border border-amber-600/40 text-xs text-amber-100">
                                <div
                                    className="font-bold text-amber-400 mb-0.5 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                        <MessageSquareQuote size={13}/> Мысль ({activeBotProfile.shortName}):
                                    </span>
                                    {isBotThinking && (
                                        <span className="animate-pulse text-amber-300 font-mono text-[11px]">
                                            обдумывает ход...
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-boxwood-light leading-snug">
                                    {botComment || 'Посмотрим, как развернётся борьба за центр.'}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div
                        className="flex-1 min-h-0 bg-acacia-dark rounded-md border border-amber-900/50 p-2.5 flex flex-col shadow-inner">
                        <div
                            className="grid grid-cols-2 gap-1.5 p-1 bg-black/40 rounded border border-amber-900/40 mb-2 shrink-0">
                            <button
                                type="button"
                                onClick={() => setLobbyTab('lobby')}
                                className={`py-1.5 px-2 rounded text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                                    lobbyTab === 'lobby'
                                        ? 'bg-amber-700 text-amber-100 shadow'
                                        : 'text-boxwood/70 hover:text-amber-200'
                                }`}
                            >
                                <span>Вызовы в лобби</span>
                                <span
                                    className="text-xs font-mono px-1.5 rounded bg-black/40">{filteredQueue.length}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setLobbyTab('live')}
                                className={`py-1.5 px-2 rounded text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                                    lobbyTab === 'live'
                                        ? 'bg-amber-700 text-amber-100 shadow'
                                        : 'text-boxwood/70 hover:text-amber-200'
                                }`}
                            >
                                <Radio size={13}
                                       className={liveGames.length > 0 ? 'text-emerald-400 animate-pulse' : ''}/>
                                <span>Идут сейчас (Live)</span>
                                <span className="text-xs font-mono px-1.5 rounded bg-black/40">{liveGames.length}</span>
                            </button>
                        </div>

                        <div
                            className="flex-1 min-h-0 overflow-y-auto space-y-2 text-sm [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                            {lobbyTab === 'lobby' ? (
                                filteredQueue.length === 0 ? (
                                    <div
                                        className="h-full flex flex-col items-center justify-center p-4 text-boxwood/60 text-center text-xs sm:text-sm">
                                        <span>
                                            {isSearching
                                                ? 'Вы в очереди. Ожидание соперников...'
                                                : 'В лобби пока нет открытых вызовов. Нажмите «Найти соперника» выше.'}
                                        </span>
                                    </div>
                                ) : (
                                    filteredQueue.map((p) => (
                                        <div
                                            key={p.user_id}
                                            className="p-2.5 bg-black/45 rounded-md border border-amber-600/30 flex justify-between items-center hover:border-amber-500/60 transition"
                                        >
                                            <div>
                                                <span className="text-amber-300 font-bold text-sm">{p.username}</span>
                                                <div className="text-xs text-boxwood/75 font-mono">
                                                    Рейтинг: {p.rating} • {Math.round(p.base_time_ms / 60000)}+{(p.increment_ms || 0) / 1000}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={!!gameId && !gameOverResult}
                                                onClick={() => acceptChallenge(p.user_id)}
                                                className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-emerald-100 rounded text-xs font-bold transition flex items-center gap-1.5 shadow cursor-pointer"
                                            >
                                                <Play size={13}/> Принять
                                            </button>
                                        </div>
                                    ))
                                )
                            ) : (
                                liveGames.length === 0 ? (
                                    <div
                                        className="h-full flex flex-col items-center justify-center p-4 text-boxwood/60 text-center text-xs sm:text-sm">
                                        <span>Сейчас нет активных PvP-партий.</span>
                                    </div>
                                ) : (
                                    liveGames.map((lg) => (
                                        <div
                                            key={lg.game_id}
                                            className="p-2.5 bg-black/45 rounded-md border border-amber-600/30 flex justify-between items-center hover:border-amber-500/60 transition gap-2"
                                        >
                                            <div className="min-w-0">
                                                <div className="text-amber-200 font-bold truncate text-sm">
                                                    {lg.white_username} <span
                                                    className="text-boxwood/50">vs</span> {lg.black_username}
                                                </div>
                                                <div className="text-xs text-boxwood/75 font-mono">
                                                    {Math.round(lg.base_time_ms / 60000)}+{(lg.increment_ms || 0) / 1000} •
                                                    👁 {lg.spectators_count}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={!!gameId && !gameOverResult}
                                                onClick={() => handleSpectateGame(lg.game_id)}
                                                className="px-3 py-1.5 bg-amber-800 hover:bg-amber-700 disabled:opacity-40 text-amber-100 rounded text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow cursor-pointer"
                                            >
                                                <Eye size={13}/> Смотреть
                                            </button>
                                        </div>
                                    ))
                                )
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ЦЕНТРАЛЬНАЯ КОЛОНКА: ИГРОКИ И ШАХМАТНАЯ ДОСКА */}
            <div className="xl:h-full flex flex-col items-center justify-center gap-2 order-1 xl:order-2 shrink-0">

                <div
                    style={{width: `${responsiveBoardPx}px`}}
                    className={`bg-acacia-dark px-3 py-1.5 rounded-lg shadow-heavy border-2 border-amber-900/50 flex justify-between items-center text-boxwood-light shrink-0 ${isResizing ? 'transition-none' : 'transition-colors'}`}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        {isBotOnTop && activeBotProfile ? (
                            <img
                                src={activeBotProfile.avatar}
                                alt={activeBotProfile.name}
                                onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    if (!img.src.endsWith(activeBotProfile.fallbackAvatar)) {
                                        img.src = activeBotProfile.fallbackAvatar;
                                    }
                                }}
                                className="w-9 h-9 rounded-md object-cover border-2 border-amber-500/70 shrink-0 shadow"
                            />
                        ) : (
                            <div
                                className={`w-9 h-9 rounded-md flex items-center justify-center border border-amber-600/30 font-bold text-lg shrink-0 ${
                                    topIsWhite ? 'bg-boxwood text-acacia-dark' : 'bg-acacia text-amber-200'
                                }`}
                            >
                                {topIsWhite ? '♙' : '♟'}
                            </div>
                        )}
                        <div className="min-w-0">
                            <div className="font-bold text-sm sm:text-base flex items-center gap-2 leading-tight">
                                <span className="truncate">
                                    {(gameId || activeBot || spectatingGameId) ? topPlayerInfo.username : (topIsWhite ? 'Белые (Разбор)' : 'Чёрные (Разбор)')}
                                </span>
                                {(gameId || activeBot || spectatingGameId) && (
                                    <span
                                        className="text-xs px-1.5 py-0.5 rounded bg-black/45 text-amber-400 border border-amber-600/25 flex items-center gap-1 font-mono">
                                        {topPlayerInfo.rating}
                                        {ratingInfo && (
                                            <span
                                                className={topIsWhite ? (Number(ratingInfo.white_delta) >= 0 ? 'text-emerald-400' : 'text-red-400') : (Number(ratingInfo.black_delta) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                                ({topIsWhite ? (Number(ratingInfo.white_delta) >= 0 ? `+${ratingInfo.white_delta}` : ratingInfo.white_delta) : (Number(ratingInfo.black_delta) >= 0 ? `+${ratingInfo.black_delta}` : ratingInfo.black_delta)})
                                            </span>
                                        )}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-amber-200/90 min-h-[16px]">
                                <span className="tracking-tight truncate">{topCaptured.join('')}</span>
                                {topAdvantage > 0 && (
                                    <span
                                        className="text-[11px] font-mono font-bold px-1.5 rounded bg-amber-900/60 text-amber-300">
                                        +{topAdvantage}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div
                        className="bg-[#1A120B] px-3.5 py-1 rounded-md border-2 border-amber-700/50 shadow-inner font-mono text-xl sm:text-2xl font-bold tracking-wider text-amber-400 min-w-[116px] sm:min-w-[124px] text-center">
                        {(gameId || activeBot || spectatingGameId) ? formatTime(topPlayerTime) : formatTime(topIdlePreviewMs)}
                    </div>
                </div>

                {/* ШАХМАТНАЯ ДОСКА С ПОДДЕРЖКОЙ TOUCH / POINTER EVENTS */}
                <div
                    ref={boardContainerRef}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        if (premove || pendingPromotion || selectedSquare) {
                            setPremove(null);
                            setPendingPromotion(null);
                            setSelectedSquare(null);
                        }
                    }}
                    style={{
                        width: `${responsiveBoardPx}px`,
                        height: `${responsiveBoardPx}px`,
                        backgroundColor: activeTheme.border
                    }}
                    className={`p-2.5 rounded-lg shadow-heavy border-2 border-amber-950/80 relative select-none touch-none group/board shrink-0 ${isResizing ? 'transition-none ring-2 ring-amber-500/60' : 'transition-colors'}`}
                >
                    {activeTheme.useWoodGrain && (
                        <div
                            className="absolute inset-0 opacity-25 mix-blend-multiply pointer-events-none"
                            style={{backgroundImage: "url('/assets/textures/wood-grain.png')"}}
                        />
                    )}

                    {pendingPromotion && (() => {
                        const fileIdx = displayedFiles.indexOf(pendingPromotion.to[0]);
                        const rankIdx = displayedRanks.indexOf(pendingPromotion.to[1]);
                        const openDownwards = rankIdx <= 3;
                        const clampedLeftPercent = Math.min(Math.max((fileIdx + 0.5) * 12.5, 22), 78);

                        return (
                            <div
                                className="absolute inset-0 z-50 bg-black/55 backdrop-blur-[1px] flex items-center justify-center rounded-[2px]"
                                onClick={() => setPendingPromotion(null)}
                            >
                                <div
                                    style={{
                                        left: `${clampedLeftPercent}%`,
                                        top: openDownwards ? '6%' : 'auto',
                                        bottom: openDownwards ? 'auto' : '6%',
                                        transform: 'translateX(-50%)'
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute bg-[#1A120B] border-2 border-amber-500 rounded-lg p-3 shadow-2xl flex flex-col items-center gap-2.5"
                                >
                                    <div className="flex items-center justify-between w-full gap-3 px-1">
                                        <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                                            Превращение пешки ({pendingPromotion.to})
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setPendingPromotion(null)}
                                            className="text-boxwood/60 hover:text-amber-300 transition cursor-pointer"
                                            title="Отмена (Esc)"
                                        >
                                            <X size={15}/>
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2">
                                        {PROMOTION_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.type}
                                                type="button"
                                                onClick={() => handlePromotionSelect(opt.type)}
                                                className="w-16 h-18 rounded-md bg-acacia-dark hover:bg-amber-800/70 border border-amber-600/50 hover:border-amber-300 transition flex flex-col items-center justify-between py-2 px-1 shadow cursor-pointer group"
                                                title={opt.label}
                                            >
                                                <div
                                                    className="w-10 h-10 flex items-center justify-center overflow-hidden shrink-0">
                                                    {renderPieceSvg({type: opt.type, color: pendingPromotion.color})}
                                                </div>
                                                <span
                                                    className="text-xs font-bold text-amber-200 group-hover:text-white leading-none">
                                                    {opt.label}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    <div
                        className="grid grid-cols-8 grid-rows-8 w-full h-full border border-black/60 relative z-10 shadow-inner-board rounded-[2px] overflow-hidden">
                        {displayedRanks.map((rank) =>
                            displayedFiles.map((file) => {
                                const rIdx = RANKS.indexOf(rank);
                                const fIdx = FILES.indexOf(file);
                                const isDark = (rIdx + fIdx) % 2 !== 0;
                                const squareId = `${file}${rank}`;

                                const piece = boardState[rIdx][fIdx];

                                const isSelected = selectedSquare === squareId;
                                const isLastMove = lastMove && (lastMove.from === squareId || lastMove.to === squareId);
                                const isPremoveSquare = premove && (premove.from === squareId || premove.to === squareId);
                                const isLegalTarget = legalTargetSquares.has(squareId);
                                const isBeingDragged = dragState?.from === squareId;

                                return (
                                    <div
                                        key={squareId}
                                        data-square={squareId}
                                        onClick={() => handleSquareClick(squareId)}
                                        style={{
                                            backgroundColor: isDark ? activeTheme.dark : activeTheme.light
                                        }}
                                        className="w-full h-full flex items-center justify-center relative cursor-pointer transition-colors duration-75"
                                    >
                                        {activeTheme.useWoodGrain && (
                                            <div
                                                className="absolute inset-0 opacity-15 mix-blend-multiply pointer-events-none"
                                                style={{backgroundImage: "url('/assets/textures/wood-grain.png')"}}
                                            />
                                        )}

                                        {isLastMove && !isSelected && !isPremoveSquare && (
                                            <div className="absolute inset-0 bg-amber-300/35 z-10 pointer-events-none"/>
                                        )}

                                        {isPremoveSquare && (
                                            <div
                                                className="absolute inset-0 bg-rose-500/45 ring-2 ring-inset ring-rose-300/80 z-10 pointer-events-none"/>
                                        )}

                                        {isSelected && (
                                            <div
                                                className="absolute inset-0 bg-amber-400/50 ring-2 ring-inset ring-amber-300/80 z-10 pointer-events-none"/>
                                        )}

                                        {isLegalTarget && (
                                            piece ? (
                                                <div
                                                    className="absolute inset-0 rounded-full border-[5px] border-black/25 z-30 pointer-events-none m-1"/>
                                            ) : (
                                                <div
                                                    className="w-3.5 h-3.5 rounded-full bg-black/25 z-30 pointer-events-none"/>
                                            )
                                        )}

                                        {piece && !isBeingDragged && (
                                            <div
                                                onPointerDown={(e) => {
                                                    if ((e.pointerType === 'mouse' && e.button !== 0) || viewIndex !== -1 || gameOverResult) return;
                                                    const turnChar = currentGame.turn();
                                                    const myColorChar = myColor === 'white' ? 'w' : 'b';

                                                    if (gameId || activeBot || spectatingGameId) {
                                                        if (piece.color !== myColorChar) return;
                                                    } else {
                                                        if (piece.color !== turnChar) return;
                                                    }

                                                    e.stopPropagation();
                                                    if ((currentGame.turn() === 'w' ? 'white' : 'black') === myColor) {
                                                        moveStartTime.current = Date.now();
                                                    }
                                                    setSelectedSquare(squareId);
                                                    setDragState({
                                                        from: squareId,
                                                        piece,
                                                        x: e.clientX,
                                                        y: e.clientY
                                                    });
                                                }}
                                                className={`relative w-full h-full p-[1.5%] z-20 transition-transform duration-75 ${
                                                    viewIndex === -1 && !gameOverResult && (
                                                        (gameId || activeBot || spectatingGameId)
                                                            ? piece.color === (myColor === 'white' ? 'w' : 'b')
                                                            : piece.color === currentGame.turn()
                                                    )
                                                        ? 'cursor-grab active:cursor-grabbing hover:scale-[1.03]'
                                                        : ''
                                                }`}
                                            >
                                                {renderPieceSvg(piece)}
                                            </div>
                                        )}

                                        {file === displayedFiles[0] && (
                                            <span
                                                style={{color: isDark ? activeTheme.coordDark : activeTheme.coordLight}}
                                                className="absolute top-0.5 left-1 text-xs font-sans font-bold opacity-90 z-20 pointer-events-none leading-none"
                                            >
                                                {rank}
                                            </span>
                                        )}
                                        {rank === displayedRanks[7] && (
                                            <span
                                                style={{color: isDark ? activeTheme.coordDark : activeTheme.coordLight}}
                                                className="absolute bottom-0.5 right-1 text-xs font-sans font-bold opacity-90 z-20 pointer-events-none leading-none"
                                            >
                                                {file}
                                            </span>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {isResizing && (
                        <div
                            className="absolute bottom-5 right-5 z-40 px-2.5 py-1 rounded bg-black/85 border border-amber-500/60 text-amber-300 font-mono text-xs font-bold shadow-lg pointer-events-none">
                            {responsiveBoardPx} × {responsiveBoardPx} px
                        </div>
                    )}

                    <div
                        onPointerDown={handleResizePointerDown}
                        onDoubleClick={handleResizeDoubleClick}
                        title="Потяните, чтобы изменить размер доски (двойной клик — авторазмер под экран)"
                        className={`absolute bottom-0 right-0 w-6 h-6 z-40 cursor-nwse-resize flex items-end justify-end p-0.5 rounded-tl transition-opacity ${
                            isResizing
                                ? 'opacity-100 text-amber-400'
                                : 'opacity-50 group-hover/board:opacity-90 hover:opacity-100! text-amber-200/80 hover:text-amber-300'
                        }`}
                    >
                        <svg
                            viewBox="0 0 16 16"
                            className="w-3.5 h-3.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        >
                            <line x1="14" y1="4" x2="4" y2="14"/>
                            <line x1="14" y1="9" x2="9" y2="14"/>
                            <line x1="14" y1="14" x2="14" y2="14"/>
                        </svg>
                    </div>
                </div>

                <div
                    style={{width: `${responsiveBoardPx}px`}}
                    className={`bg-acacia-dark px-3 py-1.5 rounded-lg shadow-heavy border-2 border-amber-900/50 flex justify-between items-center text-boxwood-light shrink-0 ${isResizing ? 'transition-none' : 'transition-colors'}`}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        {isBotOnBottom && activeBotProfile ? (
                            <img
                                src={activeBotProfile.avatar}
                                alt={activeBotProfile.name}
                                onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    if (!img.src.endsWith(activeBotProfile.fallbackAvatar)) {
                                        img.src = activeBotProfile.fallbackAvatar;
                                    }
                                }}
                                className="w-9 h-9 rounded-md object-cover border-2 border-amber-500/70 shrink-0 shadow"
                            />
                        ) : (
                            <div
                                className={`w-9 h-9 rounded-md flex items-center justify-center border border-amber-600/30 font-bold text-lg shrink-0 ${
                                    !topIsWhite ? 'bg-boxwood text-acacia-dark' : 'bg-acacia text-amber-200'
                                }`}
                            >
                                {!topIsWhite ? '♙' : '♟'}
                            </div>
                        )}
                        <div className="min-w-0">
                            <div className="font-bold text-sm sm:text-base flex items-center gap-2 leading-tight">
                                <span className="truncate">
                                    {(gameId || activeBot || spectatingGameId) ? bottomPlayerInfo.username : (!topIsWhite ? 'Вы (Белые)' : 'Вы (Чёрные)')}
                                </span>
                                {(gameId || activeBot || spectatingGameId) && (
                                    <span
                                        className="text-xs px-1.5 py-0.5 rounded bg-black/45 text-amber-400 border border-amber-600/25 flex items-center gap-1 font-mono">
                                        {bottomPlayerInfo.rating}
                                        {ratingInfo && (
                                            <span
                                                className={!topIsWhite ? (Number(ratingInfo.white_delta) >= 0 ? 'text-emerald-400' : 'text-red-400') : (Number(ratingInfo.black_delta) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                                ({!topIsWhite ? (Number(ratingInfo.white_delta) >= 0 ? `+${ratingInfo.white_delta}` : ratingInfo.white_delta) : (Number(ratingInfo.black_delta) >= 0 ? `+${ratingInfo.black_delta}` : ratingInfo.black_delta)})
                                            </span>
                                        )}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-amber-200/90 min-h-[16px]">
                                <span className="tracking-tight truncate">{bottomCaptured.join('')}</span>
                                {bottomAdvantage > 0 && (
                                    <span
                                        className="text-[11px] font-mono font-bold px-1.5 rounded bg-amber-900/60 text-amber-300">
                                        +{bottomAdvantage}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div
                        className="bg-[#1A120B] px-3.5 py-1 rounded-md border-2 border-amber-700/50 shadow-inner font-mono text-xl sm:text-2xl font-bold tracking-wider text-amber-400 min-w-[116px] sm:min-w-[124px] text-center">
                        {(gameId || activeBot || spectatingGameId) ? formatTime(bottomPlayerTime) : formatTime(bottomIdlePreviewMs)}
                    </div>
                </div>

            </div>

            {/* ПРАВАЯ КОЛОНКА: ЖУРНАЛ ХОДОВ, ОФОРМЛЕНИЕ, ЧАТ И УПРАВЛЕНИЕ ПАРТИЕЙ */}
            <div
                className="w-full xl:w-[390px] 2xl:w-[430px] xl:h-full bg-acacia p-3 rounded-lg shadow-heavy border-2 border-acacia-dark flex flex-col gap-2 text-boxwood-light order-3 shrink-0 xl:overflow-hidden relative">

                <div
                    className="border-b border-acacia-light pb-2 flex justify-between items-center gap-2 shrink-0 relative"
                    ref={appearanceDropdownRef}
                >
                    <div className="min-w-0">
                        <div
                            className="text-xs tracking-wider uppercase text-boxwood/75 font-bold flex items-center gap-1.5">
                            <ListOrdered className="text-amber-400" size={15}/> Журнал ходов
                        </div>
                        <div className="text-xs sm:text-sm font-bold text-amber-200 mt-0.5 truncate">
                            {(gameId || activeBot || spectatingGameId)
                                ? `${whitePlayer.username} vs ${blackPlayer.username}`
                                : 'Свободная доска / Анализ'}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setShowAppearanceDropdown(prev => !prev)}
                                className={`px-2.5 py-1 rounded-md border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm ${
                                    showAppearanceDropdown
                                        ? 'bg-amber-700 text-white border-amber-400'
                                        : 'bg-acacia-dark hover:bg-black/45 text-amber-200 border-amber-800/50'
                                }`}
                                title="Выбрать комплект фигур, тему и размер доски"
                            >
                                <span
                                    className="w-5 h-5 rounded-xs flex items-center justify-center border border-black/50 shrink-0"
                                    style={{backgroundColor: activeTheme.dark}}
                                >
                                    <img
                                        src={getPieceSvgUrl(pieceSetKey, 'w', 'N')}
                                        alt=""
                                        className="w-4 h-4 object-contain"
                                    />
                                </span>
                                <span
                                    className="hidden sm:inline">{activePieceSet.shortName} • {activeTheme.name}</span>
                                <span className="sm:hidden">Вид</span>
                                {showAppearanceDropdown ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                            </button>

                            {showAppearanceDropdown && (
                                <div
                                    className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-[#261C14] border-2 border-amber-600/80 rounded-lg shadow-2xl z-50 p-3.5 flex flex-col gap-3 text-boxwood-light">
                                    <div
                                        className="flex justify-between items-center border-b border-amber-900/50 pb-2">
                                        <span className="font-bold text-amber-200 text-sm flex items-center gap-1.5">
                                            <Palette size={15} className="text-amber-400"/> Оформление фигур и доски
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setShowAppearanceDropdown(false)}
                                            className="text-boxwood/60 hover:text-white cursor-pointer"
                                        >
                                            <X size={15}/>
                                        </button>
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-boxwood/90">♟ Комплект фигур:</span>
                                            <span className="text-amber-400 font-bold">{activePieceSet.name}</span>
                                        </div>
                                        <div className="grid grid-cols-5 gap-1.5">
                                            {Object.values(PIECE_SETS).map((pset) => {
                                                const isCurrent = pset.id === activePieceSet.id;
                                                return (
                                                    <button
                                                        key={pset.id}
                                                        type="button"
                                                        onClick={() => handlePieceSetChange(pset.id)}
                                                        title={pset.description}
                                                        className={`flex flex-col items-center gap-1 p-1.5 rounded-md border text-xs font-bold transition cursor-pointer ${
                                                            isCurrent
                                                                ? 'bg-amber-900/60 border-amber-400 text-amber-200 shadow'
                                                                : 'bg-black/35 border-amber-900/40 text-boxwood/75 hover:bg-black/55 hover:text-amber-200'
                                                        }`}
                                                    >
                                                        <div
                                                            className="w-10 h-9 rounded flex items-center justify-center border border-black/50 shadow-inner"
                                                            style={{
                                                                background: `linear-gradient(90deg, ${activeTheme.dark} 50%, ${activeTheme.light} 50%)`
                                                            }}
                                                        >
                                                            <img
                                                                src={getPieceSvgUrl(pset.id, 'w', 'N')}
                                                                alt={pset.shortName}
                                                                className="w-5 h-5 object-contain"
                                                            />
                                                            <img
                                                                src={getPieceSvgUrl(pset.id, 'b', 'Q')}
                                                                alt=""
                                                                className="w-5 h-5 object-contain"
                                                            />
                                                        </div>
                                                        <span className="truncate w-full text-center text-[11px]">
                                                            {pset.shortName}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-1.5 pt-2 border-t border-amber-900/40">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-boxwood/90">🎨 Поверхность доски:</span>
                                            <span className="text-amber-400 font-bold">{activeTheme.name}</span>
                                        </div>
                                        <div className="grid grid-cols-5 gap-1.5">
                                            {Object.values(BOARD_THEMES).map((theme) => {
                                                const isCurrent = theme.id === activeTheme.id;
                                                return (
                                                    <button
                                                        key={theme.id}
                                                        type="button"
                                                        onClick={() => handleThemeChange(theme.id)}
                                                        className={`flex flex-col items-center gap-1 p-1.5 rounded-md border text-xs font-bold transition cursor-pointer ${
                                                            isCurrent
                                                                ? 'bg-amber-900/60 border-amber-400 text-amber-200 shadow'
                                                                : 'bg-black/35 border-amber-900/40 text-boxwood/75 hover:bg-black/55 hover:text-amber-200'
                                                        }`}
                                                    >
                                                        <div
                                                            className="w-8 h-8 rounded-xs overflow-hidden grid grid-cols-2 grid-rows-2 border-2 shadow-sm"
                                                            style={{borderColor: theme.border}}
                                                        >
                                                            <div style={{backgroundColor: theme.light}}/>
                                                            <div style={{backgroundColor: theme.dark}}/>
                                                            <div style={{backgroundColor: theme.dark}}/>
                                                            <div style={{backgroundColor: theme.light}}/>
                                                        </div>
                                                        <span className="truncate w-full text-center text-[11px]">
                                                            {theme.name}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div
                                        className="flex items-center justify-between gap-2 pt-2 border-t border-amber-900/40 text-xs">
                                        <span className="text-boxwood/80 font-bold">Размер: {responsiveBoardPx}px</span>
                                        <input
                                            type="range"
                                            min={MIN_BOARD_SIZE}
                                            max={getMaxViewportBoardSize()}
                                            value={boardSize}
                                            onChange={(e) => {
                                                const val = Number(e.target.value);
                                                setBoardSize(val);
                                                localStorage.setItem('michess_board_size', String(val));
                                            }}
                                            className="flex-1 accent-amber-500 cursor-pointer"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const fit = getMaxViewportBoardSize();
                                                setBoardSize(fit);
                                                localStorage.setItem('michess_board_size', String(fit));
                                            }}
                                            className="px-2 py-1 rounded bg-black/45 hover:bg-amber-800/60 border border-amber-700/50 text-amber-200 font-bold cursor-pointer"
                                        >
                                            Авто
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <span
                            className="px-2 py-1 rounded-md bg-acacia-dark border border-amber-700/40 font-mono text-xs text-amber-400 font-bold">
                            {gameOverResult || (history.length > 0 ? `${Math.ceil(history.length / 2)} х.` : 'Старт')}
                        </span>
                    </div>
                </div>

                {premove && (
                    <div
                        className="bg-rose-950/90 px-3 py-1.5 rounded-md border border-rose-500/60 text-xs text-rose-100 flex items-center justify-between shadow shrink-0">
                        <span className="flex items-center gap-1.5 font-bold font-mono">
                            <Zap size={14} className="text-rose-400"/>
                            Предход: {premove.from} → {premove.to}{premove.promotion ? `=${premove.promotion.toUpperCase()}` : ''}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPremove(null)}
                            className="px-2 py-0.5 bg-black/40 hover:bg-black/70 rounded text-xs font-sans text-rose-200 transition cursor-pointer"
                        >
                            Отмена
                        </button>
                    </div>
                )}

                {drawOfferStatus && (
                    <div
                        className="bg-amber-950/90 p-2 rounded-md border border-amber-600/50 text-xs text-amber-200 text-center flex flex-col gap-1.5 shrink-0">
                        <span>{drawOfferStatus}</span>
                        {drawOfferStatus.includes('предлагает ничью') && (
                            <div className="flex justify-center gap-2">
                                <button
                                    onClick={acceptDraw}
                                    className="px-3 py-1 bg-emerald-800 hover:bg-emerald-700 text-white rounded text-xs font-bold cursor-pointer"
                                >
                                    Принять
                                </button>
                                <button
                                    onClick={declineDraw}
                                    className="px-3 py-1 bg-red-800 hover:bg-red-700 text-white rounded text-xs font-bold cursor-pointer"
                                >
                                    Отклонить
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div
                    className="flex-1 min-h-0 flex flex-col bg-[#1A120B]/90 rounded-md border border-amber-900/50 overflow-hidden shadow-inner">
                    <div
                        className="grid grid-cols-[44px_1fr_1fr] px-3 py-1.5 bg-black/55 border-b border-amber-900/40 text-xs uppercase tracking-wider text-boxwood/65 font-bold shrink-0">
                        <span>№</span>
                        <span>Белые</span>
                        <span>Чёрные</span>
                    </div>

                    <div
                        ref={notationScrollRef}
                        className="flex-1 min-h-0 overflow-y-auto divide-y divide-amber-900/15 font-mono text-sm [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-amber-900/50"
                    >
                        {movePairs.length === 0 ? (
                            <div
                                className="h-full flex flex-col items-center justify-center p-6 text-center text-boxwood/50 font-sans text-sm gap-1.5">
                                <span className="font-semibold">Ходов пока нет</span>
                                <span className="text-xs text-boxwood/40">
                                    {(gameId || activeBot || spectatingGameId)
                                        ? 'Сделайте первый ход на доске.'
                                        : 'Двигайте фигуры для анализа или выберите соперника слева.'}
                                </span>
                            </div>
                        ) : (
                            movePairs.map((pair) => {
                                const isWhiteActive = activeMoveIndex === pair.whiteIdx;
                                const isBlackActive = pair.blackIdx !== undefined && activeMoveIndex === pair.blackIdx;

                                return (
                                    <div
                                        key={pair.moveNumber}
                                        className="grid grid-cols-[44px_1fr_1fr] items-center px-2.5 py-1 hover:bg-white/5 transition-colors"
                                    >
                                        <span className="text-xs text-amber-500/70 font-bold pl-1 select-none">
                                            {pair.moveNumber}.
                                        </span>

                                        <button
                                            type="button"
                                            onClick={() => handleSelectMoveFromList(pair.whiteIdx)}
                                            className={`text-left px-2 py-0.5 rounded text-sm font-bold transition truncate cursor-pointer ${
                                                isWhiteActive
                                                    ? 'active-move-btn bg-amber-600/40 text-amber-200 border border-amber-500/50 shadow-sm'
                                                    : 'text-boxwood-light hover:bg-amber-900/30 hover:text-white'
                                            }`}
                                        >
                                            {pair.whiteSan}
                                        </button>

                                        {pair.blackSan !== undefined && pair.blackIdx !== undefined ? (
                                            <button
                                                type="button"
                                                onClick={() => handleSelectMoveFromList(pair.blackIdx!)}
                                                className={`text-left px-2 py-0.5 rounded text-sm font-bold transition truncate cursor-pointer ${
                                                    isBlackActive
                                                        ? 'active-move-btn bg-amber-600/40 text-amber-200 border border-amber-500/50 shadow-sm'
                                                        : 'text-boxwood-light hover:bg-amber-900/30 hover:text-white'
                                                }`}
                                            >
                                                {pair.blackSan}
                                            </button>
                                        ) : (
                                            <span/>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {viewIndex !== -1 && history.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setViewIndex(-1)}
                            className="w-full py-1.5 px-3 bg-amber-700/40 hover:bg-amber-700/60 border-t border-amber-500/40 text-amber-200 text-xs font-bold text-center transition shrink-0 cursor-pointer"
                        >
                            Просмотр истории
                            ({viewIndex === -2 ? 'Начало' : `полуход ${viewIndex + 1} из ${history.length}`}) —
                            Вернуться к игре
                        </button>
                    )}
                </div>

                <div
                    className="bg-acacia-dark p-2 rounded-md border border-amber-900/40 flex items-center justify-between shrink-0">
                    <span className="text-xs font-semibold text-boxwood/80 pl-1">Навигация:</span>
                    <div className="flex gap-1.5">
                        <button
                            type="button"
                            disabled={history.length === 0 || viewIndex === -2}
                            onClick={() => {
                                setViewIndex(-2);
                                playAudio('move');
                            }}
                            className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                            title="В начало партии (Стрелка вверх)"
                        >
                            <ChevronFirst size={16}/>
                        </button>
                        <button
                            type="button"
                            disabled={history.length === 0 || viewIndex === -2}
                            onClick={() => {
                                if (history.length > 0) {
                                    const current = viewIndex === -1 ? history.length - 1 : prevIndexHelper(viewIndex, history.length);
                                    const nextIdx = current <= 0 ? -2 : current - 1;
                                    setViewIndex(nextIdx);
                                    if (nextIdx >= 0 && history[nextIdx]) {
                                        playAudio(resolveMoveSound(history[nextIdx].san));
                                    } else {
                                        playAudio('move');
                                    }
                                }
                            }}
                            className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                            title="Ход назад (Стрелка влево)"
                        >
                            <ChevronLeft size={16}/>
                        </button>
                        <button
                            type="button"
                            disabled={history.length === 0 || viewIndex === -1}
                            onClick={() => {
                                let nextIdx = -1;
                                if (viewIndex === -2 && history.length > 0) {
                                    nextIdx = history.length === 1 ? -1 : 0;
                                } else if (viewIndex !== -1 && viewIndex < history.length - 2) {
                                    nextIdx = viewIndex + 1;
                                }
                                setViewIndex(nextIdx);
                                const targetMove = nextIdx === -1 ? history[history.length - 1] : history[nextIdx];
                                if (targetMove) {
                                    playAudio(resolveMoveSound(targetMove.san));
                                }
                            }}
                            className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                            title="Ход вперед (Стрелка вправо)"
                        >
                            <ChevronRight size={16}/>
                        </button>
                        <button
                            type="button"
                            disabled={history.length === 0 || viewIndex === -1}
                            onClick={() => {
                                setViewIndex(-1);
                                if (history.length > 0) {
                                    playAudio(resolveMoveSound(history[history.length - 1].san));
                                }
                            }}
                            className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition cursor-pointer"
                            title="К последнему ходу (Стрелка вниз)"
                        >
                            <ChevronLast size={16}/>
                        </button>
                    </div>
                </div>

                {(gameId || spectatingGameId) && (
                    <div
                        className="bg-acacia-dark p-2 rounded-md border border-amber-900/50 flex flex-col gap-1.5 shrink-0">
                        <div
                            className="flex items-center justify-between text-xs uppercase tracking-wider text-amber-400 font-bold">
                            <span className="flex items-center gap-1.5">
                                <MessageSquare size={13}/> Игровой чат
                            </span>
                            {spectatingGameId && (
                                <button
                                    type="button"
                                    onClick={handleLeaveSpectate}
                                    className="text-rose-300 hover:text-rose-200 underline text-xs font-sans cursor-pointer"
                                >
                                    Выйти из просмотра
                                </button>
                            )}
                        </div>

                        <div
                            className="h-16 overflow-y-auto bg-black/40 rounded p-2 text-xs space-y-1 font-sans border border-amber-950/50 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                            {chatMessages.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-xs text-boxwood/45 italic">
                                    Сообщений пока нет. Поприветствуйте соперника!
                                </div>
                            ) : (
                                chatMessages.map((msg, i) => (
                                    <div key={i} className="leading-snug wrap-break-word">
                                        <span className="font-bold text-amber-300 mr-1.5">{msg.sender}:</span>
                                        <span className="text-boxwood-light">{msg.text}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="flex flex-wrap gap-1">
                            {QUICK_CHAT_PRESETS.map((preset) => (
                                <button
                                    key={preset}
                                    type="button"
                                    onClick={() => handleSendChatMessage(preset)}
                                    className="px-2 py-0.5 rounded bg-black/40 hover:bg-amber-900/50 border border-amber-800/40 text-xs text-amber-200 transition cursor-pointer"
                                >
                                    {preset}
                                </button>
                            ))}
                        </div>

                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleSendChatMessage();
                            }}
                            className="flex gap-1.5"
                        >
                            <input
                                type="text"
                                maxLength={140}
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="Написать сообщение..."
                                className="flex-1 bg-black/50 border border-amber-800/50 rounded px-2.5 py-1 text-xs text-amber-100 outline-none focus:border-amber-500 font-sans"
                            />
                            <button
                                type="submit"
                                className="px-3 py-1 bg-amber-700 hover:bg-amber-600 text-amber-100 rounded text-xs font-bold flex items-center justify-center transition cursor-pointer"
                                title="Отправить"
                            >
                                <Send size={13}/>
                            </button>
                        </form>
                    </div>
                )}

                <div className="shrink-0 flex flex-col gap-1.5">
                    {gameId ? (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                {history.length < 2 ? (
                                    <button
                                        type="button"
                                        onClick={handleAbortGame}
                                        disabled={!!gameOverResult}
                                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-950/90 text-amber-200 text-xs sm:text-sm font-bold rounded-md hover:bg-amber-900 transition shadow border border-amber-700/60 disabled:opacity-40 cursor-pointer"
                                    >
                                        <X size={15}/> Отменить игру
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleResign}
                                        disabled={!!gameOverResult}
                                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/85 text-red-200 text-xs sm:text-sm font-bold rounded-md hover:bg-red-900 transition shadow border border-red-800/50 disabled:opacity-40 cursor-pointer"
                                    >
                                        <Flag size={15}/> Сдаться
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleOfferDraw}
                                    disabled={!!gameOverResult || history.length < 2}
                                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                                >
                                    <Handshake size={15}/> Ничья
                                </button>
                            </div>

                            {gameOverResult && (
                                <div className="flex flex-col gap-1.5">
                                    {rematchStatus === 'offered_by_opponent' ? (
                                        <div
                                            className="p-2 rounded-md bg-emerald-950/90 border border-emerald-500/60 flex flex-col gap-1.5 text-xs text-emerald-100 text-center shadow">
                                            <span
                                                className="font-bold">Соперник предлагает реванш (со сменой цвета)!</span>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={handleAcceptRematch}
                                                    className="py-1.5 px-3 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded transition shadow cursor-pointer"
                                                >
                                                    Принять реванш
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleDeclineRematch}
                                                    className="py-1.5 px-3 bg-red-900/80 hover:bg-red-800 text-red-100 font-bold rounded transition cursor-pointer"
                                                >
                                                    Отклонить
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                disabled={rematchStatus === 'offered_by_me' || rematchStatus === 'declined'}
                                                onClick={handleOfferRematch}
                                                className="flex items-center justify-center gap-1.5 px-3 py-2 font-bold text-xs sm:text-sm rounded-md transition shadow bg-emerald-800 hover:bg-emerald-700 text-emerald-100 border border-emerald-500/50 disabled:opacity-50 cursor-pointer"
                                            >
                                                <RefreshCw size={15}
                                                           className={rematchStatus === 'offered_by_me' ? 'animate-spin' : ''}/>
                                                {rematchStatus === 'offered_by_me'
                                                    ? 'Ждём ответа...'
                                                    : rematchStatus === 'declined'
                                                        ? 'Реванш отклонён'
                                                        : 'Реванш'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleResetSandbox}
                                                className="flex items-center justify-center gap-1.5 px-3 py-2 font-bold text-xs sm:text-sm rounded-md transition shadow bg-boxwood text-acacia-dark border border-amber-700/50 hover:bg-boxwood-light cursor-pointer"
                                            >
                                                <RotateCcw size={15}/> В лобби
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : activeBot ? (
                        <div className="flex flex-col gap-1.5">
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    disabled={history.length === 0 || isBotThinking || !!gameOverResult}
                                    onClick={handleUndoSandboxMove}
                                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                                >
                                    <Undo2 size={15}/> Вернуть ход
                                </button>
                                {!gameOverResult ? (
                                    <button
                                        type="button"
                                        onClick={handleResign}
                                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/85 text-red-200 text-xs sm:text-sm font-bold rounded-md hover:bg-red-900 transition shadow border border-red-800/50 cursor-pointer"
                                    >
                                        <Flag size={15}/> Сдаться
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleOfferRematch}
                                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-800 text-emerald-100 text-xs sm:text-sm font-bold rounded-md hover:bg-emerald-700 transition shadow border border-emerald-500/50 cursor-pointer"
                                    >
                                        <RefreshCw size={15}/> Реванш
                                    </button>
                                )}
                            </div>

                            {savedBotGameId && (
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => navigate(`/game/${savedBotGameId}`, {
                                            state: {
                                                game: {
                                                    game_id: savedBotGameId,
                                                    white_username: whitePlayer.username,
                                                    white_rating: Number(whitePlayer.rating) || 1200,
                                                    black_username: blackPlayer.username,
                                                    black_rating: Number(blackPlayer.rating) || 1850,
                                                    result: gameOverResult || '*',
                                                    site: 'Michess Bot Arena',
                                                    finished_at: new Date().toISOString()
                                                }
                                            }
                                        })}
                                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 text-xs font-bold rounded-md transition shadow border border-emerald-600/50 cursor-pointer"
                                    >
                                        <Eye size={14}/> Разбор партии
                                    </button>
                                    <a
                                        href={`${API_BASE_URL}/api/v1/profile/games/${savedBotGameId}/pgn`}
                                        download
                                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#1A120B] hover:bg-black text-amber-400 text-xs font-bold rounded-md transition shadow border border-amber-800/60"
                                    >
                                        <Download size={14}/> Скачать PGN
                                    </a>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                disabled={history.length === 0}
                                onClick={handleUndoSandboxMove}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                            >
                                <Undo2 size={15}/> Отменить ход
                            </button>
                            <button
                                type="button"
                                disabled={history.length === 0}
                                onClick={handleResetSandbox}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-amber-300 text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                            >
                                <RotateCcw size={15}/> Сбросить доску
                            </button>
                        </div>
                    )}
                </div>

            </div>

        </div>
    );
}

