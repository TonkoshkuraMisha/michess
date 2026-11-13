// --- FILE: frontend/src/components/Chessboard.tsx ---

import {useState, useEffect, useRef, useCallback} from 'react';
import {Link, useLocation, useNavigate, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {ListOrdered, Bot, Zap, Radio} from 'lucide-react';
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
import {HISTORICAL_BOTS} from '../config/champions';
import type {BotOpponentId, HistoricalBotId, HistoricalBotProfile} from '../config/champions';
import {ALL_TIME_CONTROLS, DEFAULT_TIME_CONTROL, TIME_CONTROLS, timeControlCategory} from '../config/timeControls';
import type {TournamentGameStart} from '../services/tournaments';
import type {TimeControlOption, TimeControlGroup} from '../config/timeControls';
import {
    FILES, RANKS, MIN_BOARD_SIZE, MAX_BOARD_SIZE,
    getMaxViewportBoardSize, getDefaultBoardSize, calculateMaterialBalance, cloneChessInstance, prevIndexHelper,
    customStartFen, pairHalfMoves, validateFen, STANDARD_START_FEN
} from './chessboard/boardUtils';
import type {PromotionPiece} from './chessboard/boardUtils';
import type {PendingPromotion} from './chessboard/types';
import {useClock} from './chessboard/hooks/useClock';
import {usePremoves} from './chessboard/hooks/usePremoves';
import {useBotGame} from './chessboard/hooks/useBotGame';
import {useCoachMode} from './chessboard/hooks/useCoachMode';
import {CoachPanel} from './chessboard/CoachPanel';
import {CoachArrowsOverlay} from './chessboard/CoachArrowsOverlay';
import {AnnotationsOverlay, useBoardAnnotations} from './chessboard/annotations';
import {coachArrows, coachHighlights} from '../services/coach';
import {AuxBoard} from './chessboard/AuxBoard';
import {XrayOverlay} from './xray/XrayOverlay';
import {XrayPanel} from './xray/XrayPanel';
import {useXraySettings} from './xray/useXraySettings';
import {GameSummaryPanel} from './chessboard/GameSummaryPanel';
import {outcomeFor, recommendOpponent} from '../services/gameSummary';
import type {PoolOpponent} from '../services/gameSummary';
import type {BotCatalog} from '../services/botCatalog';
import {useGameSocket} from './chessboard/hooks/useGameSocket';
import {PromotionDialog} from './chessboard/PromotionDialog';
import {MoveList} from './chessboard/MoveList';
import {BoardNavigationControls} from './chessboard/BoardNavigationControls';
import {GameChatPanel} from './chessboard/GameChatPanel';
import {PlayerInfoBar} from './chessboard/PlayerInfoBar';
import {GameControlsPanel} from './chessboard/GameControlsPanel';
import {GameHallHeader} from './chessboard/GameHallHeader';
import {TimeControlPicker} from './chessboard/TimeControlPicker';
import {MatchmakingPanel} from './chessboard/MatchmakingPanel';
import {HistoricalBotsPanel} from './chessboard/HistoricalBotsPanel';
import {PersonalityWorkshop} from './chessboard/PersonalityWorkshop';
import {LadderPanel} from './chessboard/LadderPanel';
import type {LadderStart} from './chessboard/LadderPanel';
import {ladderOutcomeMessage} from './chessboard/hooks/useBotGame';
import {hasStatusKey, renderStatus, status} from './chessboard/status';
import type {GameStatus} from './chessboard/status';
import {useI18n} from '../i18n';
import {fetchBotCatalog} from '../services/botCatalog';
import {isArchetypeId} from '../config/archetypes';
import type {ArchetypeId} from '../config/archetypes';
import type {CustomOpponent} from '../config/archetypes';
import {LobbyPanel} from './chessboard/LobbyPanel';
import {AppearancePickerDropdown} from './chessboard/AppearancePickerDropdown';

export {MIN_BOARD_SIZE, MAX_BOARD_SIZE, getMaxViewportBoardSize, getDefaultBoardSize, TIME_CONTROLS};
export type {PromotionPiece, TimeControlOption, TimeControlGroup};

export {BOARD_THEMES, HISTORICAL_BOTS};
export type {BoardTheme, HistoricalBotId, HistoricalBotProfile};

export default function Chessboard() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const {inviteCode} = useParams<{ inviteCode?: string }>();

    const [leftSectionTab, setLeftSectionTab] = useState<'bots' | 'lobby'>('bots');
    const [lobbyTab, setLobbyTab] = useState<'lobby' | 'live'>('lobby');
    const [showInvitePanel, setShowInvitePanel] = useState(false);
    const [showAppearanceDropdown, setShowAppearanceDropdown] = useState(false);
    const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => soundEngine.isMuted());
    const appearanceDropdownRef = useRef<HTMLDivElement>(null);

    const [spectatingGameId, setSpectatingGameId] = useState<number | null>(null);
    const [inviteColorPref, setInviteColorPref] = useState<'white' | 'black' | 'random'>('random');
    // Тип новых партий (вызов в лобби и приглашение по ссылке) и тип партии, идущей на доске.
    const [ratedChoice, setRatedChoice] = useState<boolean>(true);
    const [isRatedGame, setIsRatedGame] = useState<boolean>(true);
    // Партию с ботом можно начать с позиции, стоящей на свободной доске.
    const [startFromPosition, setStartFromPosition] = useState<boolean>(false);

    const [game, setGame] = useState(new Chess());
    const [history, setHistory] = useState<any[]>([]);
    const [viewIndex, setViewIndex] = useState<number>(-1);
    const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
    const [isManualFlip, setIsManualFlip] = useState<boolean>(false);

    const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

    const [boardThemeKey, setBoardThemeKey] = useState<string>(() => getSavedBoardThemeKey());
    const [pieceSetKey, setPieceSetKey] = useState<string>(() => getSavedPieceSetKey());

    const [gameId, setGameId] = useState<number | null>(null);
    const gameIdRef = useRef<number | null>(null);
    const [myColor, setMyColor] = useState<'white' | 'black'>('white');
    const myColorRef = useRef<'white' | 'black'>('white');
    const [isSearching, setIsSearching] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [currentUsername, setCurrentUsername] = useState<string>('');
    const currentUsernameRef = useRef<string>('');
    const [currentUserRating, setCurrentUserRating] = useState<number>(1200);
    const [stateVersion, setStateVersion] = useState(0);
    const stateVersionRef = useRef<number>(0);

    // activeBot живёт здесь (не внутри useBotGame), потому что useClock использует его
    // для isTicking/isParticipant и должен вызываться раньше useBotGame.
    const [activeBot, setActiveBot] = useState<BotOpponentId | null>(null);
    // Вкладка ботов: исторические мастера или мастерская соперников.
    const [botsView, setBotsView] = useState<'historical' | 'workshop' | 'ladder'>('historical');
    // Измеренная сила исторических ботов (калибровка матчами), если она есть.
    const [measuredBotRatings, setMeasuredBotRatings] = useState<Record<string, number>>({});
    // Каталог целиком — для рекомендации следующего соперника в итоге партии (таск 11.5).
    const [botCatalog, setBotCatalog] = useState<BotCatalog | null>(null);
    useEffect(() => {
        fetchBotCatalog()
            .then((catalog) => {
                setBotCatalog(catalog);
                setMeasuredBotRatings(Object.fromEntries(
                    catalog.historical.filter((h) => h.measured).map((h) => [h.id, h.rating]),
                ));
            })
            .catch(() => undefined);
    }, []);

    const [selectedTimeControl, setSelectedTimeControl] = useState<TimeControlOption>(DEFAULT_TIME_CONTROL);
    const [manualBaseMinutes, setManualBaseMinutes] = useState<number>(5);
    const [manualIncSeconds, setManualIncSeconds] = useState<number>(3);
    const [isTimeDropdownOpen, setIsTimeDropdownOpen] = useState(false);
    const timeDropdownRef = useRef<HTMLDivElement>(null);
    const boardContainerRef = useRef<HTMLDivElement>(null);
    const notationScrollRef = useRef<HTMLDivElement>(null);

    // Пустое имя — игрок неизвестен: на экране вместо него «Белые»/«Чёрные» на текущем языке.
    const [whitePlayer, setWhitePlayer] = useState({username: '', rating: '1200'});
    const [blackPlayer, setBlackPlayer] = useState({username: '', rating: '1200'});
    const shownWhitePlayer = {...whitePlayer, username: whitePlayer.username || t('common.white')};
    const shownBlackPlayer = {...blackPlayer, username: blackPlayer.username || t('common.black')};
    const [ratingInfo, setRatingInfo] = useState<{
        white_delta?: number;
        black_delta?: number;
        white_new_rating?: number;
        black_new_rating?: number;
    } | null>(null);

    const moveStartTime = useRef<number>(Date.now());

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

    const [sessionStats, setSessionStats] = useState({wins: 0, losses: 0, draws: 0});
    const [gameOverResult, setGameOverResult] = useState<string | null>(null);
    const gameOverResultRef = useRef<string | null>(null);
    useEffect(() => {
        gameOverResultRef.current = gameOverResult;
    }, [gameOverResult]);
    const [drawOfferStatus, setDrawOfferStatus] = useState<GameStatus | null>(null);
    const [rematchStatus, setRematchStatus] = useState<'none' | 'offered_by_me' | 'offered_by_opponent' | 'declined'>('none');

    const activeTheme = BOARD_THEMES[boardThemeKey] || BOARD_THEMES.walnut;
    const activePieceSet = PIECE_SETS[pieceSetKey] || PIECE_SETS.merida;

    const effectiveWhiteBaseMinutes = selectedTimeControl.isManual ? manualBaseMinutes : selectedTimeControl.base;
    const effectiveBlackBaseMinutes = effectiveWhiteBaseMinutes;
    const effectiveIncSeconds = selectedTimeControl.isManual ? manualIncSeconds : selectedTimeControl.inc;

    const isBoardFlipped = (myColor === 'black') !== isManualFlip;

    const playAudio = useCallback((type: SoundEventType) => {
        soundEngine.play(type);
    }, []);

    // Игра с наставником (таск 11.3): проверка ходов игрока и советы — в партии с ботом и на свободной доске.
    const coach = useCoachMode(currentUserRating);
    // Рентген доски (таск 12.1): свободная доска, партия с ботом при включённом наставнике, зритель. Игроку
    // идущей партии с человеком — нет (правило 2).
    const xray = useXraySettings();
    const coachAssistedRef = useRef(false);
    coachAssistedRef.current = coach.assisted;
    const isCoachAssisted = useCallback(() => coachAssistedRef.current, []);

    const {
        whiteTimeMs, setWhiteTimeMs, blackTimeMs, setBlackTimeMs, resetLowTimeWarning, applyIncrement,
    } = useClock({
        isTicking: Boolean(gameId || activeBot || spectatingGameId) && !gameOverResult && !coach.holdBot,
        isParticipant: Boolean(gameId || activeBot) && !gameOverResult,
        currentTurn: game.turn() === 'w' ? 'white' : 'black',
        myColor,
        onLowTime: () => playAudio('low_time'),
    });

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

    // usePremoves владеет setPremove, но вызывается позже (ему нужен executeMove, а тот —
    // значения из useBotGame). Безопасно: тело замыкания читает setPremove лениво, уже
    // после того как usePremoves успеет отработать в этом же рендере.
    const clearPremove = useCallback(() => setPremove(null), []);

    const {
        selectedBotId, setSelectedBotId, botComment, isBotThinking, savedBotGameId,
        startHistoricalBotGame, startCustomBotGame, botProfileFor, botNameParam, saveBotGameToDatabase, exitBotGame,
        isLadderGame, ladderOutcome, customArchetypeId, isTournamentGame, savedTournamentId,
    } = useBotGame({
        game, myColor, gameOverResult, whiteTimeMs, blackTimeMs, isSearching, setIsSearching,
        activeBot, setActiveBot,
        effectiveWhiteBaseMinutes, effectiveBlackBaseMinutes, effectiveIncSeconds,
        currentUsername, currentUserRating,
        setGame, setHistory, setViewIndex, setSelectedSquare, setMyColor, setIsManualFlip, setPendingPromotion,
        clearPremove, setGameOverResult, setRatingInfo, setDrawOfferStatus, setRematchStatus,
        setWhiteTimeMs, setBlackTimeMs, resetLowTimeWarning, applyIncrement,
        moveStartTime, myColorRef, gameIdRef, setGameId, setLeftSectionTab, setWhitePlayer, setBlackPlayer,
        playAudio, playOutcomeSound, updateSessionStats,
        holdBot: coach.holdBot, isAssisted: isCoachAssisted, onNewGame: coach.reset,
    });

    const selectedBotProfile = HISTORICAL_BOTS[selectedBotId];
    // Партия «на счёт» — лестница или турнир (таск A.2): без наставника, рентгена и возврата хода — сервер такую
    // помощь всё равно засчитал бы поражением или не засчитал бы партию.
    const isRatedBotGame = isLadderGame || isTournamentGame;
    const activeBotProfile = activeBot ? botProfileFor(activeBot) : null;

    const {
        chatMessages, chatInput, setChatInput, liveGames, queuePlayers, createdInviteCode, inviteCopied,
        startMatchmaking, cancelMatchmaking, acceptChallenge,
        handleCreatePrivateInvite, handleCopyInviteLink, handleSpectateGame, handleSendChatMessage, handleSendChatPreset,
        handleAcceptRematch, handleDeclineRematch, handleOfferDraw, acceptDraw, declineDraw,
    } = useGameSocket({
        gameId, gameIdRef, myColorRef, spectatingGameId, stateVersionRef,
        gameOverResult, gameOverResultRef, activeBot, currentUsernameRef, inviteCode, navigate,
        effectiveWhiteBaseMinutes, effectiveIncSeconds,
        inviteColorPref, ratedChoice, setIsRatedGame,
        setGame, setHistory, setViewIndex, setGameId, setMyColor, setSpectatingGameId, setActiveBot,
        setStateVersion, setWhitePlayer, setBlackPlayer, setRatingInfo, setGameOverResult,
        setDrawOfferStatus, setRematchStatus, isSearching, setIsSearching, setIsManualFlip, setSelectedSquare,
        setPendingPromotion, clearPremove, setWhiteTimeMs, setBlackTimeMs, setLeftSectionTab,
        setLobbyTab, setIsTimeDropdownOpen, setShowInvitePanel, moveStartTime, resetLowTimeWarning,
        exitBotGame, playAudio, playOutcomeSound, updateSessionStats,
    });

    const handleThemeChange = (themeId: string) => {
        setBoardThemeKey(themeId);
        localStorage.setItem('michess_board_theme', themeId);
    };

    const handlePieceSetChange = (setId: string) => {
        setPieceSetKey(setId);
        localStorage.setItem('michess_piece_set', setId);
    };

    const handleBoardSizeChange = (size: number) => {
        setBoardSize(size);
        localStorage.setItem('michess_board_size', String(size));
    };

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

    // Обработчик клавиш висит на window: историю и текущий ход читает через ref, обновляемый на каждом
    // рендере. Из замыкания эффекта (он перерегистрируется только после отрисовки) нажатие сразу после
    // хода видело прежнюю позицию — та же гонка, что была в GameViewer.
    const navigationRef = useRef({history, viewIndex});
    navigationRef.current = {history, viewIndex};

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setPendingPromotion(null);
                setPremove(null);
                setSelectedSquare(null);
                setShowAppearanceDropdown(false);
                return;
            }
            const {history, viewIndex} = navigationRef.current;
            if (history.length === 0) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            // setViewIndex принимает только готовое значение, а не функцию-обновитель: React
            // StrictMode в разработке вызывает такую функцию дважды, и звук из побочного эффекта
            // внутри неё проигрывался бы два раза подряд (рассинхронизированно, по разным тикам
            // Audio).
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const current = viewIndex === -1 ? history.length - 1 : prevIndexHelper(viewIndex, history.length);
                const nextIdx = current <= 0 ? -2 : current - 1;
                if (nextIdx === viewIndex) return;
                setViewIndex(nextIdx);
                if (nextIdx >= 0 && history[nextIdx]) {
                    playAudio(resolveMoveSound(history[nextIdx].san));
                } else {
                    playAudio('move');
                }
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (viewIndex === -1) return;
                const nextIdx = viewIndex === -2
                    ? (history.length > 1 ? 0 : -1)
                    : (viewIndex + 1 >= history.length - 1 ? -1 : viewIndex + 1);
                setViewIndex(nextIdx);
                const targetMove = nextIdx === -1 ? history[history.length - 1] : history[nextIdx];
                if (targetMove) {
                    playAudio(resolveMoveSound(targetMove.san));
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (viewIndex === -2) return;
                setViewIndex(-2);
                playAudio('move');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (viewIndex === -1) return;
                setViewIndex(-1);
                playAudio('move');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [playAudio]);

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
                    // Блиц — для отображения в карточке игрока до старта партии с ботом;
                    // для настоящих PvP-партий карточки обновляются авторитетным рейтингом
                    // с сервера (по категории именно этой партии) в applyMatchFoundSnapshot.
                    if (data.blitz_rating) setCurrentUserRating(data.blitz_rating);
                }
            })
            .catch(() => {
            });
    }, []);

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
                    applyIncrement(myColor, effectiveIncSeconds);
                }

                setPendingPromotion(null);
                setGame(nextGame);
                setHistory(newHistory);
                setViewIndex(-1);
                if (!gameId && !nextGame.isGameOver()) {
                    // В PvP звук хода играет applyMoveMadeSnapshot, когда сервер эхом
                    // присылает move_made (его получают оба игрока) — иначе свой ход звучит
                    // дважды: сразу здесь и повторно из эха. На завершающем ходу (мат/пат)
                    // играет только исход — звук самого хода был бы лишним дублем.
                    playAudio(resolveMoveSound(move.san));
                }
                moveStartTime.current = Date.now();
                if (!gameId && !isRatedBotGame && !nextGame.isGameOver()) {
                    coach.onPlayerMove(game, game.fen(), uciMove, nextGame.fen());
                }

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
                    setGameOverResult(result);
                    setDrawOfferStatus(status('status.botGameOver', {bot: botNameParam(activeBot), result}));
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
    }, [game, gameId, activeBot, spectatingGameId, myColor, stateVersion, viewIndex, gameOverResult, playAudio, playOutcomeSound, updateSessionStats, saveBotGameToDatabase, applyIncrement, effectiveIncSeconds, isRatedBotGame, coach.onPlayerMove]);

    const {premove, premoves, premoveView, setPremove, scheduleOrPromotePremove} = usePremoves({
        game,
        myColor,
        gameOverResult,
        viewIndex,
        isOpponentControlled: Boolean(gameId || activeBot),
        executeMove,
        playAudio,
        clearSelection: useCallback(() => {
            setSelectedSquare(null);
            setDragState(null);
            setPendingPromotion(null);
        }, []),
        openPromotionDialog: useCallback((p) => setPendingPromotion(p), []),
    });

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

    const handleLeaveSpectate = () => {
        if (spectatingGameId) {
            gameSocket.send('leave_spectate', {game_id: spectatingGameId});
        }
        setSpectatingGameId(null);
        handleResetSandbox();
    };

    const handleAbortGame = () => {
        if ((!gameId && !activeBot) || gameOverResult || history.length >= 2) return;
        setPendingPromotion(null);
        setPremove(null);
        if (gameId) {
            gameSocket.send('abort_game', {game_id: gameId});
        } else if (activeBot) {
            setGameOverResult('*');
            setDrawOfferStatus(status('status.botAborted'));
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
            // Реванш — с той же начальной позиции, что и сыгранная партия.
            startHistoricalBotGame(activeBot, nextColor, startFen);
        }
    };

    const handleResign = () => {
        if ((!gameId && !activeBot) || gameOverResult) return;
        if (window.confirm(t('controls.resignConfirm'))) {
            setPendingPromotion(null);
            setPremove(null);
            if (gameId) {
                gameSocket.send('resign', {game_id: gameId});
            } else if (activeBot) {
                const res = myColor === 'white' ? '0-1' : '1-0';
                setGameOverResult(res);
                setDrawOfferStatus(status('status.resigned', {bot: botNameParam(activeBot), result: res}));
                updateSessionStats(res);
                playOutcomeSound(res, myColor);
                saveBotGameToDatabase(activeBot, myColor, res, game, 'resignation');
            }
        }
    };

    const handleResetSandbox = () => {
        if (gameId && !gameOverResult) return;
        if (gameId && (rematchStatus === 'offered_by_me' || rematchStatus === 'offered_by_opponent')) {
            // Уходя с завершённой партии, снимаем висящее предложение реванша: иначе соперник мог
            // бы принять его позже и втянуть игрока в партию, которую тот уже не ждёт.
            gameSocket.send('decline_rematch', {game_id: gameId});
        }
        setRematchStatus('none');
        gameIdRef.current = null;
        setGameId(null);
        exitBotGame();
        resetLowTimeWarning();
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

    // «Переходить» по совету наставника: позиция до хода; добавление за отменённый ход снимается.
    const handleCoachTakeBack = () => {
        const previous = coach.takeBack();
        if (!previous) return;
        if (activeBot) applyIncrement(myColor, -effectiveIncSeconds);
        setGame(previous);
        setHistory(previous.history({verbose: true}));
        setViewIndex(-1);
        setSelectedSquare(null);
        setPendingPromotion(null);
        setPremove(null);
        moveStartTime.current = Date.now();
        playAudio('move');
    };

    // Итог партии с ботом: следующий соперник — по результату и силе (измеренной, если есть).
    const recommendedOpponent = (() => {
        if (!activeBot || !gameOverResult || isRatedBotGame) return null;
        const pool: PoolOpponent[] = [
            ...(Object.keys(HISTORICAL_BOTS) as HistoricalBotId[]).map((id) => ({
                kind: 'historical' as const, id, rating: measuredBotRatings[id] ?? HISTORICAL_BOTS[id].rating,
            })),
            ...(botCatalog?.archetypes ?? []).map((a) => ({kind: 'archetype' as const, id: a.id, rating: a.rating})),
        ];
        const profile = botProfileFor(activeBot);
        const currentId = activeBot === 'custom' ? (customArchetypeId() ?? 'custom') : activeBot;
        const current = pool.find((o) => o.id === currentId) ?? {id: currentId, rating: profile.rating};
        return recommendOpponent(pool, current, outcomeFor(gameOverResult, myColor));
    })();
    const recommendationLabel = recommendedOpponent
        ? {
            name: recommendedOpponent.kind === 'historical'
                ? HISTORICAL_BOTS[recommendedOpponent.id as HistoricalBotId].shortName
                : t(`archetypes.${recommendedOpponent.id as ArchetypeId}.name`),
            rating: recommendedOpponent.rating,
        }
        : null;
    const handlePlayRecommended = () => {
        if (!recommendedOpponent) return;
        if (recommendedOpponent.kind === 'historical') {
            startHistoricalBotGame(recommendedOpponent.id as HistoricalBotId, 'random', null);
            return;
        }
        const archetype = botCatalog?.archetypes.find((a) => a.id === recommendedOpponent.id);
        if (archetype) {
            startCustomBotGame(
                {name: t(`archetypes.${archetype.id}.name`), config: archetype.config, archetypeId: archetype.id},
                'random', null,
            );
        }
    };

    const handleCoachAdvice = () => {
        void coach.requestHint(game.fen());
    };
    // Вспомогательная доска: копия текущей позиции; при каждом открытии — заново с позиции партии.
    const [auxOpen, setAuxOpen] = useState(false);

    // Стрелки и объяснение относятся к позиции, в которой их запросили: любой ход их снимает.
    const coachClearOverlay = coach.clearOverlay;
    const currentFen = game.fen();
    useEffect(() => {
        coachClearOverlay();
    }, [currentFen, coachClearOverlay]);

    const handleUndoSandboxMove = () => {
        if (gameId || spectatingGameId || history.length === 0 || isBotThinking || !!gameOverResult) return;
        // Партия лестницы или турнира — без возврата ходов (сервер всё равно не засчитал бы такую партию).
        if (isRatedBotGame) return;
        const nextGame = cloneChessInstance(game);
        nextGame.undo();
        if (activeBot && nextGame.history().length > 0) {
            const turnAfterFirstUndo = nextGame.turn() === 'w' ? 'white' : 'black';
            if (turnAfterFirstUndo !== myColor) {
                nextGame.undo();
            }
        }
        coach.keepMove();
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
                    const pieceOnTarget = premoveView.get(squareId as never);
                    if (pieceOnTarget && pieceOnTarget.color === myColorChar) {
                        setSelectedSquare(squareId);
                    } else {
                        scheduleOrPromotePremove(selectedSquare, squareId);
                    }
                }
            } else {
                const piece = premoveView.get(squareId as never);
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

    // Начальная позиция партии на доске: null — обычная расстановка.
    const startFen = customStartFen(game);

    const currentGame = viewIndex === -1 ? game : (() => {
        const tg = startFen ? new Chess(startFen) : new Chess();
        const limit = viewIndex === -2 ? -1 : viewIndex;
        for (let i = 0; i <= limit; i++) {
            if (history[i]) tg.move(history[i]);
        }
        return tg;
    })();
    // Пока стоят предходы, доска показывает фигуры на их полях (цепочка предходов, таск B.2).
    const boardState = (viewIndex === -1 && premoves.length > 0 ? premoveView : currentGame).board();
    // Пометки игрока правой кнопкой (таск B.1); снимаются при смене позиции. Пока стоит предход или выбрана фигура,
    // правая кнопка их отменяет (onContextMenu ниже) и стрелку не рисует.
    const annotations = useBoardAnnotations(currentGame.fen(), !(premove || pendingPromotion || selectedSquare));
    const xrayAvailable = Boolean(spectatingGameId) || (!gameId && (!activeBot || (coach.enabled && !isRatedBotGame)));
    // «Своя» сторона: в партии с ботом — цвет игрока, на свободной доске и у зрителя — сторона, которая ходит.
    const xraySide: 'w' | 'b' = activeBot && !spectatingGameId ? (myColor === 'white' ? 'w' : 'b') : currentGame.turn();
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
    const topPlayerInfo = topIsWhite ? shownWhitePlayer : shownBlackPlayer;
    const bottomPlayerInfo = topIsWhite ? shownBlackPlayer : shownWhitePlayer;
    const topPlayerTime = topIsWhite ? whiteTimeMs : blackTimeMs;
    const bottomPlayerTime = topIsWhite ? blackTimeMs : whiteTimeMs;
    const topIdlePreviewMs = Math.round((topIsWhite ? effectiveWhiteBaseMinutes : effectiveBlackBaseMinutes) * 60 * 1000);
    const bottomIdlePreviewMs = Math.round((!topIsWhite ? effectiveWhiteBaseMinutes : effectiveBlackBaseMinutes) * 60 * 1000);
    // «Взятые фигуры» считаются от полного комплекта — для партии с произвольной позиции это
    // был бы почти весь комплект с первого хода. Показываем только перевес в материале.
    const showCaptured = startFen === null;
    const topCaptured = !showCaptured ? [] : topIsWhite ? material.whiteCapturedSymbols : material.blackCapturedSymbols;
    const bottomCaptured = !showCaptured ? [] : topIsWhite ? material.blackCapturedSymbols : material.whiteCapturedSymbols;
    const topAdvantage = topIsWhite ? material.whiteAdvantage : material.blackAdvantage;
    const bottomAdvantage = topIsWhite ? material.blackAdvantage : material.whiteAdvantage;

    const isBotOnTop = !!activeBotProfile && ((topIsWhite && myColor === 'black') || (!topIsWhite && myColor === 'white'));
    const isBotOnBottom = !!activeBotProfile && !isBotOnTop;

    const movePairs = pairHalfMoves(history, startFen);

    // Свободная доска с позицией, отличной от начальной и не финальной, — с неё можно играть с ботом.
    const isSandbox = !gameId && !activeBot && !spectatingGameId;
    const sandboxFen = game.fen();
    const canStartFromPosition = isSandbox && sandboxFen !== STANDARD_START_FEN && !game.isGameOver();

    const handleStartBotGame = (botId: HistoricalBotId, colorPref: 'white' | 'black' | 'random') => {
        startHistoricalBotGame(botId, colorPref, canStartFromPosition && startFromPosition ? sandboxFen : null);
    };

    const handleStartCustomGame = (opponent: CustomOpponent, colorPref: 'white' | 'black' | 'random') => {
        startCustomBotGame(opponent, colorPref, canStartFromPosition && startFromPosition ? sandboxFen : null);
    };

    // Партия лестницы — всегда с обычной расстановки и с соперником, которого выбрал сервер.
    const handleLadderStart = ({opponent, color, forfeited}: LadderStart) => {
        if (opponent.kind === 'historical' && opponent.bot_id) {
            startHistoricalBotGame(opponent.bot_id as HistoricalBotId, color, null, {ladder: true});
        } else if (opponent.config && isArchetypeId(opponent.id)) {
            // Соперник лестницы — архетип: имя и описание на языке игрока, в архив — ключом архетипа.
            startCustomBotGame(
                {name: t(`archetypes.${opponent.id}.name`), config: opponent.config, archetypeId: opponent.id},
                color, null, {ladder: true},
            );
        }
        if (forfeited) setDrawOfferStatus(status('ladder.forfeited', {message: ladderOutcomeMessage(forfeited)}));
    };

    // Партия турнира (таск 15.3): контроль времени зала выставляется турнирным, партия начинается, когда он применён —
    // так прибавки времени у игрока и бота совпадают с турнирными, а сервер примет сохранение.
    const routeLocation = useLocation();
    const tournamentStart = (routeLocation.state as { tournamentGame?: TournamentGameStart } | null)?.tournamentGame;
    const [pendingTournament, setPendingTournament] = useState<TournamentGameStart | null>(null);
    const [tournamentLinkId, setTournamentLinkId] = useState<number | null>(null);
    useEffect(() => {
        if (!tournamentStart || gameId || (activeBot && !gameOverResult)) return;
        const category = timeControlCategory(tournamentStart.baseTimeMs, tournamentStart.incrementMs);
        const manual = ALL_TIME_CONTROLS.find((o) => o.isManual && o.category === category);
        if (manual) setSelectedTimeControl(manual);
        setManualBaseMinutes(tournamentStart.baseTimeMs / 60000);
        setManualIncSeconds(tournamentStart.incrementMs / 1000);
        setPendingTournament(tournamentStart);
        navigate('.', {replace: true, state: null});
    }, [tournamentStart]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!pendingTournament) return;
        const applied = Math.round(effectiveWhiteBaseMinutes * 60000) === pendingTournament.baseTimeMs
            && Math.round(effectiveIncSeconds * 1000) === pendingTournament.incrementMs;
        if (!applied) return;
        const options = {tournamentGameId: pendingTournament.gameId};
        if (pendingTournament.custom) {
            startCustomBotGame(pendingTournament.custom, pendingTournament.color, null, options);
        } else if (pendingTournament.botId) {
            startHistoricalBotGame(pendingTournament.botId as HistoricalBotId, pendingTournament.color, null, options);
        }
        setTournamentLinkId(pendingTournament.tournamentId);
        setPendingTournament(null);
    }, [pendingTournament, effectiveWhiteBaseMinutes, effectiveIncSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

    // «Разобрать с наставником» со страницы задач (13.3): позиция задачи — на свободную доску, наставник включён.
    const location = useLocation();
    const analyzeFen = (location.state as { analyzeFen?: string } | null)?.analyzeFen;
    useEffect(() => {
        if (!analyzeFen || gameId || activeBot) return;
        if (handleLoadFen(analyzeFen) === null) coach.setEnabled(true);
        navigate('.', {replace: true, state: null});
    }, [analyzeFen]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleLoadFen = (fen: string): string | null => {
        const error = validateFen(fen);
        if (error) return error;
        setGame(new Chess(fen.trim()));
        setHistory([]);
        setViewIndex(-1);
        setSelectedSquare(null);
        setPendingPromotion(null);
        setPremove(null);
        setGameOverResult(null);
        setDrawOfferStatus(null);
        setStartFromPosition(true);
        playAudio('move');
        return null;
    };

    const handleSelectMoveFromList = (targetIdx: number) => {
        setSelectedSquare(null);
        const isAlreadyActive = viewIndex === -1
            ? targetIdx >= history.length - 1
            : targetIdx === viewIndex;
        if (isAlreadyActive) return;
        if (history[targetIdx]) {
            playAudio(resolveMoveSound(history[targetIdx].san));
        }
        if (targetIdx >= history.length - 1) {
            setViewIndex(-1);
        } else {
            setViewIndex(targetIdx);
        }
    };

    const handleNavigateFirst = () => {
        setViewIndex(-2);
        playAudio('move');
    };

    const handleNavigateBack = () => {
        if (history.length === 0) return;
        const current = viewIndex === -1 ? history.length - 1 : prevIndexHelper(viewIndex, history.length);
        const nextIdx = current <= 0 ? -2 : current - 1;
        setViewIndex(nextIdx);
        if (nextIdx >= 0 && history[nextIdx]) {
            playAudio(resolveMoveSound(history[nextIdx].san));
        } else {
            playAudio('move');
        }
    };

    const handleNavigateForward = () => {
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
    };

    const handleNavigateLast = () => {
        setViewIndex(-1);
        if (history.length > 0) {
            playAudio(resolveMoveSound(history[history.length - 1].san));
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
                <div className="text-2xl font-bold mb-2">{t('hall.authRequired')}</div>
                <p className="text-base text-boxwood/85 mb-2">
                    {t('hall.authRequiredText')}
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

            {/* ЛЕВАЯ КОЛОНКА: ИГРОВОЙ ЦЕНТР (ЧАСЫ, ИСТОРИЧЕСКИЕ БОТЫ, ЛОББИ И LIVE) */}
            <div
                className="w-full xl:w-[400px] 2xl:w-[440px] xl:h-full bg-acacia p-3 rounded-lg shadow-heavy border-2 border-acacia-dark flex flex-col gap-2 text-boxwood-light order-2 xl:order-1 shrink-0 xl:overflow-hidden">

                <GameHallHeader
                    sessionStats={sessionStats}
                    isSoundMuted={isSoundMuted}
                    onToggleSound={handleToggleSound}
                    onFlipBoard={() => setIsManualFlip(prev => !prev)}
                />

                <div
                    className="bg-acacia-dark p-2.5 rounded-md border border-amber-900/50 flex flex-col gap-2 shadow-inner shrink-0">
                    <TimeControlPicker
                        selectedTimeControl={selectedTimeControl}
                        manualBaseMinutes={manualBaseMinutes}
                        manualIncSeconds={manualIncSeconds}
                        onManualBaseMinutesChange={setManualBaseMinutes}
                        onManualIncSecondsChange={setManualIncSeconds}
                        isOpen={isTimeDropdownOpen}
                        onToggleOpen={() => setIsTimeDropdownOpen(!isTimeDropdownOpen)}
                        onSelect={(opt) => {
                            setSelectedTimeControl(opt);
                            if (opt.isManual) {
                                setManualBaseMinutes(Math.max(1, Math.round(opt.base)));
                                setManualIncSeconds(opt.inc);
                            }
                            setIsTimeDropdownOpen(false);
                        }}
                        disabled={isSearching || !!gameId || (!!activeBot && !gameOverResult)}
                        dropdownRef={timeDropdownRef}
                    />

                    <MatchmakingPanel
                        gameId={gameId}
                        gameOverResult={gameOverResult}
                        isRatedGame={isRatedGame}
                        ratedChoice={ratedChoice}
                        onRatedChoiceChange={setRatedChoice}
                        isSearching={isSearching}
                        onStartMatchmaking={startMatchmaking}
                        onCancelMatchmaking={cancelMatchmaking}
                        showInvitePanel={showInvitePanel}
                        onToggleInvitePanel={() => setShowInvitePanel(prev => !prev)}
                        inviteColorPref={inviteColorPref}
                        onInviteColorPrefChange={setInviteColorPref}
                        createdInviteCode={createdInviteCode}
                        inviteCopied={inviteCopied}
                        onCreatePrivateInvite={handleCreatePrivateInvite}
                        onCopyInviteLink={handleCopyInviteLink}
                    />
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
                        <Bot size={15}/> {t('hall.tabBots')}
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
                        <span>{t('hall.tabLobby')}</span>
                        <span className="text-xs font-mono px-1.5 py-0.2 rounded bg-black/40 text-amber-300">
                            {filteredQueue.length + liveGames.length}
                        </span>
                    </button>
                </div>

                {tournamentLinkId && (isTournamentGame || savedTournamentId) && (
                    <Link to={`/tournaments/${savedTournamentId ?? tournamentLinkId}`} data-testid="back-to-tournament"
                          className="shrink-0 text-center text-xs font-bold py-1.5 rounded-md bg-amber-800/70 border border-amber-500/60 text-amber-100 hover:bg-amber-700">
                        {t('tournaments.backToTournament')}
                    </Link>
                )}
                {leftSectionTab === 'bots' ? (
                    <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                    <div className="grid grid-cols-3 gap-1 text-xs font-bold" role="tablist">
                        {(['historical', 'workshop', 'ladder'] as const).map((view) => (
                            <button key={view} type="button" role="tab" aria-selected={botsView === view}
                                    onClick={() => setBotsView(view)}
                                    className={`py-1 rounded border cursor-pointer ${botsView === view
                                        ? 'bg-amber-800 text-white border-amber-400'
                                        : 'bg-black/35 text-boxwood/85 border-amber-900/40 hover:border-amber-600/50'}`}>
                                {t(view === 'historical' ? 'hall.viewHistorical' : view === 'workshop' ? 'hall.viewWorkshop' : 'hall.viewLadder')}
                            </button>
                        ))}
                    </div>
                    {botsView !== 'historical' ? (
                        <div className="flex-1 min-h-0 bg-acacia-dark p-2.5 rounded-md border border-amber-700/40 overflow-y-auto flex flex-col gap-2">
                            {activeBotProfile && (activeBot === 'custom' || isLadderGame) && (
                                <div className="p-2 rounded-md bg-black/55 border border-amber-600/40 text-xs text-amber-100">
                                    <div className="font-bold text-amber-400 mb-0.5 flex justify-between">
                                        <span>{t('bots.thought', {name: activeBotProfile.shortName})}</span>
                                        {isBotThinking && <span className="animate-pulse text-amber-300 font-mono text-[11px]">{t('bots.thinking')}</span>}
                                    </div>
                                    <div className="text-boxwood-light leading-snug">{botComment ? renderStatus(botComment, t) : activeBotProfile.motto}</div>
                                </div>
                            )}
                            {botsView === 'ladder' ? (
                                <LadderPanel
                                    playDisabled={(!!gameId || !!activeBot) && !gameOverResult}
                                    onStart={handleLadderStart}
                                    lastOutcome={ladderOutcome}
                                />
                            ) : (
                                <PersonalityWorkshop
                                    token={localStorage.getItem('token')}
                                    playDisabled={!!gameId && !gameOverResult}
                                    onPlay={(opponent: CustomOpponent, colorPref) => handleStartCustomGame(opponent, colorPref)}
                                    canStartFromPosition={canStartFromPosition}
                                    startFromPosition={startFromPosition}
                                    onStartFromPositionChange={setStartFromPosition}
                                />
                            )}
                        </div>
                    ) : (
                    <HistoricalBotsPanel
                        selectedBotId={selectedBotId}
                        onSelectBot={setSelectedBotId}
                        selectedBotProfile={selectedBotProfile}
                        activeBot={activeBot}
                        activeBotProfile={activeBotProfile}
                        gameId={gameId}
                        gameOverResult={gameOverResult}
                        isBotThinking={isBotThinking}
                        botComment={botComment ? renderStatus(botComment, t) : null}
                        onStartBotGame={handleStartBotGame}
                        canStartFromPosition={canStartFromPosition}
                        startFromPosition={startFromPosition}
                        onStartFromPositionChange={setStartFromPosition}
                        measured={measuredBotRatings}
                    />
                    )}
                    </div>
                ) : (
                    <LobbyPanel
                        lobbyTab={lobbyTab}
                        onLobbyTabChange={setLobbyTab}
                        queuePlayers={filteredQueue}
                        liveGames={liveGames}
                        isSearching={isSearching}
                        gameId={gameId}
                        gameOverResult={gameOverResult}
                        onAcceptChallenge={acceptChallenge}
                        onSpectateGame={handleSpectateGame}
                    />
                )}
            </div>

            {/* ЦЕНТРАЛЬНАЯ КОЛОНКА: ИГРОКИ И ШАХМАТНАЯ ДОСКА */}
            <div className="xl:h-full flex flex-col items-center justify-center gap-2 order-1 xl:order-2 shrink-0">

                <PlayerInfoBar
                    boardWidthPx={responsiveBoardPx}
                    isResizing={isResizing}
                    botProfile={isBotOnTop ? activeBotProfile : null}
                    isWhiteSide={topIsWhite}
                    idleLabel={t(topIsWhite ? 'board.idleWhite' : 'board.idleBlack')}
                    showGameInfo={Boolean(gameId || activeBot || spectatingGameId)}
                    playerInfo={topPlayerInfo}
                    hasRatingInfo={!!ratingInfo && isRatedGame}
                    ratingDelta={ratingInfo ? (topIsWhite ? ratingInfo.white_delta : ratingInfo.black_delta) : undefined}
                    capturedSymbols={topCaptured}
                    advantage={topAdvantage}
                    timeMs={topPlayerTime}
                    idlePreviewMs={topIdlePreviewMs}
                />

                {/* ШАХМАТНАЯ ДОСКА С ПОДДЕРЖКОЙ TOUCH / POINTER EVENTS */}
                <div
                    ref={boardContainerRef}
                    onPointerDown={annotations.handlers.onPointerDown}
                    onPointerUp={annotations.handlers.onPointerUp}
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
                            style={{backgroundImage: "url('/assets/textures/wood-grain.svg')"}}
                        />
                    )}

                    {pendingPromotion && (
                        <PromotionDialog
                            pendingPromotion={pendingPromotion}
                            displayedFiles={displayedFiles}
                            displayedRanks={displayedRanks}
                            renderPieceSvg={renderPieceSvg}
                            onSelect={handlePromotionSelect}
                            onCancel={() => setPendingPromotion(null)}
                        />
                    )}

                    <div
                        className="grid grid-cols-8 grid-rows-8 w-full h-full border border-black/60 relative z-10 shadow-inner-board rounded-[2px] overflow-hidden">
                        {xrayAvailable && xray.modes.size > 0 && (
                            <XrayOverlay fen={currentGame.fen()} flipped={isBoardFlipped} modes={xray.modes}
                                         selectedSquare={selectedSquare}
                                         side={xray.forOpponent ? (xraySide === 'w' ? 'b' : 'w') : xraySide}/>
                        )}
                        {viewIndex === -1 && (
                            <CoachArrowsOverlay arrows={coachArrows(coach.explanation ?? coach.advice)}
                                                highlights={[...coachHighlights(coach.explanation ?? coach.advice)]}
                                                flipped={isBoardFlipped} idPrefix="play-coach"/>
                        )}
                        <AnnotationsOverlay arrows={annotations.arrows} squares={annotations.squares}
                                            flipped={isBoardFlipped} idPrefix="play-notes"/>
                        {displayedRanks.map((rank) =>
                            displayedFiles.map((file) => {
                                const rIdx = RANKS.indexOf(rank);
                                const fIdx = FILES.indexOf(file);
                                const isDark = (rIdx + fIdx) % 2 !== 0;
                                const squareId = `${file}${rank}`;

                                const piece = boardState[rIdx][fIdx];

                                const isSelected = selectedSquare === squareId;
                                const isLastMove = lastMove && (lastMove.from === squareId || lastMove.to === squareId);
                                const isPremoveSquare = premoves.some((p) => p.from === squareId || p.to === squareId);
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
                                                style={{backgroundImage: "url('/assets/textures/wood-grain.svg')"}}
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
                                                    // Зритель фигуры не двигает (и не ставит «премувы» на чужой доске).
                                                    if (spectatingGameId) return;
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
                                                    viewIndex === -1 && !gameOverResult && !spectatingGameId && (
                                                        (gameId || activeBot)
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
                        title={t('hall.resizeHint')}
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

                <PlayerInfoBar
                    boardWidthPx={responsiveBoardPx}
                    isResizing={isResizing}
                    botProfile={isBotOnBottom ? activeBotProfile : null}
                    isWhiteSide={!topIsWhite}
                    idleLabel={t(!topIsWhite ? 'board.youWhite' : 'board.youBlack')}
                    showGameInfo={Boolean(gameId || activeBot || spectatingGameId)}
                    playerInfo={bottomPlayerInfo}
                    hasRatingInfo={!!ratingInfo && isRatedGame}
                    ratingDelta={ratingInfo ? (!topIsWhite ? ratingInfo.white_delta : ratingInfo.black_delta) : undefined}
                    capturedSymbols={bottomCaptured}
                    advantage={bottomAdvantage}
                    timeMs={bottomPlayerTime}
                    idlePreviewMs={bottomIdlePreviewMs}
                />

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
                            <ListOrdered className="text-amber-400" size={15}/> {t('board.moveLog')}
                        </div>
                        <div className="text-xs sm:text-sm font-bold text-amber-200 mt-0.5 truncate">
                            {(gameId || activeBot || spectatingGameId)
                                ? t('board.versus', {white: shownWhitePlayer.username, black: shownBlackPlayer.username})
                                : t('board.freeBoard')}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        <AppearancePickerDropdown
                            isOpen={showAppearanceDropdown}
                            onToggleOpen={() => setShowAppearanceDropdown(prev => !prev)}
                            onClose={() => setShowAppearanceDropdown(false)}
                            activeTheme={activeTheme}
                            pieceSetKey={pieceSetKey}
                            activePieceSetName={activePieceSet.name}
                            activePieceSetShortName={activePieceSet.shortName}
                            onPieceSetChange={handlePieceSetChange}
                            onThemeChange={handleThemeChange}
                            boardSize={boardSize}
                            responsiveBoardPx={responsiveBoardPx}
                            onBoardSizeChange={handleBoardSizeChange}
                        />

                        <span
                            className="px-2 py-1 rounded-md bg-acacia-dark border border-amber-700/40 font-mono text-xs text-amber-400 font-bold">
                            {gameOverResult || (history.length > 0 ? t('board.movesShort', {count: Math.ceil(history.length / 2)}) : t('board.start'))}
                        </span>
                    </div>
                </div>

                {premove && (
                    <div
                        className="bg-rose-950/90 px-3 py-1.5 rounded-md border border-rose-500/60 text-xs text-rose-100 flex items-center justify-between shadow shrink-0">
                        <span className="flex items-center gap-1.5 font-bold font-mono">
                            <Zap size={14} className="text-rose-400"/>
                            <span data-testid="premove-queue">
                                {premoves.map((p) => t('controls.premove', {
                                    from: p.from,
                                    to: p.to,
                                    promotion: p.promotion
                                        ? t('controls.premovePromotion', {piece: p.promotion.toUpperCase()})
                                        : '',
                                })).join(' · ')}
                            </span>
                        </span>
                        <button
                            type="button"
                            onClick={() => setPremove(null)}
                            className="px-2 py-0.5 bg-black/40 hover:bg-black/70 rounded text-xs font-sans text-rose-200 transition cursor-pointer"
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                )}

                {drawOfferStatus && (
                    <div
                        className="bg-amber-950/90 p-2 rounded-md border border-amber-600/50 text-xs text-amber-200 text-center flex flex-col gap-1.5 shrink-0">
                        <span>{renderStatus(drawOfferStatus, t)}</span>
                        {hasStatusKey(drawOfferStatus, 'status.drawOffered') && (
                            <div className="flex justify-center gap-2">
                                <button
                                    onClick={acceptDraw}
                                    className="px-3 py-1 bg-emerald-800 hover:bg-emerald-700 text-white rounded text-xs font-bold cursor-pointer"
                                >
                                    {t('common.accept')}
                                </button>
                                <button
                                    onClick={declineDraw}
                                    className="px-3 py-1 bg-red-800 hover:bg-red-700 text-white rounded text-xs font-bold cursor-pointer"
                                >
                                    {t('common.decline')}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <MoveList
                    movePairs={movePairs}
                    activeMoveIndex={activeMoveIndex}
                    viewIndex={viewIndex}
                    historyLength={history.length}
                    hasActiveSession={Boolean(gameId || activeBot || spectatingGameId)}
                    scrollRef={notationScrollRef}
                    onSelectMove={handleSelectMoveFromList}
                    onReturnToLive={() => setViewIndex(-1)}
                />

                <BoardNavigationControls
                    historyLength={history.length}
                    viewIndex={viewIndex}
                    onFirst={handleNavigateFirst}
                    onBack={handleNavigateBack}
                    onForward={handleNavigateForward}
                    onLast={handleNavigateLast}
                />

                {(gameId || spectatingGameId) && (
                    <GameChatPanel
                        messages={chatMessages}
                        chatInput={chatInput}
                        onChatInputChange={setChatInput}
                        onSendMessage={handleSendChatMessage}
                        onSendPreset={handleSendChatPreset}
                        isSpectator={!!spectatingGameId}
                        onLeaveSpectate={handleLeaveSpectate}
                    />
                )}

                {activeBot && gameOverResult && savedBotGameId && (
                    <GameSummaryPanel
                        gameId={savedBotGameId}
                        playerColor={myColor}
                        recommendation={recommendationLabel}
                        onPlayRecommended={handlePlayRecommended}
                    />
                )}

                {!gameId && !spectatingGameId && (
                    <CoachPanel
                        coach={coach}
                        locked={isRatedBotGame && !gameOverResult}
                        inBotGame={Boolean(activeBot) && !gameOverResult}
                        canAdvise={viewIndex === -1 && !gameOverResult && !game.isGameOver() && !coach.pending && (!activeBot || game.turn() === myColor[0])}
                        onAdvice={handleCoachAdvice}
                        onTakeBack={handleCoachTakeBack}
                        auxOpen={auxOpen}
                        onToggleAux={() => setAuxOpen((open) => !open)}
                    >
                        <AuxBoard key={auxOpen ? 'aux-open' : 'aux-closed'} fen={game.fen()} flipped={isBoardFlipped}
                                  lightColor={activeTheme.light} darkColor={activeTheme.dark}
                                  renderPiece={renderPieceSvg} onClose={() => setAuxOpen(false)}/>
                    </CoachPanel>
                )}

                {xrayAvailable && <XrayPanel settings={xray} canSelect={!spectatingGameId}/>}

                {/* Зрителю кнопки песочницы не показываем: «отменить ход» и «сбросить доску»
                    портили бы чужую партию на его экране. Выход — в панели чата. */}
                {!spectatingGameId && <GameControlsPanel
                    mode={gameId ? 'pvp' : activeBot ? 'bot' : 'sandbox'}
                    gameId={gameId}
                    savedBotGameId={savedBotGameId}
                    historyLength={history.length}
                    gameOverResult={gameOverResult}
                    rematchStatus={rematchStatus}
                    isBotThinking={isBotThinking}
                    whitePlayer={shownWhitePlayer}
                    blackPlayer={shownBlackPlayer}
                    navigate={navigate}
                    onAbortGame={handleAbortGame}
                    onResign={handleResign}
                    onOfferDraw={handleOfferDraw}
                    onAcceptRematch={handleAcceptRematch}
                    onDeclineRematch={handleDeclineRematch}
                    onOfferRematch={handleOfferRematch}
                    onResetSandbox={handleResetSandbox}
                    onUndoSandboxMove={handleUndoSandboxMove}
                    undoLocked={isRatedBotGame && !gameOverResult}
                    hasCustomPosition={isSandbox && startFen !== null}
                    onLoadFen={handleLoadFen}
                />}

            </div>

        </div>
    );
}

