// --- FILE: frontend/src/components/Chessboard.tsx ---
// Главная доска (маршруты «/» и «/challenge/{код}» — вход по ссылке-приглашению): партия с человеком, партия с
// ботом и свободный анализ — на одной доске. Здесь состояние позиции и разметка; логика вынесена в хуки
// chessboard/hooks/: useGameSocket (события партии с человеком и лобби), useBotGame (партия с ботом), useClock
// (часы), usePremoves (предходы), useCoachMode (игра с наставником).
// В партии с человеком источник правды — сервер: клиент показывает свой ход сразу, но позицию, часы и итог берёт из
// ответа (move_made, game_over); отклонённый ход возвращается на место. Панели вокруг доски — компоненты папки
// chessboard/.
//
// Режим доски определяется тремя значениями: gameId (своя партия с человеком), activeBot (партия с ботом),
// spectatingGameId (просмотр чужой партии); все три пусты — свободная доска. Гостю вместо доски показывается
// заглушка с просьбой войти. Данные игрока — GET /profile/me, каталог ботов — GET /bots/catalog. Оформление и
// размер доски запоминаются в localStorage (regence_board_theme, regence_piece_set, regence_board_size), настройки
// доски — config/boardPrefs.ts. Другие страницы запускают здесь действие через state маршрута: tournamentGame
// (партия турнира), guestGame (мастер прошлого), firstGame (первая партия после регистрации), analyzeFen (позиция
// на разбор с наставником), spectate (просмотр партии), challenge (вызов игрока из профиля).

import type {OddsChoice} from './chessboard/odds';
import {useState, useEffect, useRef, useCallback} from 'react';
import {socialApi} from '../services/social';
import {useLocation, useNavigate, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {ListOrdered, Zap, MessageSquare, GraduationCap, ScanEye, Swords} from 'lucide-react';
import {Button, SegmentedControl} from './ui';
import {NewGameDialog} from './chessboard/NewGameDialog';
import {gameSocket} from '../services/gameSocket';
import {soundEngine, resolveMoveSound} from '../services/soundEngine';
import type {SoundEventType} from '../services/soundEngine';
import {
    BOARD_THEMES,
    lastMoveColor,
    PIECE_SETS,
    getSavedBoardThemeKey,
    getSavedPieceSetKey,
    getPieceSvgUrl,
    getHarmoniousPieceStyle
} from '../config/boardAppearance';
import {BoardTextureLayer} from './chessboard/BoardTextureLayer';
import type {BoardTheme} from '../config/boardAppearance';
import {HISTORICAL_BOTS} from '../config/champions';
import type {BotOpponentId, HistoricalBotId, HistoricalBotProfile} from '../config/champions';
import {ALL_TIME_CONTROLS, DEFAULT_TIME_CONTROL, TIME_CONTROLS, timeControlCategory} from '../config/timeControls';
import type {TournamentGameStart} from '../services/tournaments';
import {ContinueTournaments, TournamentGameBar} from './tournaments/TournamentGameBar';
import {pickFirstOpponent} from '../services/onboarding';
import type {FirstGameStart} from '../services/onboarding';
import type {MasterGameStart} from '../services/masters';
import type {TimeControlOption, TimeControlGroup} from '../config/timeControls';
import {
    FILES, RANKS, MIN_BOARD_SIZE, MAX_BOARD_SIZE,
    getMaxViewportBoardSize, getDefaultBoardSize, fittedBoardSize, calculateMaterialBalance, cloneChessInstance, prevIndexHelper,
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
import type {BotCatalog, BotRival} from '../services/botCatalog';
import {useGameSocket} from './chessboard/hooks/useGameSocket';
import {PromotionDialog} from './chessboard/PromotionDialog';
import {MoveList} from './chessboard/MoveList';
import {scrollMoveIntoList} from './chessboard/scrollMove';
import {BoardNavigationControls} from './chessboard/BoardNavigationControls';
import {GameChatPanel} from './chessboard/GameChatPanel';
import {PlayerInfoBar} from './chessboard/PlayerInfoBar';
import {GameControlsPanel} from './chessboard/GameControlsPanel';
import {GameHallHeader} from './chessboard/GameHallHeader';
import {TimeControlPicker} from './chessboard/TimeControlPicker';
import {MatchmakingPanel, PvpGameStatus} from './chessboard/MatchmakingPanel';
import {HistoricalBotsPanel} from './chessboard/HistoricalBotsPanel';
import {PersonalityWorkshop} from './chessboard/PersonalityWorkshop';
import {LadderPanel} from './chessboard/LadderPanel';
import type {LadderStart} from '../services/ladder';
import {ladderOutcomeMessage} from './chessboard/hooks/useBotGame';
import {hasStatusKey, renderStatus, status} from './chessboard/status';
import type {GameStatus} from './chessboard/status';
import {useI18n} from '../i18n';
import {fetchBotCatalog, fetchRivalry} from '../services/botCatalog';
import {isArchetypeId} from '../config/archetypes';
import type {ArchetypeId} from '../config/archetypes';
import type {CustomOpponent} from '../config/archetypes';
import {LobbyPanel} from './chessboard/LobbyPanel';
import {AppearancePickerDropdown} from './chessboard/AppearancePickerDropdown';
import {getToken} from '../services/authToken';
import {accountApi} from '../services/account';
import {profileApi} from '../services/profile';
import {orderCaptured, quickMoveFrom, useBoardPrefs} from '../config/boardPrefs';
import {LastMoveArrow} from './chessboard/LastMoveArrow';
import {BlindfoldPanel} from './chessboard/BlindfoldPanel';
import {parseMoveInput, startBlindfold, useBlindfold, visibleSquares} from '../config/blindfold';
import {squareLabel} from '../services/a11y/speech';
import {useBoardKeyboard} from './chessboard/hooks/useBoardKeyboard';
import type {Translate} from '../services/a11y/speech';
import {BoardSpeech} from './chessboard/BoardSpeech';
import {squareCenter} from './chessboard/CoachArrowsOverlay';

// Реэкспорт для модулей, которые исторически импортируют эти имена из Chessboard (GameViewer, тесты).
export {MIN_BOARD_SIZE, MAX_BOARD_SIZE, getMaxViewportBoardSize, getDefaultBoardSize, TIME_CONTROLS};
export type {PromotionPiece, TimeControlOption, TimeControlGroup};

export {BOARD_THEMES, HISTORICAL_BOTS};
export type {BoardTheme, HistoricalBotId, HistoricalBotProfile};

/** Вкладка правой колонки игрового зала. */
type SideTab = 'moves' | 'chat' | 'coach' | 'xray';

/** Сохранённая игроком сторона доски; недоступное хранилище (приватный режим) — как «не сохранено». */
function savedBoardSize(): string | null {
    try {
        return localStorage.getItem('regence_board_size');
    } catch {
        return null;
    }
}

/**
 * Главная доска со всеми панелями вокруг неё. Владеет состоянием партии (позиция, история, чей цвет, итог) и
 * раздаёт его хукам: useGameSocket и useBotGame меняют одно и то же состояние, поэтому оно живёт здесь.
 */
export default function Chessboard() {
    const {t} = useI18n();
    const navigate = useNavigate();
    // Код приглашения из адреса /challenge/{код}; принимает приглашение useGameSocket.
    const {inviteCode} = useParams<{ inviteCode?: string }>();

    const [lobbyTab, setLobbyTab] = useState<'lobby' | 'live'>('lobby');
    const [showInvitePanel, setShowInvitePanel] = useState(false);
    const [showAppearanceDropdown, setShowAppearanceDropdown] = useState(false);
    const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => soundEngine.isMuted());
    const appearanceDropdownRef = useRef<HTMLDivElement>(null);

    const [spectatingGameId, setSpectatingGameId] = useState<number | null>(null);
    const [inviteColorPref, setInviteColorPref] = useState<'white' | 'black' | 'random'>('random');
    const [inviteOdds, setInviteOdds] = useState<OddsChoice>({kind: 'none', giver: 'me'});
    const [inviteVariant, setInviteVariant] = useState<'standard' | 'chess960'>('standard');
    // Тип новых партий (вызов в лобби и приглашение по ссылке) и тип партии, идущей на доске.
    const [ratedChoice, setRatedChoice] = useState<boolean>(true);
    const [isRatedGame, setIsRatedGame] = useState<boolean>(true);
    // Партию с ботом можно начать с позиции, стоящей на свободной доске.
    const [startFromPosition, setStartFromPosition] = useState<boolean>(false);

    // Живая позиция партии (chess.js) и её ходы в подробном виде (history({verbose: true})) — меняются вместе.
    const [game, setGame] = useState(new Chess());
    const [history, setHistory] = useState<any[]>([]);
    // Клетка доски с фокусом клавиатуры (таск 26.3) и сами клетки — чтобы переводить фокус стрелками.
    // Какая позиция на экране: -1 — живая, -2 — начало партии до первого хода, иначе — индекс полухода в history,
    // после которого показана позиция. Ходить можно только на живой позиции.
    const [viewIndex, setViewIndex] = useState<number>(-1);
    const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
    // Доска повёрнута кнопкой «Перевернуть» относительно обычного вида (свой цвет снизу).
    const [isManualFlip, setIsManualFlip] = useState<boolean>(false);

    const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

    const [boardThemeKey, setBoardThemeKey] = useState<string>(() => getSavedBoardThemeKey());
    const [pieceSetKey, setPieceSetKey] = useState<string>(() => getSavedPieceSetKey());

    // id своей партии с человеком (приходит в match_found); остаётся и после её окончания, пока игрок не уйдёт
    // в лобби. Ref-копии (gameIdRef, myColorRef и другие ниже) читают обработчики WebSocket и таймеры: им нужно
    // текущее значение, а не то, что было при подписке.
    const [gameId, setGameId] = useState<number | null>(null);
    const gameIdRef = useRef<number | null>(null);
    const [myColor, setMyColor] = useState<'white' | 'black'>('white');
    const myColorRef = useRef<'white' | 'black'>('white');
    const [isSearching, setIsSearching] = useState(false);
    // Игрок: id, имя и рейтинг блица из GET /profile/me (эффект ниже).
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [currentUsername, setCurrentUsername] = useState<string>('');
    const currentUsernameRef = useRef<string>('');
    const [currentUserRating, setCurrentUserRating] = useState<number>(1200);
    // Версия состояния партии на сервере: приходит с каждым снимком и уходит обратно с ходом (make_move), чтобы
    // сервер не принял ход, сделанный по устаревшей позиции.
    const [stateVersion, setStateVersion] = useState(0);
    const stateVersionRef = useRef<number>(0);

    // activeBot живёт здесь (не внутри useBotGame), потому что useClock использует его
    // для isTicking/isParticipant и должен вызываться раньше useBotGame.
    const [activeBot, setActiveBot] = useState<BotOpponentId | null>(null);
    // Вкладка ботов: исторические мастера, мастерская соперников или клубная лестница.
    const [botsView, setBotsView] = useState<'historical' | 'workshop' | 'ladder'>('historical');
    // Измеренная сила исторических ботов (калибровка матчами), если она есть.
    const [measuredBotRatings, setMeasuredBotRatings] = useState<Record<string, number>>({});
    // Сила по партиям с людьми (таск 32.1).
    const [liveBotStrength, setLiveBotStrength] = useState<Record<string, { rating: number; games: number }>>({});
    // Какие боты помнят игрока (таск 32.2); обновляется после каждой партии.
    const [botRivals, setBotRivals] = useState<Record<string, BotRival>>({});
    // Каталог целиком — для рекомендации следующего соперника в итоге партии (таск 11.5).
    const [botCatalog, setBotCatalog] = useState<BotCatalog | null>(null);
    // Каталог ботов (GET /bots/catalog) читается один раз при открытии доски; при сбое остаются заявленные рейтинги.
    useEffect(() => {
        fetchBotCatalog()
            .then((catalog) => {
                setBotCatalog(catalog);
                setMeasuredBotRatings(Object.fromEntries(
                    catalog.historical.filter((h) => h.measured).map((h) => [h.id, h.rating]),
                ));
                setLiveBotStrength(Object.fromEntries(catalog.historical.flatMap((h) => (h.live && h.live.games > 0
                    ? [[h.id, {rating: h.live.rating, games: h.live.games}]] : []))));
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

    // Момент, с которого считается время обдумывания своего хода: оно уходит на сервер с ходом (time_taken_ms)
    // и нужно для квоты лага и античита. Часы партии ведёт сервер, а не это значение.
    const moveStartTime = useRef<number>(Date.now());

    // Настройки доски (таск 18.4, config/boardPrefs.ts, localStorage regence_board_prefs): показ последнего хода,
    // способ ввода хода, «быстрый ход», анимация хода соперника, порядок взятых фигур.
    const boardPrefs = useBoardPrefs();
    // Игра вслепую (таск 19.5): ступень текущей партии, подсмотры.
    const blind = useBlindfold();
    // Режим «вслепую» уже включён для идущей партии (включается один раз, в её начале).
    const blindStartedRef = useRef(false);
    // Партия, для которой отметка «вслепую» уже отправлена в архив, — чтобы не отправить дважды.
    const blindMarkedRef = useRef<number | null>(null);
    // Анимация хода соперника: фигура уже стоит на новом поле и «съезжает» на него со старого (go включает
    // переход). animatedHistoryLength — длина истории, для которой анимация уже показана.
    const [moveAnim, setMoveAnim] = useState<{ from: string; to: string; go: boolean } | null>(null);
    const animatedHistoryLength = useRef(0);
    // Фигура, которую сейчас тащат указателем, и координаты указателя (её «призрак» рисуется поверх страницы).
    const [dragState, setDragState] = useState<{
        from: string;
        piece: { type: string; color: string };
        x: number;
        y: number;
    } | null>(null);

    // Сторона доски в пикселях: сохранённая игроком (localStorage regence_board_size), но не больше, чем
    // помещается в окно; при изменении окна доска и сжимается, и растёт обратно (fittedBoardSize, эффект ниже).
    const [boardSize, setBoardSize] = useState<number>(() => fittedBoardSize(savedBoardSize()));
    const [isResizing, setIsResizing] = useState(false);
    const resizeStartRef = useRef<{ startX: number; startY: number; startSize: number } | null>(null);

    useEffect(() => {
        const handleWindowResize = () => setBoardSize(fittedBoardSize(savedBoardSize()));
        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, []);

    // Счёт сессии: победы, поражения и ничьи с момента открытия страницы; нигде не сохраняется.
    const [sessionStats, setSessionStats] = useState({wins: 0, losses: 0, draws: 0});
    // Итог партии на доске: '1-0', '0-1', '1/2-1/2', '*' (отменена); null — партия идёт или её нет.
    const [gameOverResult, setGameOverResult] = useState<string | null>(null);
    const gameOverResultRef = useRef<string | null>(null);
    useEffect(() => {
        gameOverResultRef.current = gameOverResult;
    }, [gameOverResult]);
    // Строка статуса над списком ходов. Имя историческое: кроме предложения ничьей, здесь показываются и начало
    // партии, и её итог, и ответы бота, и отказы сервера (см. chessboard/status.ts).
    const [drawOfferStatus, setDrawOfferStatus] = useState<GameStatus | null>(null);
    const [rematchStatus, setRematchStatus] = useState<'none' | 'offered_by_me' | 'offered_by_opponent' | 'declined'>('none');

    const activeTheme = BOARD_THEMES[boardThemeKey] || BOARD_THEMES.walnut;
    const activePieceSet = PIECE_SETS[pieceSetKey] || PIECE_SETS.merida;

    // Выбранный контроль времени: минуты и добавка. У сторон он одинаков; разное стартовое время даёт только
    // фора по времени (её считает useBotGame или сервер).
    const effectiveWhiteBaseMinutes = selectedTimeControl.isManual ? manualBaseMinutes : selectedTimeControl.base;
    const effectiveBlackBaseMinutes = effectiveWhiteBaseMinutes;
    const effectiveIncSeconds = selectedTimeControl.isManual ? manualIncSeconds : selectedTimeControl.inc;

    const isBoardFlipped = (myColor === 'black') !== isManualFlip;

    const playAudio = useCallback((type: SoundEventType) => {
        soundEngine.play(type);
    }, []);

    // Игра с наставником (таск 11.3): проверка ходов игрока и советы — в партии с ботом и на свободной доске.
    const coach = useCoachMode(currentUserRating);
    // Рентген доски (таск 12.1): свободная доска, партия с ботом при включённом наставнике (кроме лестницы и
    // турнира), зритель. Игроку идущей партии с человеком — нет (правило 2).
    const xray = useXraySettings();
    // Свежее значение «партия учебная» для сохранения партии: useBotGame читает его в момент сохранения.
    const coachAssistedRef = useRef(false);
    coachAssistedRef.current = coach.assisted;
    const isCoachAssisted = useCallback(() => coachAssistedRef.current, []);

    // Фора (таск 21.1): выбор перед партией с ботом и фора идущей партии (для реванша и «песочных часов»).
    const [oddsChoice, setOddsChoice] = useState<OddsChoice>({kind: 'none', giver: 'opponent'});
    const [activeOdds, setActiveOdds] = useState<OddsChoice | null>(null);
    const [hourglass, setHourglass] = useState(false);

    // Часы на экране идут в своей партии, в партии с ботом и у зрителя, пока партия не окончена. Наставник их не
    // останавливает (решение владельца 18.11): его совет появляется рядом с доской, партия идёт дальше.
    const {
        whiteTimeMs, setWhiteTimeMs, blackTimeMs, setBlackTimeMs, resetLowTimeWarning, applyIncrement,
    } = useClock({
        isTicking: Boolean(gameId || activeBot || spectatingGameId) && !gameOverResult,
        isParticipant: Boolean(gameId || activeBot) && !gameOverResult,
        currentTurn: game.turn() === 'w' ? 'white' : 'black',
        myColor,
        onLowTime: () => playAudio('low_time'),
        // «Песочные часы»: в партии с ботом флаг ставит useBotGame, в партии с человеком и у зрителя — useGameSocket.
        hourglass,
    });

    // Звук итога для участника: победа или поражение — по своему цвету; у ничьей и у отменённой партии — свои звуки.
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
        isLadderGame, ladderOutcome, customArchetypeId, isTournamentGame, savedTournamentId, offerDrawToBot,
    } = useBotGame({
        game, myColor, gameOverResult, whiteTimeMs, blackTimeMs, isSearching, setIsSearching,
        activeBot, setActiveBot,
        effectiveWhiteBaseMinutes, effectiveBlackBaseMinutes, effectiveIncSeconds, setHourglass,
        currentUsername, currentUserRating,
        setGame, setHistory, setViewIndex, setSelectedSquare, setMyColor, setIsManualFlip, setPendingPromotion,
        clearPremove, setGameOverResult, setRatingInfo, setDrawOfferStatus, setRematchStatus,
        setWhiteTimeMs, setBlackTimeMs, resetLowTimeWarning, applyIncrement,
        moveStartTime, myColorRef, gameIdRef, setGameId, setWhitePlayer, setBlackPlayer,
        playAudio, playOutcomeSound, updateSessionStats,
        isAssisted: isCoachAssisted, onNewGame: coach.reset,
    });

    const selectedBotProfile = HISTORICAL_BOTS[selectedBotId];
    // Память ботов об игроке (GET /bots/rivalry): при открытии доски и после каждой сохранённой партии с ботом.
    useEffect(() => {
        const token = getToken();
        if (!token) return;
        fetchRivalry(token).then((list) => setBotRivals(Object.fromEntries(list.map((r) => [r.bot_id, r]))))
            .catch(() => undefined);
    }, [savedBotGameId]);
    // Партия «на счёт» — лестница или турнир (таск A.2): без наставника, рентгена и возврата хода — сервер такую
    // помощь всё равно засчитал бы поражением или не засчитал бы партию.
    const isRatedBotGame = isLadderGame || isTournamentGame;
    const activeBotProfile = activeBot ? botProfileFor(activeBot) : null;

    const {
        chatMessages, chatInput, setChatInput, liveGames, queuePlayers, createdInviteCode, inviteCopied,
        startMatchmaking, cancelMatchmaking, acceptChallenge,
        handleCreatePrivateInvite, handleCopyInviteLink, handleSpectateGame, handleSendChatMessage, handleSendChatPreset,
        handleAcceptRematch, handleDeclineRematch, handleOfferDraw, acceptDraw, declineDraw,
        berserk, handleBerserk,
    } = useGameSocket({
        gameId, gameIdRef, myColorRef, spectatingGameId, stateVersionRef,
        gameOverResult, gameOverResultRef, activeBot, currentUsernameRef, inviteCode, navigate,
        effectiveWhiteBaseMinutes, effectiveIncSeconds,
        inviteColorPref, inviteOdds, inviteVariant, ratedChoice, setIsRatedGame, setHourglass,
        setGame, setHistory, setViewIndex, setGameId, setMyColor, setSpectatingGameId, setActiveBot,
        setStateVersion, setWhitePlayer, setBlackPlayer, setRatingInfo, setGameOverResult,
        setDrawOfferStatus, setRematchStatus, isSearching, setIsSearching, setIsManualFlip, setSelectedSquare,
        setPendingPromotion, clearPremove, setWhiteTimeMs, setBlackTimeMs,
        setLobbyTab, setIsTimeDropdownOpen, setShowInvitePanel, moveStartTime, resetLowTimeWarning,
        exitBotGame, playAudio, playOutcomeSound, updateSessionStats,
    });

    // Выбор оформления и размера доски сохраняется в localStorage этого браузера (на сервер не уходит).
    const handleThemeChange = (themeId: string) => {
        setBoardThemeKey(themeId);
        localStorage.setItem('regence_board_theme', themeId);
    };

    const handlePieceSetChange = (setId: string) => {
        setPieceSetKey(setId);
        localStorage.setItem('regence_piece_set', setId);
    };

    const handleBoardSizeChange = (size: number) => {
        setBoardSize(size);
        localStorage.setItem('regence_board_size', String(size));
    };

    // Растягивание доски за уголок: пока тянут, движение ловится на window, размер меняется на среднее смещения
    // по двум осям и сразу сохраняется; курсор и запрет выделения текста возвращаются по окончании.
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
            localStorage.setItem('regence_board_size', String(nextSize));
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
        localStorage.setItem('regence_board_size', String(defaultSize));
    };

    // Обработчик клавиш висит на window: историю и текущий ход читает через ref, обновляемый на каждом
    // рендере. Из замыкания эффекта (он перерегистрируется только после отрисовки) нажатие сразу после
    // хода видело прежнюю позицию — та же гонка, что была в GameViewer.
    const navigationRef = useRef({history, viewIndex});
    navigationRef.current = {history, viewIndex};

    // Клавиши: Esc снимает выбор, предходы, окно превращения и выпадающее оформление; стрелки влево и вправо
    // листают партию по ходу, вверх — в начало, вниз — к живой позиции. В полях ввода стрелки не перехватываются.
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
            // Фокус на клетке доски: стрелки двигают фокус по клеткам (onSquareKey), а не листают ходы.
            if (e.target instanceof HTMLElement && e.target.dataset.square) return;

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

    // Список ходов следует за показываемым ходом: активный ход — в середину окна списка, а если его нет
    // (скрыт или ходов ещё нет) на живой позиции — прокрутка в конец.
    useEffect(() => {
        if (notationScrollRef.current) {
            const activeEl = notationScrollRef.current.querySelector<HTMLElement>('.active-move-btn');
            if (activeEl) {
                // Только окно списка ходов: страница и доска не двигаются (scrollMove.ts).
                scrollMoveIntoList(notationScrollRef.current, activeEl);
            } else if (viewIndex === -1) {
                notationScrollRef.current.scrollTop = notationScrollRef.current.scrollHeight;
            }
        }
    }, [history.length, viewIndex]);

    // Щелчок мимо выпадающих списков (контроль времени, оформление) закрывает их.
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

    // Свой профиль (GET /profile/me): id — чтобы убрать свой вызов из лобби, имя — для карточки и чата, рейтинг
    // блица — для карточки в партии с ботом и уровня наставника.
    useEffect(() => {
        const token = getToken();
        if (!token) return;

        accountApi.me()
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

    // Ход игрока — единая точка для щелчков, перетаскивания, предходов и ввода нотацией. Проверяет очередь хода
    // и легальность (chess.js), для превращения без выбранной фигуры открывает окно выбора, затем сразу показывает
    // ход на доске. Дальше — по режиму. Партия с человеком: ход уходит на сервер (make_move: ход, command_id —
    // чтобы повторная отправка не применила ход дважды, версия состояния, время обдумывания, признаки «вкладка
    // была скрыта» и «предход»); сервер подтверждает его событием move_made или возвращает прежнюю позицию
    // событием error. Партия с ботом: добавка времени, проверка наставником (кроме лестницы и турнира), при мате
    // или ничьей — итог и сохранение. Свободная доска: только наставник. Возвращает true, если ход сделан или
    // открыто окно превращения.
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

    // Перетаскивание фигуры: движение и отпускание ловятся на window. Поле под указателем ищется по атрибуту
    // data-square, а если под ним оказался другой слой — по координатам внутри рамки доски. На ходу соперника
    // отпускание ставит предход, на своём — делает ход.
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

    // Отмена партии до второго полухода: в партии с человеком решает сервер (abort_game → game_over с итогом '*').
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

    // Реванш: человеку — предложение через сервер (offer_rematch), с ботом — сразу новая партия другим цветом.
    const handleOfferRematch = () => {
        if (gameId && gameOverResult) {
            gameSocket.send('offer_rematch', {game_id: gameId});
            setRematchStatus('offered_by_me');
            playAudio('premove');
        } else if (activeBot && gameOverResult) {
            const nextColor = myColor === 'white' ? 'black' : 'white';
            // Реванш — с той же начальной позиции, что и сыгранная партия; с форой — та же фора (позиция
            // пересчитывается: цвета меняются).
            if (activeOdds) startHistoricalBotGame(activeBot, nextColor, null, {odds: activeOdds});
            else startHistoricalBotGame(activeBot, nextColor, startFen);
        }
    };

    // Сдача (после подтверждения): в партии с человеком итог объявит сервер (resign → game_over), в партии с
    // ботом итог ставится сразу и партия сохраняется с причиной «сдача».
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

    // Возврат к пустой свободной доске: сброс песочницы, «В лобби» после партии с человеком, выход из просмотра.
    // Идущую партию с человеком так покинуть нельзя.
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

    // «Переходить» по совету наставника: позиция до хода игрока. Партия не ждала совета, поэтому бот мог уже ответить —
    // тогда снимается и его ход; добавление за каждый отменённый ход снимается со своей стороны.
    const handleCoachTakeBack = () => {
        const previous = coach.takeBack();
        if (!previous) return;
        if (activeBot) {
            applyIncrement(myColor, -effectiveIncSeconds);
            if (game.history().length - previous.history().length > 1) {
                applyIncrement(myColor === 'white' ? 'black' : 'white', -effectiveIncSeconds);
            }
        }
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

    // Возврат хода на свободной доске и в обычной партии с ботом. В партии с ботом снимаются два полухода —
    // ответ бота и свой ход, — чтобы очередь хода вернулась к игроку. Часы при этом не возвращаются.
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

    // Щелчок по полю. На ходу соперника щелчки ставят предход (фигуры берутся из позиции «после предходов»), на
    // своём — выбирают фигуру и делают ход; щелчок по пустому полю при стоящих предходах снимает всю очередь.
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
            } else if (boardPrefs.quickMove && ((!gameId && !activeBot) || currentTurnColor === myColor)) {
                // «Быстрый ход» (таск 18.4): на это поле может пойти только одна фигура — сразу ход.
                const from = quickMoveFrom(game.moves({verbose: true}), squareId);
                if (from) executeMove(from, squareId);
            }
        }
    };

    // Начальная позиция партии на доске: null — обычная расстановка.
    const startFen = customStartFen(game);

    // Позиция на экране: живая или, при просмотре истории, восстановленная повтором ходов от начала партии.
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
    // Пометки игрока правой кнопкой (таск B.1); снимаются при смене позиции. Пока стоит предход или выбирается
    // превращение, правая кнопка их отменяет (onContextMenu ниже) и стрелку не рисует. Выбранная фигура пометкам не
    // мешает: правая кнопка снимает выбор и рисует стрелку — расчёт варианта не требует сначала отпустить фигуру.
    const annotations = useBoardAnnotations(currentGame.fen(), !(premove || pendingPromotion));
    const xrayAvailable = Boolean(spectatingGameId) || (!gameId && (!activeBot || (coach.enabled && !isRatedBotGame)));
    // «Своя» сторона: в партии с ботом — цвет игрока, на свободной доске и у зрителя — сторона, которая ходит.
    const xraySide: 'w' | 'b' = activeBot && !spectatingGameId ? (myColor === 'white' ? 'w' : 'b') : currentGame.turn();
    // Вкладки правой колонки (план владельца 18.11): журнал ходов с управлением партией, чат партии с человеком (у
    // игрока; у зрителя чат виден всегда — см. tabPanel), наставник (кроме партии с человеком) и рентген, когда он
    // разрешён. Скрытая вкладка остаётся в разметке и только не показывается: черновик сообщения, вспомогательная доска
    // и настройки не сбрасываются при переключении.
    const sideTabs: SideTab[] = [
        'moves',
        ...((gameId && !spectatingGameId) ? ['chat' as const] : []),
        ...((!gameId && !spectatingGameId) ? ['coach' as const] : []),
        ...(xrayAvailable ? ['xray' as const] : []),
    ];
    const [sideTab, setSideTab] = useState<SideTab>('moves');
    // Окно «Новая партия» (схема владельца 18.11). Пока идёт партия или игрок смотрит чужую, новую не начать; как
    // только партия началась (из окна или из лобби), окно закрывается само.
    const [newGameOpen, setNewGameOpen] = useState(false);
    const gameRunning = Boolean(spectatingGameId) || (Boolean(gameId || activeBot) && !gameOverResult);
    useEffect(() => {
        if (gameRunning) setNewGameOpen(false);
    }, [gameRunning]);
    const shownTab: SideTab = sideTabs.includes(sideTab) ? sideTab : 'moves';
    // Предупреждение наставника о зевке нельзя пропустить: вкладка «Наставник» открывается сама, а когда игрок ответил
    // («оставить ход» или «вернуть»), колонка возвращается к ходам — если её открыл не сам игрок.
    const coachPending = Boolean(coach.pending);
    const coachOpenedItself = useRef(false);
    useEffect(() => {
        if (coachPending) {
            setSideTab((current) => {
                if (current !== 'coach') coachOpenedItself.current = true;
                return 'coach';
            });
        } else if (coachOpenedItself.current) {
            coachOpenedItself.current = false;
            setSideTab('moves');
        }
    }, [coachPending]);
    // Непрочитанные сообщения чата — число на вкладке, пока она закрыта.
    const [chatSeen, setChatSeen] = useState(0);
    useEffect(() => {
        if (shownTab === 'chat') setChatSeen(chatMessages.length);
    }, [shownTab, chatMessages.length]);
    const chatUnread = Math.max(0, chatMessages.length - chatSeen);
    const SIDE_TAB_ICONS = {moves: ListOrdered, chat: MessageSquare, coach: GraduationCap, xray: ScanEye};
    // У зрителя в панели чата — кнопка «Выйти из просмотра»: она видна всегда, на любой вкладке, и отдельной вкладки
    // «Чат» у зрителя нет.
    const tabPanel = (id: SideTab) => ({
        role: 'tabpanel' as const,
        'data-testid': `side-panel-${id}`,
        className: shownTab === id || (id === 'chat' && spectatingGameId) ? 'contents' : 'hidden',
    });

    const material = calculateMaterialBalance(boardState);

    const activeMoveIndex = viewIndex === -1 ? history.length - 1 : viewIndex;
    // Идёт своя партия (с человеком или ботом): не окончена и игрок в ней участник, а не зритель.
    const liveGame = Boolean(gameId || activeBot) && !gameOverResult && !spectatingGameId;
    // Вслепую: какие фигуры видны (null — видны все: обычная партия, подсмотр или партия окончена).
    const blindVisible = blind.level > 0 && liveGame && blind.peekUntil <= Date.now()
        ? visibleSquares(blind.level, boardState, history.slice(0, activeMoveIndex + 1), myColor === 'white' ? 'w' : 'b')
        : null;

    // Новая партия — вслепую, если выбрана ступень и партия без рейтинга (лестница, турнир, рейтинговая — обычные).
    useEffect(() => {
        if (!liveGame) {
            blindStartedRef.current = false;
            return;
        }
        if (blindStartedRef.current || history.length > 1) return;
        blindStartedRef.current = true;
        startBlindfold(activeBot ? !isRatedBotGame : !isRatedGame);
    }, [liveGame, history.length, activeBot, isRatedBotGame, isRatedGame]);

    // Товарищеская партия с человеком вслепую — отметка в архиве после окончания (бот — при сохранении партии):
    // POST /profile/games/{id}/blindfold со ступенью и числом подсмотров; сервер примет её только от участника
    // законченной партии без рейтинга.
    useEffect(() => {
        if (!gameId || !gameOverResult || activeBot || isRatedGame || blind.level === 0 || blindMarkedRef.current === gameId) return;
        blindMarkedRef.current = gameId;
        if (!getToken()) return;
        profileApi.markBlindfold(gameId, blind.level, blind.peeks).catch(() => undefined);
    }, [gameId, gameOverResult, activeBot, isRatedGame, blind.level, blind.peeks]);

    // Анимация хода соперника (таск 18.4): только новый ход соперника в живой партии с ботом или человеком.
    useEffect(() => {
        const previous = animatedHistoryLength.current;
        animatedHistoryLength.current = history.length;
        const last = history[history.length - 1];
        const mine = myColor === 'white' ? 'w' : 'b';
        if (!boardPrefs.animateOpponent || viewIndex !== -1 || history.length !== previous + 1 || !(gameId || activeBot)
            || !last || last.color === mine) return;
        setMoveAnim({from: last.from, to: last.to, go: false});
        const frame = requestAnimationFrame(() => setMoveAnim((anim) => anim && {...anim, go: true}));
        const timer = setTimeout(() => setMoveAnim(null), 240);
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(timer);
            setMoveAnim(null);
        };
    }, [history.length]); // eslint-disable-line react-hooks/exhaustive-deps
    const lastMove = activeMoveIndex >= 0 ? history[activeMoveIndex] : null;

    // Поля, куда может пойти выбранная фигура (точки-подсказки) — только на своём ходу и на живой позиции.
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
    // Доступность (таск 26.3): доска ходится с клавиатуры — клетки-кнопки с подписью «e4, белый конь», стрелки и
    // Enter/пробел (как щелчок: выбрать фигуру, сделать ход); общий хук с доской задач — useBoardKeyboard.
    const boardKeys = useBoardKeyboard(`${displayedFiles[0]}${displayedRanks[0]}`, isBoardFlipped, handleSquareClick);

    const topIsWhite = isBoardFlipped;
    // Отметки берсерка относятся к партии между людьми (своей или просматриваемой), а не к боту или свободной доске.
    const isLivePvp = Boolean(gameId || spectatingGameId);
    // Берсерк возможен до своего первого хода: у белых ходов нет вовсе, у чёрных — не больше одного (ход белых).
    const canBerserk = Boolean(gameId) && berserk.allowed && !gameOverResult && !berserk[myColor]
        && history.length <= (myColor === 'white' ? 0 : 1);
    const topPlayerInfo = topIsWhite ? shownWhitePlayer : shownBlackPlayer;
    const bottomPlayerInfo = topIsWhite ? shownBlackPlayer : shownWhitePlayer;
    const topPlayerTime = topIsWhite ? whiteTimeMs : blackTimeMs;
    const bottomPlayerTime = topIsWhite ? blackTimeMs : whiteTimeMs;
    const topIdlePreviewMs = Math.round((topIsWhite ? effectiveWhiteBaseMinutes : effectiveBlackBaseMinutes) * 60 * 1000);
    const bottomIdlePreviewMs = Math.round((!topIsWhite ? effectiveWhiteBaseMinutes : effectiveBlackBaseMinutes) * 60 * 1000);
    // «Взятые фигуры» считаются от полного комплекта — для партии с произвольной позиции это
    // был бы почти весь комплект с первого хода. Показываем только перевес в материале.
    const showCaptured = startFen === null;
    // Порядок взятых фигур (таск 18.4): по ценности, по видам или по порядку взятия.
    const captured = orderCaptured(boardPrefs.captured, {white: material.whiteCapturedSymbols, black: material.blackCapturedSymbols},
        history.slice(0, activeMoveIndex + 1));
    const topCaptured = !showCaptured ? [] : topIsWhite ? captured.white : captured.black;
    const bottomCaptured = !showCaptured ? [] : topIsWhite ? captured.black : captured.white;
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
        const fromPosition = canStartFromPosition && startFromPosition;
        // Фора — только с обычной расстановки (материальная фора сама задаёт позицию).
        const odds = !fromPosition && oddsChoice.kind !== 'none' ? oddsChoice : null;
        setActiveOdds(odds);
        startHistoricalBotGame(botId, colorPref, fromPosition ? sandboxFen : null, odds ? {odds} : {});
    };

    const handleStartCustomGame = (opponent: CustomOpponent, colorPref: 'white' | 'black' | 'random') => {
        setActiveOdds(null);
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
    // Партия турнира, ждущая, пока применится её контроль времени (первый эффект ставит, второй запускает).
    const [pendingTournament, setPendingTournament] = useState<TournamentGameStart | null>(null);
    // Турнир и партия турнира, к которым относится партия на доске, — для плашки TournamentGameBar.
    const [tournamentLinkId, setTournamentLinkId] = useState<number | null>(null);
    const [tournamentGameRefId, setTournamentGameRefId] = useState<number | null>(null);
    const inTournamentGame = Boolean(tournamentLinkId && (isTournamentGame || savedTournamentId));
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
        setTournamentGameRefId(pendingTournament.gameId);
        setPendingTournament(null);
    }, [pendingTournament, effectiveWhiteBaseMinutes, effectiveIncSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

    // Партия с мастером прошлого из каталога (таск 28.5): тот же характер, что в «Машине времени», но вне турнира.
    // На доске — имя на языке игрока, в архив партия уходит под именем из PGN.
    const guestGame = (routeLocation.state as { guestGame?: MasterGameStart } | null)?.guestGame;
    useEffect(() => {
        if (!guestGame || gameId || (activeBot && !gameOverResult)) return;
        navigate('.', {replace: true, state: null});
        setActiveOdds(null);
        startCustomBotGame({name: guestGame.name, savedName: guestGame.savedName, config: guestGame.config}, guestGame.color, null);
    }, [guestGame]); // eslint-disable-line react-hooks/exhaustive-deps

    // Первая партия после регистрации (таск 17.8): архетип по стартовому рейтингу, игрок — белыми.
    const firstGame = (routeLocation.state as { firstGame?: FirstGameStart } | null)?.firstGame;
    useEffect(() => {
        if (!firstGame || gameId || (activeBot && !gameOverResult)) return;
        navigate('.', {replace: true, state: null});
        fetchBotCatalog()
            .then((catalog) => {
                const archetype = pickFirstOpponent(catalog.archetypes, firstGame.rating);
                if (!archetype) return;
                startCustomBotGame(
                    {name: t(`archetypes.${archetype.id}.name`), config: archetype.config, archetypeId: archetype.id},
                    'white', null,
                );
            })
            .catch(() => undefined);
    }, [firstGame]); // eslint-disable-line react-hooks/exhaustive-deps

    // «Разобрать с наставником» со страницы задач (13.3): позиция задачи — на свободную доску, наставник включён.
    const location = useLocation();
    const analyzeFen = (location.state as { analyzeFen?: string } | null)?.analyzeFen;
    useEffect(() => {
        if (!analyzeFen || gameId || activeBot) return;
        if (handleLoadFen(analyzeFen) === null) coach.setEnabled(true);
        navigate('.', {replace: true, state: null});
    }, [analyzeFen]); // eslint-disable-line react-hooks/exhaustive-deps

    // «Смотреть» со страницы «Просмотр» (16.3): режим зрителя для партии из location.state.
    const spectateId = (location.state as { spectate?: number } | null)?.spectate;
    useEffect(() => {
        if (!spectateId || gameId) return;
        handleSpectateGame(spectateId);
        navigate('.', {replace: true, state: null});
    }, [spectateId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Прямой вызов из профиля (17.1): создаём приватное приглашение и, когда сервер его создал, отправляем сопернику.
    const challengeTarget = (location.state as { challenge?: string } | null)?.challenge;
    const pendingChallenge = useRef<string | null>(null);
    const [challengeSent, setChallengeSent] = useState<string | null>(null);
    useEffect(() => {
        if (!challengeTarget || gameId) return;
        pendingChallenge.current = challengeTarget;
        handleCreatePrivateInvite();
        navigate('.', {replace: true, state: null});
    }, [challengeTarget]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const target = pendingChallenge.current;
        if (!target || !createdInviteCode) return;
        pendingChallenge.current = null;
        socialApi.challenge(target, createdInviteCode).then(() => setChallengeSent(target)).catch(() => undefined);
    }, [createdInviteCode]);

    // Ставит позицию из FEN на свободную доску (поле ввода под списком ходов и «Разобрать с наставником»);
    // возвращает текст ошибки или null. После загрузки отмечается «начать с этой позиции» для партии с ботом.
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

    // Навигация по партии (щелчок в списке ходов и кнопки перемотки) меняет только viewIndex; звук — как у
    // показанного хода. Выбор последнего хода возвращает к живой позиции.
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

    // Картинка фигуры выбранного набора (SVG из /assets/pieces/{набор}/, адрес строит getPieceSvgUrl); стиль
    // задаёт масштаб набора и тень, подобранную под тему доски (getHarmoniousPieceStyle).
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

    // Гость: вместо доски — просьба войти (все хуки выше уже вызваны, поэтому проверка стоит здесь, а не в начале).
    if (!getToken()) {
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

    // Свой вызов в списке лобби не показывается.
    const filteredQueue = queuePlayers.filter(p => p.user_id !== currentUserId);
    // Размер, с которым доска рисуется: сохранённый, но не шире окна (на телефоне — почти вся ширина).
    const responsiveBoardPx = typeof window !== 'undefined' ? Math.min(boardSize, window.innerWidth - 24) : boardSize;

    // Турнирная партия: турнир, тур, соперник, таблица; после партии — следующая партия и путь в турнир. После конца
    // партии стоит рядом с кнопками конца партии, над итогом (отзыв владельца 18.11: кнопки возврата в турнир не было
    // видно — итог выталкивал её за край колонки).
    const tournamentBar = inTournamentGame && tournamentLinkId ? (
        <TournamentGameBar tournamentId={savedTournamentId ?? tournamentLinkId} tournamentGameId={tournamentGameRefId}
                           gameOver={Boolean(gameOverResult)}/>
    ) : null;

    // Панель управления партией. Зрителю не показывается: «отменить ход» и «сбросить доску» портили бы чужую партию на
    // его экране (выход — в панели чата). Во время партии — внизу правой колонки; после конца — сразу под навигацией,
    // над «Итогом партии»: иначе итог выталкивал «Анализ партии», «Реванш» и «В лобби» за край колонки (отзыв
    // владельца 18.11).
    const controlsPanel = (
        <GameControlsPanel
            mode={gameId ? 'pvp' : activeBot ? 'bot' : 'sandbox'}
            hideRematch={inTournamentGame}
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
            onBerserk={canBerserk ? handleBerserk : undefined}
            onResign={handleResign}
            onOfferDraw={activeBot ? () => void offerDrawToBot() : handleOfferDraw}
            onAcceptRematch={handleAcceptRematch}
            onDeclineRematch={handleDeclineRematch}
            onOfferRematch={handleOfferRematch}
            onResetSandbox={handleResetSandbox}
            onUndoSandboxMove={handleUndoSandboxMove}
            undoLocked={isRatedBotGame && !gameOverResult}
            hasCustomPosition={isSandbox && startFen !== null}
            onLoadFen={handleLoadFen}
        />
    );

    return (
        <div
            className="w-full max-w-[1920px] h-full flex flex-col xl:flex-row items-center xl:items-stretch justify-between gap-3 px-1 xl:overflow-hidden relative">
            {challengeSent && !gameId && (
                <div role="status" data-testid="challenge-sent"
                     className="absolute top-1 left-1/2 -translate-x-1/2 z-40 bg-amber-900/90 border border-amber-500 text-amber-100 text-sm rounded px-3 py-1.5">
                    {t('social.challengeSent', {name: challengeSent})}
                </div>
            )}

            {dragState && (
                <div
                    data-testid="drag-ghost"
                    className="fixed pointer-events-none z-50 scale-110"
                    style={{
                        left: `${dragState.x}px`,
                        top: `${dragState.y}px`,
                        width: `${responsiveBoardPx / 8}px`,
                        height: `${responsiveBoardPx / 8}px`,
                        transform: 'translate(-50%, -50%)'
                    }}
                >
                    {/* Вслепую перетаскиваемая скрытая фигура не показывается: ход «с пустой клетки». */}
                    {!(blindVisible && !blindVisible.has(dragState.from)) && renderPieceSvg(dragState.piece)}
                </div>
            )}

            {/* ЛЕВАЯ КОЛОНКА: «НОВАЯ ПАРТИЯ» (ОКНО ПО ШАГАМ: КОНТРОЛЬ ВРЕМЕНИ, ПОИСК СОПЕРНИКА, БОТЫ), ИДУЩИЙ ПОИСК,
                СОПЕРНИК-БОТ, ТУРНИРЫ, ЛОББИ И LIVE */}
            <div
                className="w-full xl:w-[400px] 2xl:w-[440px] xl:h-full bg-acacia p-3 rounded-lg shadow-heavy border-2 border-acacia-dark flex flex-col gap-2 text-boxwood-light order-2 xl:order-1 shrink-0 xl:overflow-hidden">

                <GameHallHeader
                    sessionStats={sessionStats}
                    isSoundMuted={isSoundMuted}
                    onToggleSound={handleToggleSound}
                    onFlipBoard={() => setIsManualFlip(prev => !prev)}
                />

                <Button variant="primary" size="lg" icon={<Swords size={18}/>} onClick={() => setNewGameOpen(true)}
                        disabled={gameRunning} data-testid="new-game-open" className="w-full shrink-0">
                    {t('newGame.open')}
                </Button>

                {gameId && <PvpGameStatus gameOverResult={gameOverResult} isRatedGame={isRatedGame}/>}

                {isSearching && !newGameOpen && (
                    <div role="status" data-testid="searching-bar"
                         className="flex items-center justify-between gap-2 rounded-md bg-emerald-950/70 border border-emerald-600/50 px-3 py-2 text-sm text-emerald-100 shrink-0">
                        <span className="animate-pulse">{t('newGame.searching')}</span>
                        <Button size="sm" onClick={cancelMatchmaking}>{t('common.cancel')}</Button>
                    </div>
                )}

                {/* Соперник-бот текущей партии: имя, «думает…», реплика или девиз. */}
                {activeBotProfile && activeBot && (
                    <div className="p-2 rounded-md bg-black/55 border border-amber-600/40 text-xs text-amber-100 shrink-0" data-testid="opponent-note">
                        <div className="font-bold text-amber-400 mb-0.5 flex justify-between">
                            <span>{t('bots.thought', {name: activeBotProfile.shortName})}</span>
                            {isBotThinking && <span className="animate-pulse text-amber-300 font-mono text-[11px]">{t('bots.thinking')}</span>}
                        </div>
                        <div className="text-boxwood-light leading-snug">{botComment ? renderStatus(botComment, t) : activeBotProfile.motto}</div>
                    </div>
                )}

                {/* Турниры, где ждут партию игрока: путь назад — и после перезагрузки страницы. */}
                {!inTournamentGame && !gameId && !(activeBot && !gameOverResult) && <ContinueTournaments/>}

                <div className="flex-1 min-h-0 flex flex-col">
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
                </div>

                <NewGameDialog
                    open={newGameOpen}
                    onClose={() => setNewGameOpen(false)}
                    timeControl={(
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
                    )}
                    human={(
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
                            inviteOdds={inviteOdds}
                            onInviteOddsChange={setInviteOdds}
                            inviteVariant={inviteVariant}
                            onInviteVariantChange={setInviteVariant}
                            onInviteColorPrefChange={setInviteColorPref}
                            createdInviteCode={createdInviteCode}
                            inviteCopied={inviteCopied}
                            onCreatePrivateInvite={handleCreatePrivateInvite}
                            onCopyInviteLink={handleCopyInviteLink}
                        />
                    )}
                    bots={(
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
                                {botsView === 'ladder' ? (
                                    <LadderPanel
                                        playDisabled={(!!gameId || !!activeBot) && !gameOverResult}
                                        onStart={handleLadderStart}
                                        lastOutcome={ladderOutcome}
                                    />
                                ) : (
                                    <PersonalityWorkshop
                                        token={getToken()}
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
                            live={liveBotStrength}
                            rivals={botRivals}
                            odds={oddsChoice}
                            onOddsChange={setOddsChoice}
                        />
                        )}
                        </div>
                    )}
                />
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
                    berserk={isLivePvp && (topIsWhite ? berserk.white : berserk.black)}
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
                    <BoardTextureLayer theme={activeTheme} where="frame"/>

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

                    <div role="group" aria-label={t('a11y.board')}
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
                        {lastMove && boardPrefs.lastMove !== 'highlight' && (
                            <LastMoveArrow from={lastMove.from} to={lastMove.to} flipped={isBoardFlipped}/>
                        )}
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
                                // Анимация хода соперника: фигура уже стоит на своём поле и съезжает туда со старого
                                // (смещение в клетках), поэтому клетки доски всегда показывают настоящую позицию.
                                const slide = moveAnim?.to === squareId ? (() => {
                                    const a = squareCenter(moveAnim.from, isBoardFlipped);
                                    const b = squareCenter(moveAnim.to, isBoardFlipped);
                                    return a && b ? {dx: (a.x - b.x) / 12.5, dy: (a.y - b.y) / 12.5, go: moveAnim.go} : null;
                                })() : null;

                                return (
                                    <div
                                        key={squareId}
                                        data-square={squareId}
                                        {...boardKeys.squareProps(squareId)}
                                        aria-pressed={isSelected}
                                        aria-label={squareLabel(squareId, piece, t as Translate,
                                            Boolean(blindVisible && !blindVisible.has(squareId)))}
                                        onClick={() => handleSquareClick(squareId)}
                                        style={{
                                            backgroundColor: isDark ? activeTheme.dark : activeTheme.light
                                        }}
                                        className="w-full h-full flex items-center justify-center relative cursor-pointer transition-colors duration-75 board-square"
                                    >
                                        <BoardTextureLayer theme={activeTheme} where="square" isDark={isDark}/>

                                        {isLastMove && boardPrefs.lastMove !== 'arrow' && !isSelected && !isPremoveSquare && (
                                            <div className="absolute inset-0 z-10 pointer-events-none" style={{backgroundColor: lastMoveColor(activeTheme)}}/>
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
                                                    // «Только щелчки» (таск 18.4): без перетаскивания, ход — щелчок по фигуре и по полю.
                                                    if (boardPrefs.moveInput === 'click') return;
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
                                                data-testid={slide ? 'move-animation' : undefined}
                                                style={slide ? {
                                                    transform: slide.go ? 'translate(0, 0)' : `translate(${slide.dx * 100}%, ${slide.dy * 100}%)`,
                                                    transition: slide.go ? 'transform 200ms ease-out' : 'none',
                                                    zIndex: 40,
                                                } : undefined}
                                                data-hidden={blindVisible && !blindVisible.has(squareId) ? 'true' : undefined}
                                                className={`relative w-full h-full p-[1.5%] z-20 transition-transform duration-75 ${blindVisible && !blindVisible.has(squareId) ? 'opacity-0' : ''} ${
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
                    berserk={isLivePvp && (topIsWhite ? berserk.black : berserk.white)}
                    hasRatingInfo={!!ratingInfo && isRatedGame}
                    ratingDelta={ratingInfo ? (!topIsWhite ? ratingInfo.white_delta : ratingInfo.black_delta) : undefined}
                    capturedSymbols={bottomCaptured}
                    advantage={bottomAdvantage}
                    timeMs={bottomPlayerTime}
                    idlePreviewMs={bottomIdlePreviewMs}
                />

                {/* Ходы словами для программ чтения экрана и позиция текстом (таск 26.3). */}
                <BoardSpeech lastMove={history.length ? history[history.length - 1] : null}
                             board={boardState} blind={Boolean(blindVisible)}/>

            </div>

            {/* ПРАВАЯ КОЛОНКА: ЖУРНАЛ ХОДОВ, ОФОРМЛЕНИЕ, СТАТУС, ЧАТ, ИТОГ, НАСТАВНИК, РЕНТГЕН И УПРАВЛЕНИЕ ПАРТИЕЙ —
                по вкладкам «Ходы / Чат / Наставник / Рентген» (sideTabs выше).
                На широком экране высота колонки — по окну; что не помещается, прокручивается (раньше обрезалось). */}
            <div
                className="w-full xl:w-[390px] 2xl:w-[430px] xl:h-full bg-acacia p-3 rounded-lg shadow-heavy border-2 border-acacia-dark flex flex-col gap-2 text-boxwood-light order-3 shrink-0 xl:overflow-y-auto relative">

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

                {sideTabs.length > 1 && (
                    <SegmentedControl<SideTab> label={t('board.tabs.label')} value={shownTab} onChange={setSideTab}
                                              stretch testIdPrefix="side-tab"
                                              options={sideTabs.map((id) => {
                                                  const Icon = SIDE_TAB_ICONS[id];
                                                  return {
                                                      id, icon: <Icon size={14} aria-hidden/>,
                                                      label: id === 'chat' && chatUnread > 0
                                                          ? `${t('board.tabs.chat')} (${chatUnread})` : t(`board.tabs.${id}`),
                                                  };
                                              })}/>
                )}

                <div {...tabPanel('moves')}>
                {!spectatingGameId && (
                    <BlindfoldPanel inGame={liveGame}
                                    myTurn={liveGame && viewIndex === -1 && (currentGame.turn() === 'w' ? 'white' : 'black') === myColor}
                                    onMoveInput={(text) => {
                                        const move = parseMoveInput(game.moves({verbose: true}), text);
                                        if (!move) return false;
                                        executeMove(move.from, move.to, move.promotion as PromotionPiece | undefined);
                                        return true;
                                    }}/>
                )}
                {!(blind.hideMoves && blind.level > 0 && liveGame) && <MoveList
                    movePairs={movePairs}
                    activeMoveIndex={activeMoveIndex}
                    viewIndex={viewIndex}
                    historyLength={history.length}
                    hasActiveSession={Boolean(gameId || activeBot || spectatingGameId)}
                    scrollRef={notationScrollRef}
                    onSelectMove={handleSelectMoveFromList}
                    onReturnToLive={() => setViewIndex(-1)}
                />}

                <BoardNavigationControls
                    historyLength={history.length}
                    viewIndex={viewIndex}
                    onFirst={handleNavigateFirst}
                    onBack={handleNavigateBack}
                    onForward={handleNavigateForward}
                    onLast={handleNavigateLast}
                />

                {gameOverResult && tournamentBar}
                {!spectatingGameId && gameOverResult && controlsPanel}


                {activeBot && gameOverResult && savedBotGameId && (
                    <GameSummaryPanel
                        gameId={savedBotGameId}
                        playerColor={myColor}
                        recommendation={recommendationLabel}
                        onPlayRecommended={handlePlayRecommended}
                    />
                )}
                {/* Итог партии с человеком: разбор и карточки «Клубного тренера» — после конца партии; у отменённой
                    партии ходов нет, зрителю итог не нужен. */}
                {gameId && gameOverResult && gameOverResult !== '*' && !spectatingGameId && (
                    <GameSummaryPanel gameId={gameId} playerColor={myColor} recommendation={null}/>
                )}



                {!gameOverResult && tournamentBar}
                {!spectatingGameId && !gameOverResult && controlsPanel}
                </div>

                <div {...tabPanel('chat')}>
                {(gameId || spectatingGameId) && (
                    <GameChatPanel
                        messages={chatMessages}
                        chatInput={chatInput}
                        onChatInputChange={setChatInput}
                        onSendMessage={handleSendChatMessage}
                        onSendPreset={handleSendChatPreset}
                        isSpectator={!!spectatingGameId}
                        onLeaveSpectate={handleLeaveSpectate}
                        myName={currentUsername}
                        gameId={gameId || spectatingGameId}
                    />
                )}
                </div>
                <div {...tabPanel('coach')}>
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
                                  renderPiece={renderPieceSvg} onClose={() => setAuxOpen(false)}
                                  xrayModes={xrayAvailable ? xray.modes : undefined} xrayForOpponent={xray.forOpponent}/>
                    </CoachPanel>
                )}
                </div>
                <div {...tabPanel('xray')}>
                {xrayAvailable && <XrayPanel settings={xray} canSelect={!spectatingGameId}/>}
                </div>

            </div>

        </div>
    );
}

