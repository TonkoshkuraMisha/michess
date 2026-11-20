// --- FILE: frontend/src/components/chessboard/hooks/useGameSocket.ts ---
// Матчмейкинг, PvP-партия по WebSocket, лобби/зрители и чат. Основное игровое состояние
// (game/history/viewIndex/gameId/myColor/gameOverResult и т.п.) остаётся в Chessboard.tsx как
// обычный useState и передаётся сюда параметрами — оно одинаково нужно и этому хуку, и useBotGame
// (партия с ботом использует те же game/history/gameOverResult/... поля), и порядок вызова
// хуков не позволяет кому-то одному быть единственным владельцем без цикла зависимостей.
//
// Откуда данные. WebSocket (services/gameSocket.ts, сервер — src/api/websockets.py), события: connected,
// match_found (старт или восстановление партии), move_made (ход: позиция, часы, версия состояния), game_over (итог
// и изменение рейтинга), berserk, draw_offered / draw_declined, rematch_offered / rematch_declined, invite_created,
// spectate_started, chat_message, error (отказ с кодом из src/core/errors.py). Действия, которые хук отправляет:
// join_queue, leave_queue, accept_challenge, create_invite, accept_invite, spectate_game, leave_spectate,
// chat_message, offer_draw, accept_draw, decline_draw, accept_rematch, decline_rematch, berserk (ход, сдачу, отмену
// и предложение реванша отправляет сам Chessboard). HTTP — подстраховка на случай потерянного события и источник
// списков, опрос раз в 1,5 с: GET /profile/games/my-active (идущая партия игрока), GET /profile/matchmaking/queue
// (вызовы в лобби), GET /profile/games/live (идущие партии), GET /profile/games/{id}/summary (итог пропущенной
// партии); вход в лобби и приём вызова дублируются POST /profile/matchmaking/join, /leave и /accept/{id}.
// Источник правды о позиции, часах и итоге — сервер: хук кладёт на доску то, что он прислал.

import {inviteOddsFields} from '../odds';
import type {OddsChoice} from '../odds';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {NavigateFunction} from 'react-router-dom';
import {Chess} from 'chess.js';
import {gameSocket} from '../../../services/gameSocket';
import {resolveMoveSound} from '../../../services/soundEngine';
import type {SoundEventType} from '../../../services/soundEngine';
import {API_BASE_URL} from '../../../config/api';
import {GAME_ACTION_ERROR_CODES} from '../types';
import {appendChat, chatItemFrom, sendChatPreset, sendChatText} from '../gameChat';
import type {LiveGameItem, ChatMessageItem, QueuePlayer, PendingPromotion, ChatPresetId} from '../types';
import type {BotOpponentId} from '../../../config/champions';
import {describeGameOver, hasStatusKey, messageParam, status} from '../status';
import type {GameStatus} from '../status';
import {serverErrorMessage} from '../../../services/apiErrors';
import {getToken} from '../../../services/authToken';

// Статусы ничьей — общие объекты: по ключу статуса Chessboard решает, показывать ли кнопки «Принять / Отклонить».
const DRAW_OFFER_INCOMING = status('status.drawOffered');
const DRAW_OFFER_OUTGOING = status('status.drawOfferSent');
const DRAW_DECLINED = status('status.drawDeclined');

/** Сколько опросов подряд сервер должен ответить «активной партии нет», чтобы считать её завершённой. */
const MISSING_GAME_POLLS = 2;

/**
 * Что хук получает от Chessboard: значения состояния, их сеттеры и ref-копии. Ref нужны обработчикам WebSocket —
 * они подписываются один раз и должны видеть текущую партию, а не ту, что была при подписке.
 */
export interface UseGameSocketOptions {
    /** id своей партии с человеком; null — такой партии нет (свободная доска, бот, просмотр). */
    gameId: number | null;
    gameIdRef: React.MutableRefObject<number | null>;
    myColorRef: React.MutableRefObject<'white' | 'black'>;
    /** id чужой партии, которую игрок смотрит; null — не зритель. */
    spectatingGameId: number | null;
    /** Версия состояния партии на сервере (растёт с каждым ходом): по ней отбрасываются устаревшие снимки. */
    stateVersionRef: React.MutableRefObject<number>;
    gameOverResult: string | null;
    gameOverResultRef: React.MutableRefObject<string | null>;
    activeBot: BotOpponentId | null;
    currentUsernameRef: React.MutableRefObject<string>;
    /** Код из адреса /challenge/{код}: приглашение принимается сразу после открытия страницы. */
    inviteCode: string | undefined;
    navigate: NavigateFunction;
    effectiveWhiteBaseMinutes: number;
    effectiveIncSeconds: number;
    inviteColorPref: 'white' | 'black' | 'random';
    /** Фора в партии по ссылке (21.1): сервер строит позицию или время после распределения цветов. */
    inviteOdds?: OddsChoice;
    /** Вариант партии по ссылке: обычные шахматы или Фишера (21.3; 960 идёт на отдельной странице). */
    inviteVariant?: 'standard' | 'chess960';
    /** Тип новых партий, выбранный игроком: рейтинговая или товарищеская. */
    ratedChoice: boolean;
    /** Тип партии, которая сейчас на доске (приходит с сервера). */
    setIsRatedGame: (rated: boolean) => void;
    /** «Песочные часы» партии на доске (21.1, поле hourglass с сервера): часы ждущего растут, пока думает ходящий. */
    setHourglass: (on: boolean) => void;

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
    setDrawOfferStatus: React.Dispatch<React.SetStateAction<GameStatus | null>>;
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

/** «Берсерк» в партии арены (33.3): доступен ли он в партии и кто его сыграл. */
export interface BerserkState {
    allowed: boolean;
    white: boolean;
    black: boolean;
}

const NO_BERSERK: BerserkState = {allowed: false, white: false, black: false};

// Поля берсерка из события сервера (match_found, spectate_started, berserk): berserk_allowed, white_berserk,
// black_berserk; отсутствующее поле — «нет».
function berserkFrom(data: any): BerserkState {
    return {allowed: data.berserk_allowed === true, white: data.white_berserk === true, black: data.black_berserk === true};
}

export interface UseGameSocketResult {
    berserk: BerserkState;
    /** Сыграть «берсерк»: половина своего времени без добавки ради лишнего очка за победу. */
    handleBerserk: () => void;
    /** Чат партии на доске (последние 50 сообщений); очищается при новой партии и при начале просмотра. */
    chatMessages: ChatMessageItem[];
    chatInput: string;
    setChatInput: (v: string) => void;
    /** Идущие партии (GET /profile/games/live) и вызовы в лобби (GET /profile/matchmaking/queue), опрос. */
    liveGames: LiveGameItem[];
    queuePlayers: QueuePlayer[];
    /** Код ссылки-приглашения из события invite_created; сбрасывается при смене типа партии и при старте партии. */
    createdInviteCode: string | null;
    inviteCopied: boolean;
    /** Ставит на доску партию целиком по снимку сервера: событие match_found или ответ HTTP (my-active, join, accept). */
    applyMatchFoundSnapshot: (data: any) => void;
    /** Обновляет идущую партию по снимку хода: событие move_made или более свежий ответ my-active. */
    applyMoveMadeSnapshot: (data: any) => void;
    /** Публикует вызов в лобби с выбранным контролем и типом партии (WebSocket и, для надёжности, HTTP). */
    startMatchmaking: () => Promise<void>;
    cancelMatchmaking: () => Promise<void>;
    /** Принимает чужой вызов из лобби; партия начнётся по match_found или по ответу HTTP. */
    acceptChallenge: (targetUserId: number) => Promise<void>;
    /** Просит сервер создать ссылку-приглашение (create_invite); код придёт событием invite_created. */
    handleCreatePrivateInvite: () => void;
    handleCopyInviteLink: () => void;
    /** Просит сервер сделать игрока зрителем партии; доска переключится по событию spectate_started. */
    handleSpectateGame: (targetGameId: number) => void;
    handleSendChatMessage: () => void;
    handleSendChatPreset: (preset: ChatPresetId) => void;
    handleAcceptRematch: () => void;
    handleDeclineRematch: () => void;
    handleOfferDraw: () => void;
    acceptDraw: () => void;
    declineDraw: () => void;
}

/**
 * Партия с человеком, лобби, просмотр и чат для главной доски (подробности и источники данных — в начале файла).
 * Работает только для вошедшего игрока: без токена соединение не открывается, опрашиваются лишь списки лобби.
 */
export function useGameSocket({
    gameId, gameIdRef, myColorRef, spectatingGameId, stateVersionRef,
    gameOverResult, gameOverResultRef, activeBot, currentUsernameRef, inviteCode, navigate,
    effectiveWhiteBaseMinutes, effectiveIncSeconds, inviteColorPref, inviteOdds, inviteVariant = 'standard',
    ratedChoice, setIsRatedGame, setHourglass,
    setGame, setHistory, setViewIndex, setGameId, setMyColor, setSpectatingGameId,
    setStateVersion, setWhitePlayer, setBlackPlayer, setRatingInfo, setGameOverResult,
    setDrawOfferStatus, setRematchStatus, isSearching, setIsSearching, setIsManualFlip, setSelectedSquare,
    setPendingPromotion, clearPremove, setWhiteTimeMs, setBlackTimeMs,
    setLobbyTab, setIsTimeDropdownOpen, setShowInvitePanel, moveStartTime, resetLowTimeWarning,
    exitBotGame, playAudio, playOutcomeSound, updateSessionStats,
}: UseGameSocketOptions): UseGameSocketResult {
    const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [liveGames, setLiveGames] = useState<LiveGameItem[]>([]);
    const [queuePlayers, setQueuePlayers] = useState<QueuePlayer[]>([]);
    const [createdInviteCode, setCreatedInviteCode] = useState<string | null>(null);
    const [inviteCopied, setInviteCopied] = useState(false);
    const [berserk, setBerserk] = useState<BerserkState>(NO_BERSERK);

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
    // Сколько опросов подряд сервер не нашёл активной партии, хотя на экране она идёт (см. MISSING_GAME_POLLS).
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

    /** Событие относится к своей партии, а не к просматриваемой: предложения ничьей и реванша зрителю не нужны. */
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

    // Снимок партии целиком: новая партия (старт, реванш, принятый вызов) или восстановление своей идущей партии
    // после перезагрузки страницы. Позиция берётся из PGN сервера (с историей ходов), при сбое разбора — из FEN.
    const applyMatchFoundSnapshot = useCallback((data: any) => {
        if (!data || !data.game_id) return;
        // Партия Фишера (21.3): chess.js рокировку 960 не переиграет — партия идёт на своей странице.
        if (data.variant === 'chess960') {
            navigate('/play/960/live', {state: {match: data}});
            return;
        }
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
        // Снимок той же партии без полей берсерка (опрос по HTTP) уже известное не стирает.
        if (isNewMatch || data.berserk_allowed !== undefined) setBerserk(berserkFrom(data));
        if (isNewMatch || data.hourglass !== undefined) setHourglass(data.hourglass === true);
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
            const startMessage = status(assignedColor === 'white' ? 'status.gameStartedWhite' : 'status.gameStartedBlack');
            setDrawOfferStatus(hasIncomingDrawOffer ? DRAW_OFFER_INCOMING : startMessage);
            playAudio('start');
            // Убираем только своё сообщение: за 3 с на его месте мог появиться другой статус.
            setTimeout(() => setDrawOfferStatus(prev => (prev === startMessage ? null : prev)), 3000);
        } else if (hasIncomingDrawOffer) {
            setDrawOfferStatus(DRAW_OFFER_INCOMING);
        } else {
            setDrawOfferStatus(prev => (hasStatusKey(prev, 'status.drawOffered') ? null : prev));
        }
    }, [playAudio, navigate]);

    // Снимок после хода (своего или соперника): версия состояния, часы обеих сторон и позиция — всё с сервера.
    // Свой ход уже показан на доске заранее; этот снимок его подтверждает и выставляет точные часы.
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
                if (hasStatusKey(prev, 'status.drawOffered') && moverIsMe) return null;
                if (hasStatusKey(prev, 'status.drawOfferSent') && !moverIsMe) return null;
                return prev;
            });
        }

        if (data.game_over) {
            concludeGame(data);
        }
    }, [playAudio, concludeGame]);

    // Подключение к WebSocket и подписка на события сервера; при размонтировании доски подписки снимаются, а
    // само соединение остаётся (оно одно на вкладку и нужно также уведомлениям).
    useEffect(() => {
        const token = getToken();
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

        // Берсерк (свой или соперника): новые часы и отметка у игрока.
        const handleBerserkEvent = (data: any) => {
            if (!isCurrentGameEvent(data) || gameOverResultRef.current) return;
            if (data.white_time_ms !== undefined) setWhiteTimeMs(Number(data.white_time_ms));
            if (data.black_time_ms !== undefined) setBlackTimeMs(Number(data.black_time_ms));
            setBerserk(berserkFrom(data));
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
            setTimeout(() => setDrawOfferStatus(prev => (hasStatusKey(prev, 'status.drawDeclined') ? null : prev)), 3000);
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

        // Сервер создал приглашение: ссылка сразу копируется в буфер обмена (если браузер разрешает).
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

        // Сервер сделал игрока зрителем и прислал снимок чужой партии: игроки, часы, позиция.
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
            setBerserk(berserkFrom(data));
            setHourglass(data.hourglass === true);
            // Зритель всегда смотрит со стороны белых и не наследует состояние прошлой партии.
            myColorRef.current = 'white';
            setMyColor('white');
            setIsManualFlip(false);
            setRatingInfo(null);
            setRematchStatus('none');
            setSelectedSquare(null);
            setPendingPromotion(null);
            clearPremove();
            setWhitePlayer({username: data.white_username || '', rating: String(data.white_rating || 1200)});
            setBlackPlayer({username: data.black_username || '', rating: String(data.black_rating || 1200)});
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
            setDrawOfferStatus(status('status.spectating', {
                white: data.white_username || messageParam('common.white'),
                black: data.black_username || messageParam('common.black'),
            }));
            playAudio('start');
        };

        // Сообщение чата (своё тоже приходит эхом с сервера). В памяти — последние 50; быстрая фраза хранится кодом.
        const handleChatMessage = (data: any) => {
            if (!isCurrentGameEvent(data)) return;
            const item = chatItemFrom(data);
            if (item) {
                setChatMessages(prev => appendChat(prev, item));
                if (item.sender !== currentUsernameRef.current) {
                    playAudio('chat');
                }
            }
        };

        const handleServerError = (data: any) => {
            console.warn('Server rejected the action:', data);
            // Действие продублировано (WS + HTTP, повтор после переподключения), и партия уже
            // началась по первому из запросов — «вы уже играете» здесь не ошибка.
            if (data.code === 'self_in_game' && gameIdRef.current && !gameOverResultRef.current) return;
            if (data.code) {
                // Текст — из каталога по коду; английский текст сервера — только для незнакомого кода.
                const message = serverErrorMessage(data.code, data.params, data.message);
                if (message) setDrawOfferStatus(message);
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
        gameSocket.on('berserk', handleBerserkEvent);
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
            gameSocket.off('berserk', handleBerserkEvent);
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

    // Страница открыта по ссылке-приглашению /challenge/{код}: принимаем приглашение (accept_invite) и убираем
    // код из адреса. Действие уходит через 450 мс после открытия страницы; уход со страницы раньше его отменяет.
    // Гость сначала входит (окно входа открывает App.tsx); после входа доска создаётся заново и эффект срабатывает.
    useEffect(() => {
        if (!inviteCode || !getToken()) return;
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

    // Опрос сервера раз в 1,5 с — подстраховка WebSocket и источник списков лобби. Своя идущая партия (my-active):
    // новая — ставится на доску, более свежая версия — догоняется, пропавшая — завершается по summary. Пока идёт
    // партия с ботом или просмотр, my-active не опрашивается. Списки лобби и Live читаются, когда своей партии с
    // человеком нет или она окончена.
    useEffect(() => {
        const syncLobbyAndActiveGame = async () => {
            const token = getToken();
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
        setLobbyTab('lobby');
        setIsTimeDropdownOpen(false);
        setDrawOfferStatus(status(ratedChoice ? 'status.challengePublishedRated' : 'status.challengePublishedCasual', {
            timeControl: effectiveIncSeconds > 0
                ? messageParam('timeControl.minutesIncrement', {base: effectiveWhiteBaseMinutes, inc: effectiveIncSeconds})
                : messageParam('timeControl.minutes', {base: effectiveWhiteBaseMinutes}),
        }));

        const baseMs = Math.round(effectiveWhiteBaseMinutes * 60 * 1000);
        const incMs = Math.round(effectiveIncSeconds * 1000);

        searchParamsRef.current = {base_time_ms: baseMs, increment_ms: incMs, rated: ratedChoice};
        gameSocket.send('join_queue', {
            base_time_ms: baseMs,
            increment_ms: incMs,
            rated: ratedChoice
        });

        const token = getToken();
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
        setGameOverResult, setRatingInfo, setIsSearching, setLobbyTab,
        setIsTimeDropdownOpen, setDrawOfferStatus, effectiveWhiteBaseMinutes,
        effectiveIncSeconds, applyMatchFoundSnapshot, gameOverResultRef, setSpectatingGameId, setGame,
        setHistory, setViewIndex, ratedChoice,
    ]);

    const cancelMatchmaking = useCallback(async () => {
        searchParamsRef.current = null;
        isSearchingRef.current = false;
        setIsSearching(false);
        setDrawOfferStatus(null);
        gameSocket.send('leave_queue', {});
        const token = getToken();
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

        const token = getToken();
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
            console.error('Failed to accept the challenge over HTTP:', err);
        }
    }, [exitBotGame, setPendingPromotion, clearPremove, applyMatchFoundSnapshot]);

    const handleCreatePrivateInvite = useCallback(() => {
        gameSocket.send('create_invite', {
            base_time_ms: Math.round(effectiveWhiteBaseMinutes * 60 * 1000),
            increment_ms: Math.round(effectiveIncSeconds * 1000),
            color_pref: inviteColorPref,
            rated: ratedChoice,
            ...(inviteVariant === 'chess960' ? {variant: 'chess960'} : (inviteOdds ? inviteOddsFields(inviteOdds) : {})),
        });
    }, [effectiveWhiteBaseMinutes, effectiveIncSeconds, inviteColorPref, ratedChoice, inviteOdds, inviteVariant]);

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

    const handleSendChatMessage = useCallback(() => {
        const activeGid = gameId || spectatingGameId;
        if (activeGid && sendChatText(activeGid, chatInput)) setChatInput('');
    }, [gameId, spectatingGameId, chatInput]);

    /** Быстрая фраза уходит кодом: каждый участник увидит её на своём языке. */
    const handleSendChatPreset = useCallback((preset: ChatPresetId) => {
        const activeGid = gameId || spectatingGameId;
        if (activeGid) sendChatPreset(activeGid, preset);
    }, [gameId, spectatingGameId]);

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

    const handleBerserk = useCallback(() => {
        if (!gameId || gameOverResult) return;
        gameSocket.send('berserk', {game_id: gameId});
    }, [gameId, gameOverResult]);

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
        handleCreatePrivateInvite, handleCopyInviteLink, handleSpectateGame, handleSendChatMessage, handleSendChatPreset,
        handleAcceptRematch, handleDeclineRematch, handleOfferDraw, acceptDraw, declineDraw,
        berserk, handleBerserk,
    };
}
