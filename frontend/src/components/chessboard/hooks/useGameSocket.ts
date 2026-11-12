// --- FILE: frontend/src/components/chessboard/hooks/useGameSocket.ts ---
// Матчмейкинг, PvP-партия по WebSocket, лобби/зрители и чат. Основное игровое состояние
// (game/history/viewIndex/gameId/myColor/gameOverResult и т.п.) остаётся в Chessboard.tsx как
// обычный useState и передаётся сюда параметрами — оно равно нужно и этому хуку, и useBotGame
// (партия с ботом использует те же game/history/gameOverResult/... поля), и порядок вызова
// хуков не позволяет кому-то одному быть единственным владельцем без цикла зависимостей.

import {useCallback, useEffect, useRef, useState} from 'react';
import type {NavigateFunction} from 'react-router-dom';
import {Chess} from 'chess.js';
import {gameSocket} from '../../../services/gameSocket';
import {resolveMoveSound} from '../../../services/soundEngine';
import type {SoundEventType} from '../../../services/soundEngine';
import {API_BASE_URL} from '../../../config/api';
import {GAME_ACTION_ERROR_CODES} from '../types';
import type {LiveGameItem, ChatMessageItem, QueuePlayer, PendingPromotion} from '../types';
import type {BotOpponentId} from '../../../config/champions';

const DRAW_OFFER_INCOMING = 'Соперник предлагает ничью.';
const DRAW_OFFER_OUTGOING = 'Вы предложили ничью...';
const DRAW_DECLINED = 'Предложение ничьей отклонено.';

/** Сколько опросов подряд сервер должен ответить «активной партии нет», чтобы считать её завершённой. */
const MISSING_GAME_POLLS = 2;

const GAME_OVER_REASONS: Record<string, string> = {
    checkmate: 'мат',
    stalemate: 'пат',
    timeout: 'истекло время',
    resignation: 'сдача',
    agreement: 'по соглашению',
    draw_agreement: 'по соглашению',
    repetition: 'троекратное повторение',
    '50_move_rule': 'правило 50 ходов',
    insufficient_material: 'недостаточно материала',
    timeout_vs_insufficient_material: 'время истекло, но поставить мат нечем',
    abandoned: 'игрок покинул партию',
    abandoned_vs_insufficient_material: 'игрок покинул партию, поставить мат нечем',
};

/** Текст итога партии: «Партия окончена. Результат: 1-0 (мат)». */
export function describeGameOver(result: string | null | undefined, reason?: string | null): string | null {
    if (reason === 'aborted' || result === '*') return 'Партия отменена на 1-м ходу (рейтинг не изменён).';
    if (!result) return null;
    const reasonText = reason ? GAME_OVER_REASONS[reason] : undefined;
    return `Партия окончена. Результат: ${result}${reasonText ? ` (${reasonText})` : ''}`;
}

export interface UseGameSocketOptions {
    gameId: number | null;
    gameIdRef: React.MutableRefObject<number | null>;
    myColorRef: React.MutableRefObject<'white' | 'black'>;
    spectatingGameId: number | null;
    stateVersionRef: React.MutableRefObject<number>;
    gameOverResult: string | null;
    gameOverResultRef: React.MutableRefObject<string | null>;
    activeBot: BotOpponentId | null;
    currentUsernameRef: React.MutableRefObject<string>;
    inviteCode: string | undefined;
    navigate: NavigateFunction;
    effectiveWhiteBaseMinutes: number;
    effectiveIncSeconds: number;
    selectedTimeControlLabel: string;
    inviteColorPref: 'white' | 'black' | 'random';
    /** Тип новых партий, выбранный игроком: рейтинговая или товарищеская. */
    ratedChoice: boolean;
    /** Тип партии, которая сейчас на доске (приходит с сервера). */
    setIsRatedGame: (rated: boolean) => void;

    setGame: (g: Chess) => void;
    setHistory: (h: any[]) => void;
    setViewIndex: (i: number) => void;
    setGameId: (id: number | null) => void;
    setMyColor: (c: 'white' | 'black') => void;
    setSpectatingGameId: (id: number | null) => void;
    setActiveBot: (id: BotOpponentId | null) => void;
    setStateVersion: (v: number) => void;
    setWhitePlayer: (p: { username: string; rating: string }) => void;
    setBlackPlayer: (p: { username: string; rating: string }) => void;
    setRatingInfo: (r: any) => void;
    setGameOverResult: (r: string | null) => void;
    setDrawOfferStatus: React.Dispatch<React.SetStateAction<string | null>>;
    setRematchStatus: (s: 'none' | 'offered_by_me' | 'offered_by_opponent' | 'declined') => void;
    isSearching: boolean;
    setIsSearching: (v: boolean) => void;
    setIsManualFlip: (v: boolean) => void;
    setSelectedSquare: (s: string | null) => void;
    setPendingPromotion: (p: PendingPromotion | null) => void;
    /** Снимает премув — используется на старте/окончании партии и при отказе сервера. */
    clearPremove: () => void;
    setWhiteTimeMs: (ms: number) => void;
    setBlackTimeMs: (ms: number) => void;
    setLeftSectionTab: (t: 'bots' | 'lobby') => void;
    setLobbyTab: (t: 'lobby' | 'live') => void;
    setIsTimeDropdownOpen: (v: boolean) => void;
    setShowInvitePanel: (v: boolean) => void;
    moveStartTime: React.MutableRefObject<number>;
    resetLowTimeWarning: () => void;
    exitBotGame: () => void;
    playAudio: (type: SoundEventType) => void;
    playOutcomeSound: (result: string, playerColor?: 'white' | 'black') => void;
    updateSessionStats: (result: string) => void;
}

export interface UseGameSocketResult {
    chatMessages: ChatMessageItem[];
    chatInput: string;
    setChatInput: (v: string) => void;
    liveGames: LiveGameItem[];
    queuePlayers: QueuePlayer[];
    createdInviteCode: string | null;
    inviteCopied: boolean;
    applyMatchFoundSnapshot: (data: any) => void;
    applyMoveMadeSnapshot: (data: any) => void;
    startMatchmaking: () => Promise<void>;
    cancelMatchmaking: () => Promise<void>;
    acceptChallenge: (targetUserId: number) => Promise<void>;
    handleCreatePrivateInvite: () => void;
    handleCopyInviteLink: () => void;
    handleSpectateGame: (targetGameId: number) => void;
    handleSendChatMessage: (textToSend?: string) => void;
    handleAcceptRematch: () => void;
    handleDeclineRematch: () => void;
    handleOfferDraw: () => void;
    acceptDraw: () => void;
    declineDraw: () => void;
}

export function useGameSocket({
    gameId, gameIdRef, myColorRef, spectatingGameId, stateVersionRef,
    gameOverResult, gameOverResultRef, activeBot, currentUsernameRef, inviteCode, navigate,
    effectiveWhiteBaseMinutes, effectiveIncSeconds, selectedTimeControlLabel, inviteColorPref,
    ratedChoice, setIsRatedGame,
    setGame, setHistory, setViewIndex, setGameId, setMyColor, setSpectatingGameId,
    setStateVersion, setWhitePlayer, setBlackPlayer, setRatingInfo, setGameOverResult,
    setDrawOfferStatus, setRematchStatus, isSearching, setIsSearching, setIsManualFlip, setSelectedSquare,
    setPendingPromotion, clearPremove, setWhiteTimeMs, setBlackTimeMs, setLeftSectionTab,
    setLobbyTab, setIsTimeDropdownOpen, setShowInvitePanel, moveStartTime, resetLowTimeWarning,
    exitBotGame, playAudio, playOutcomeSound, updateSessionStats,
}: UseGameSocketOptions): UseGameSocketResult {
    const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [liveGames, setLiveGames] = useState<LiveGameItem[]>([]);
    const [queuePlayers, setQueuePlayers] = useState<QueuePlayer[]>([]);
    const [createdInviteCode, setCreatedInviteCode] = useState<string | null>(null);
    const [inviteCopied, setInviteCopied] = useState(false);

    // Обработчики WebSocket живут дольше одного рендера, поэтому актуальные значения читают из ref.
    const spectatingRef = useRef<number | null>(spectatingGameId);
    useEffect(() => {
        spectatingRef.current = spectatingGameId;
    }, [spectatingGameId]);
    const isSearchingRef = useRef(isSearching);
    useEffect(() => {
        isSearchingRef.current = isSearching;
    }, [isSearching]);
    // Параметры текущего поиска — чтобы вернуть вызов в лобби после переподключения WebSocket.
    const searchParamsRef = useRef<{ base_time_ms: number; increment_ms: number; rated: boolean } | null>(null);
    const missingActivePollsRef = useRef(0);

    // Ссылка-приглашение создаётся под конкретный тип партии — после смены типа она уже не та.
    useEffect(() => {
        setCreatedInviteCode(null);
    }, [ratedChoice]);

    /**
     * Событие относится к партии, которая сейчас на доске (своей или просматриваемой).
     * Без этой проверки запоздавший game_over прошлой партии завершал бы новую (реванш),
     * а ходы партии, которую игрок смотрел до начала своей, ложились бы на его доску.
     */
    const isCurrentGameEvent = useCallback((data: any): boolean => {
        if (data?.game_id === undefined || data?.game_id === null) return true;
        const gid = Number(data.game_id);
        return gid === gameIdRef.current || gid === spectatingRef.current;
    }, [gameIdRef]);

    const isOwnGameEvent = useCallback((data: any): boolean => {
        if (gameIdRef.current === null) return false;
        if (data?.game_id === undefined || data?.game_id === null) return true;
        return Number(data.game_id) === gameIdRef.current;
    }, [gameIdRef]);

    /** Завершает партию на экране: итог, звук и статистика — один раз на партию. */
    const concludeGame = useCallback((data: any) => {
        clearPremove();
        setPendingPromotion(null);
        // Итог мог уже прийти (move_made с game_over, затем game_over): не озвучиваем и не
        // считаем его второй раз. Ref обновляем сразу — эффект в компоненте сработает позже.
        const alreadyOver = Boolean(gameOverResultRef.current);
        gameOverResultRef.current = data.result;
        setGameOverResult(data.result);
        setRatingInfo(data);
        if (alreadyOver) return;
        if (gameIdRef.current !== null) {
            playOutcomeSound(data.result);
            updateSessionStats(data.result);
        } else {
            // Зритель: чужая партия не идёт в его статистику и не звучит как победа/поражение.
            playAudio('draw');
        }
    }, [clearPremove, setPendingPromotion, gameOverResultRef, setGameOverResult, setRatingInfo, gameIdRef,
        playOutcomeSound, updateSessionStats, playAudio]);

    const applyMatchFoundSnapshot = useCallback((data: any) => {
        if (!data || !data.game_id) return;
        const incomingGid = Number(data.game_id);
        const assignedColor: 'white' | 'black' = data.color === 'black' ? 'black' : 'white';
        const ver = Number(data.state_version || 0);
        const isNewMatch = gameIdRef.current !== incomingGid;

        if (spectatingRef.current) {
            gameSocket.send('leave_spectate', {game_id: spectatingRef.current});
            spectatingRef.current = null;
        }
        searchParamsRef.current = null;
        isSearchingRef.current = false;
        missingActivePollsRef.current = 0;

        setIsSearching(false);
        setSpectatingGameId(null);
        setCreatedInviteCode(null);
        setShowInvitePanel(false);
        exitBotGame();

        if (isNewMatch) {
            resetLowTimeWarning();
            setChatMessages([]);
            setIsManualFlip(false);
            setRatingInfo(null);
            gameOverResultRef.current = null;
            setGameOverResult(null);
            setRematchStatus('none');
            setSelectedSquare(null);
            setPendingPromotion(null);
            clearPremove();
        }

        gameIdRef.current = incomingGid;
        setGameId(incomingGid);
        setIsRatedGame(data.is_rated !== false);
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

        // Предложение ничьей, сделанное до перезагрузки страницы или обрыва связи, ещё в силе.
        const hasIncomingDrawOffer = data.draw_offer_from !== undefined && data.draw_offer_from !== null
            && Number(data.draw_offer_from) === Number(data.opponent_id);

        if (isNewMatch) {
            const startMessage = `Партия началась! Вы играете ${assignedColor === 'white' ? 'Белыми' : 'Чёрными'}.`;
            setDrawOfferStatus(hasIncomingDrawOffer ? DRAW_OFFER_INCOMING : startMessage);
            playAudio('start');
            // Убираем только своё сообщение: за 3 с на его месте мог появиться другой статус.
            setTimeout(() => setDrawOfferStatus(prev => (prev === startMessage ? null : prev)), 3000);
        } else if (hasIncomingDrawOffer) {
            setDrawOfferStatus(DRAW_OFFER_INCOMING);
        } else {
            setDrawOfferStatus(prev => (prev === DRAW_OFFER_INCOMING ? null : prev));
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
            // На завершающем ходу играет только исход (victory/defeat/draw) — звук самого
            // хода (например, «шах» на мате) был бы лишним дублем перед фанфарой.
            if (!data.game_over) {
                playAudio(resolveMoveSound(lastSan));
            }

            // Ход отвечает на предложение ничьей отказом (сервер его снимает): ход того, кому
            // предложили. Свой ход предложившего предложение не отменяет.
            const moverColor = nextGame.turn() === 'w' ? 'black' : 'white';
            const moverIsMe = moverColor === myColorRef.current;
            setDrawOfferStatus(prev => {
                if (prev === DRAW_OFFER_INCOMING && moverIsMe) return null;
                if (prev === DRAW_OFFER_OUTGOING && !moverIsMe) return null;
                return prev;
            });
        }

        if (data.game_over) {
            concludeGame(data);
        }
    }, [playAudio, concludeGame]);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        gameSocket.connect(token);

        const handleMatchFound = (data: any) => {
            applyMatchFoundSnapshot(data);
        };

        const handleMoveMade = (data: any) => {
            if (!isCurrentGameEvent(data)) return;
            applyMoveMadeSnapshot(data);
        };

        const handleGameOver = (data: any) => {
            if (!isCurrentGameEvent(data)) return;
            concludeGame(data);
            if (data.white_time_ms !== undefined) setWhiteTimeMs(data.white_time_ms);
            if (data.black_time_ms !== undefined) setBlackTimeMs(data.black_time_ms);
            const summary = describeGameOver(data.result, data.reason);
            if (summary) setDrawOfferStatus(summary);
        };

        const handleDrawOffered = (data: any) => {
            if (!isOwnGameEvent(data) || gameOverResultRef.current) return;
            setDrawOfferStatus(DRAW_OFFER_INCOMING);
            playAudio('offer');
        };

        const handleDrawDeclined = (data: any) => {
            if (!isOwnGameEvent(data) || gameOverResultRef.current) return;
            setDrawOfferStatus(DRAW_DECLINED);
            playAudio('decline');
            setTimeout(() => setDrawOfferStatus(prev => (prev === DRAW_DECLINED ? null : prev)), 3000);
        };

        const handleRematchOffered = (data: any) => {
            if (!isOwnGameEvent(data)) return;
            setRematchStatus('offered_by_opponent');
            playAudio('offer');
        };

        const handleRematchDeclined = (data: any) => {
            if (!isOwnGameEvent(data)) return;
            setRematchStatus('declined');
            playAudio('decline');
        };

        // Сервер шлёт connected при каждом (пере)подключении. При обрыве он снимает вызов игрока
        // из лобби, а экран продолжал бы показывать «поиск» — возвращаем вызов на место.
        const handleConnected = () => {
            const params = searchParamsRef.current;
            if (params && isSearchingRef.current && !gameIdRef.current) {
                gameSocket.send('join_queue', params);
            }
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
            if (gameIdRef.current && !gameOverResultRef.current) {
                // Пока шёл ответ, началась собственная партия — зрителем не становимся.
                gameSocket.send('leave_spectate', {game_id: data.game_id});
                return;
            }
            exitBotGame();
            gameIdRef.current = null;
            setGameId(null);
            spectatingRef.current = Number(data.game_id);
            setSpectatingGameId(Number(data.game_id));
            setIsRatedGame(data.is_rated !== false);
            // Зритель всегда смотрит со стороны белых и не наследует состояние прошлой партии.
            myColorRef.current = 'white';
            setMyColor('white');
            setIsManualFlip(false);
            setRatingInfo(null);
            setRematchStatus('none');
            setSelectedSquare(null);
            setPendingPromotion(null);
            clearPremove();
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
            gameOverResultRef.current = null;
            setGameOverResult(null);
            setChatMessages([]);
            setDrawOfferStatus(`Режим зрителя: ${data.white_username} vs ${data.black_username}`);
            playAudio('start');
        };

        const handleChatMessage = (data: any) => {
            if (!isCurrentGameEvent(data)) return;
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
            // Действие продублировано (WS + HTTP, повтор после переподключения), и партия уже
            // началась по первому из запросов — «вы уже играете» здесь не ошибка.
            if (data.code === 'self_in_game' && gameIdRef.current && !gameOverResultRef.current) return;
            if (data.code) {
                if (data.message) setDrawOfferStatus(data.message);
                // Отказ матчмейкинга (уже в партии, вне диапазона рейтинга, вызов неактуален...)
                // выводит из режима поиска; ограничения чата, предложений и частоты — нет.
                if (!GAME_ACTION_ERROR_CODES.has(data.code)) {
                    searchParamsRef.current = null;
                    setIsSearching(false);
                }
                // Ход, отклонённый по лимиту частоты, приходит с актуальной позицией —
                // её нужно вернуть на доску (ниже). Остальные отказы позицию не трогают.
                if (!data.fen && !data.pgn) return;
            }
            clearPremove();
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

        gameSocket.on('connected', handleConnected);
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
            gameSocket.off('connected', handleConnected);
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
    }, [applyMatchFoundSnapshot, applyMoveMadeSnapshot, concludeGame, isCurrentGameEvent, isOwnGameEvent,
        exitBotGame, playAudio]);

    useEffect(() => {
        if (!inviteCode || !localStorage.getItem('token')) return;
        const timer = setTimeout(() => {
            gameSocket.send('accept_invite', {code: inviteCode});
            navigate('/', {replace: true});
        }, 450);
        return () => clearTimeout(timer);
    }, [inviteCode, navigate]);

    /**
     * Партия завершилась на сервере, а game_over до клиента не дошёл: берём итог по HTTP.
     * Пока итог не записан в БД (status IN_PROGRESS), ничего не делаем — спросим ещё раз.
     */
    const concludeMissedGame = useCallback(async (missedGameId: number) => {
        const res = await fetch(`${API_BASE_URL}/api/v1/profile/games/${missedGameId}/summary`);
        if (!res.ok) return;
        const summary = await res.json();
        if (summary.status !== 'COMPLETED' && summary.status !== 'ABORTED') return;
        if (gameIdRef.current !== missedGameId || gameOverResultRef.current) return;

        missingActivePollsRef.current = 0;
        const result: string = summary.status === 'ABORTED' ? '*' : (summary.result || '*');
        concludeGame({...summary, result});
        setDrawOfferStatus(describeGameOver(result, summary.termination));
    }, [gameIdRef, gameOverResultRef, concludeGame, setDrawOfferStatus]);

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
                            missingActivePollsRef.current = 0;
                            if (gameIdRef.current !== Number(activeData.game_id)) {
                                applyMatchFoundSnapshot(activeData);
                                return;
                            } else if (Number(activeData.state_version || 0) > stateVersionRef.current) {
                                applyMoveMadeSnapshot(activeData);
                            }
                        } else if (gameIdRef.current && !gameOverResultRef.current) {
                            // На экране партия идёт, а сервер её активной уже не считает: game_over
                            // потерялся (обрыв WebSocket в момент завершения). Два ответа подряд —
                            // чтобы не спутать с запросом, отправленным до старта партии.
                            missingActivePollsRef.current += 1;
                            if (missingActivePollsRef.current >= MISSING_GAME_POLLS) {
                                await concludeMissedGame(gameIdRef.current);
                            }
                        } else {
                            missingActivePollsRef.current = 0;
                        }
                    }
                }

                // Лобби нужно и после завершения партии: её итог ещё на доске, но игрок уже
                // выбирает следующего соперника.
                if (!gameIdRef.current || gameOverResultRef.current) {
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
    }, [activeBot, spectatingGameId, applyMatchFoundSnapshot, applyMoveMadeSnapshot, concludeMissedGame]);

    const startMatchmaking = useCallback(async () => {
        if (spectatingRef.current) {
            // Поиск соперника завершает просмотр чужой партии: доска нужна для своей.
            gameSocket.send('leave_spectate', {game_id: spectatingRef.current});
            spectatingRef.current = null;
            setSpectatingGameId(null);
            setGame(new Chess());
            setHistory([]);
            setViewIndex(-1);
        }
        gameIdRef.current = null;
        setGameId(null);
        exitBotGame();
        resetLowTimeWarning();
        setPendingPromotion(null);
        clearPremove();
        gameOverResultRef.current = null;
        setGameOverResult(null);
        setRatingInfo(null);
        isSearchingRef.current = true;
        setIsSearching(true);
        setLeftSectionTab('lobby');
        setLobbyTab('lobby');
        setIsTimeDropdownOpen(false);
        setDrawOfferStatus(
            `Вы опубликовали ${ratedChoice ? 'рейтинговый' : 'товарищеский'} вызов в лобби (${selectedTimeControlLabel})...`,
        );

        const baseMs = Math.round(effectiveWhiteBaseMinutes * 60 * 1000);
        const incMs = Math.round(effectiveIncSeconds * 1000);

        searchParamsRef.current = {base_time_ms: baseMs, increment_ms: incMs, rated: ratedChoice};
        gameSocket.send('join_queue', {
            base_time_ms: baseMs,
            increment_ms: incMs,
            rated: ratedChoice
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
                    body: JSON.stringify({base_time_ms: baseMs, increment_ms: incMs, rated: ratedChoice})
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
    }, [
        gameIdRef, setGameId, exitBotGame, resetLowTimeWarning, setPendingPromotion, clearPremove,
        setGameOverResult, setRatingInfo, setIsSearching, setLeftSectionTab, setLobbyTab,
        setIsTimeDropdownOpen, setDrawOfferStatus, selectedTimeControlLabel, effectiveWhiteBaseMinutes,
        effectiveIncSeconds, applyMatchFoundSnapshot, gameOverResultRef, setSpectatingGameId, setGame,
        setHistory, setViewIndex, ratedChoice,
    ]);

    const cancelMatchmaking = useCallback(async () => {
        searchParamsRef.current = null;
        isSearchingRef.current = false;
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
    }, [setIsSearching, setDrawOfferStatus]);

    const acceptChallenge = useCallback(async (targetUserId: number) => {
        exitBotGame();
        setPendingPromotion(null);
        clearPremove();

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
    }, [exitBotGame, setPendingPromotion, clearPremove, applyMatchFoundSnapshot]);

    const handleCreatePrivateInvite = useCallback(() => {
        gameSocket.send('create_invite', {
            base_time_ms: Math.round(effectiveWhiteBaseMinutes * 60 * 1000),
            increment_ms: Math.round(effectiveIncSeconds * 1000),
            color_pref: inviteColorPref,
            rated: ratedChoice
        });
    }, [effectiveWhiteBaseMinutes, effectiveIncSeconds, inviteColorPref, ratedChoice]);

    const handleCopyInviteLink = useCallback(() => {
        if (!createdInviteCode) return;
        const url = `${window.location.origin}/challenge/${createdInviteCode}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).catch(() => {
            });
        }
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2500);
    }, [createdInviteCode]);

    const handleSpectateGame = useCallback((targetGameId: number) => {
        gameSocket.send('spectate_game', {game_id: targetGameId});
    }, []);

    const handleSendChatMessage = useCallback((textToSend?: string) => {
        const activeGid = gameId || spectatingGameId;
        const finalMsg = (textToSend ?? chatInput).trim();
        if (!activeGid || !finalMsg) return;
        gameSocket.send('chat_message', {
            game_id: activeGid,
            text: finalMsg.slice(0, 140)
        });
        if (!textToSend) setChatInput('');
    }, [gameId, spectatingGameId, chatInput]);

    const handleAcceptRematch = useCallback(() => {
        if (!gameId) return;
        gameSocket.send('accept_rematch', {game_id: gameId});
    }, [gameId]);

    const handleDeclineRematch = useCallback(() => {
        if (!gameId) return;
        gameSocket.send('decline_rematch', {game_id: gameId});
        setRematchStatus('none');
        playAudio('decline');
    }, [gameId, setRematchStatus, playAudio]);

    const handleOfferDraw = useCallback(() => {
        if (!gameId || gameOverResult) return;
        gameSocket.send('offer_draw', {game_id: gameId});
        setDrawOfferStatus(DRAW_OFFER_OUTGOING);
        playAudio('premove');
    }, [gameId, gameOverResult, setDrawOfferStatus, playAudio]);

    const acceptDraw = useCallback(() => {
        if (!gameId) return;
        gameSocket.send('accept_draw', {game_id: gameId});
        setDrawOfferStatus(null);
    }, [gameId, setDrawOfferStatus]);

    const declineDraw = useCallback(() => {
        if (!gameId) return;
        gameSocket.send('decline_draw', {game_id: gameId});
        setDrawOfferStatus(null);
        playAudio('decline');
    }, [gameId, setDrawOfferStatus, playAudio]);

    return {
        chatMessages, chatInput, setChatInput, liveGames, queuePlayers, createdInviteCode, inviteCopied,
        applyMatchFoundSnapshot, applyMoveMadeSnapshot, startMatchmaking, cancelMatchmaking, acceptChallenge,
        handleCreatePrivateInvite, handleCopyInviteLink, handleSpectateGame, handleSendChatMessage,
        handleAcceptRematch, handleDeclineRematch, handleOfferDraw, acceptDraw, declineDraw,
    };
}
