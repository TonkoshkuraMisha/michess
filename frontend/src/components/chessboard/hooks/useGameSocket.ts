// --- FILE: frontend/src/components/chessboard/hooks/useGameSocket.ts ---
// Матчмейкинг, PvP-партия по WebSocket, лобби/зрители и чат. Основное игровое состояние
// (game/history/viewIndex/gameId/myColor/gameOverResult и т.п.) остаётся в Chessboard.tsx как
// обычный useState и передаётся сюда параметрами — оно равно нужно и этому хуку, и useBotGame
// (партия с ботом использует те же game/history/gameOverResult/... поля), и порядок вызова
// хуков не позволяет кому-то одному быть единственным владельцем без цикла зависимостей.

import {useCallback, useEffect, useState} from 'react';
import type {NavigateFunction} from 'react-router-dom';
import {Chess} from 'chess.js';
import {gameSocket} from '../../../services/gameSocket';
import {resolveMoveSound} from '../../../services/soundEngine';
import type {SoundEventType} from '../../../services/soundEngine';
import {API_BASE_URL} from '../../../config/api';
import {GAME_ACTION_ERROR_CODES} from '../types';
import type {LiveGameItem, ChatMessageItem, QueuePlayer, PendingPromotion} from '../types';
import type {HistoricalBotId} from '../../../config/champions';

export interface UseGameSocketOptions {
    gameId: number | null;
    gameIdRef: React.MutableRefObject<number | null>;
    myColorRef: React.MutableRefObject<'white' | 'black'>;
    spectatingGameId: number | null;
    stateVersionRef: React.MutableRefObject<number>;
    gameOverResult: string | null;
    gameOverResultRef: React.MutableRefObject<string | null>;
    activeBot: HistoricalBotId | null;
    currentUsernameRef: React.MutableRefObject<string>;
    inviteCode: string | undefined;
    navigate: NavigateFunction;
    effectiveWhiteBaseMinutes: number;
    effectiveIncSeconds: number;
    selectedTimeControlLabel: string;
    inviteColorPref: 'white' | 'black' | 'random';

    setGame: (g: Chess) => void;
    setHistory: (h: any[]) => void;
    setViewIndex: (i: number) => void;
    setGameId: (id: number | null) => void;
    setMyColor: (c: 'white' | 'black') => void;
    setSpectatingGameId: (id: number | null) => void;
    setActiveBot: (id: HistoricalBotId | null) => void;
    setStateVersion: (v: number) => void;
    setWhitePlayer: (p: { username: string; rating: string }) => void;
    setBlackPlayer: (p: { username: string; rating: string }) => void;
    setRatingInfo: (r: any) => void;
    setGameOverResult: (r: string | null) => void;
    setDrawOfferStatus: (s: string | null) => void;
    setRematchStatus: (s: 'none' | 'offered_by_me' | 'offered_by_opponent' | 'declined') => void;
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
    setGame, setHistory, setViewIndex, setGameId, setMyColor, setSpectatingGameId, setActiveBot,
    setStateVersion, setWhitePlayer, setBlackPlayer, setRatingInfo, setGameOverResult,
    setDrawOfferStatus, setRematchStatus, setIsSearching, setIsManualFlip, setSelectedSquare,
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
        exitBotGame();

        if (isNewMatch) {
            resetLowTimeWarning();
            setChatMessages([]);
            setIsManualFlip(false);
            setRatingInfo(null);
            setGameOverResult(null);
            setRematchStatus('none');
            setSelectedSquare(null);
            setPendingPromotion(null);
            clearPremove();
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
            // На завершающем ходу играет только исход (victory/defeat/draw) — звук самого
            // хода (например, «шах» на мате) был бы лишним дублем перед фанфарой.
            if (!data.game_over) {
                playAudio(resolveMoveSound(lastSan));
            }
        }

        if (data.game_over) {
            clearPremove();
            setPendingPromotion(null);
            setGameOverResult(data.result);
            setRatingInfo(data);
            playOutcomeSound(data.result);
            updateSessionStats(data.result);
        }
    }, [playAudio, playOutcomeSound, updateSessionStats]);

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
            clearPremove();
            setPendingPromotion(null);
            // Партия могла уже быть завершена сообщением move_made (оно приходит первым на том же
            // соединении) — тогда исход уже озвучен и статистика уже обновлена, повторять не нужно.
            if (!gameOverResultRef.current) {
                playOutcomeSound(data.result);
                updateSessionStats(data.result);
            }
            setGameOverResult(data.result);
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
                if (data.message) setDrawOfferStatus(data.message);
                // Отказ матчмейкинга (уже в партии, вне диапазона рейтинга, вызов неактуален...)
                // выводит из режима поиска; ограничения чата, предложений и частоты — нет.
                if (!GAME_ACTION_ERROR_CODES.has(data.code)) setIsSearching(false);
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

    const startMatchmaking = useCallback(async () => {
        gameIdRef.current = null;
        setGameId(null);
        exitBotGame();
        resetLowTimeWarning();
        setPendingPromotion(null);
        clearPremove();
        setGameOverResult(null);
        setRatingInfo(null);
        setIsSearching(true);
        setLeftSectionTab('lobby');
        setLobbyTab('lobby');
        setIsTimeDropdownOpen(false);
        setDrawOfferStatus(`Вы опубликовали вызов в лобби (${selectedTimeControlLabel})...`);

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
    }, [
        gameIdRef, setGameId, exitBotGame, resetLowTimeWarning, setPendingPromotion, clearPremove,
        setGameOverResult, setRatingInfo, setIsSearching, setLeftSectionTab, setLobbyTab,
        setIsTimeDropdownOpen, setDrawOfferStatus, selectedTimeControlLabel, effectiveWhiteBaseMinutes,
        effectiveIncSeconds, applyMatchFoundSnapshot,
    ]);

    const cancelMatchmaking = useCallback(async () => {
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
            color_pref: inviteColorPref
        });
    }, [effectiveWhiteBaseMinutes, effectiveIncSeconds, inviteColorPref]);

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
        setDrawOfferStatus('Вы предложили ничью...');
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
