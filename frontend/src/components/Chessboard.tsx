// --- FILE: frontend/src/components/Chessboard.tsx ---

import {useState, useEffect, useRef, useCallback} from 'react';
import {Chess} from 'chess.js';
import {
    ChevronFirst,
    ChevronLeft,
    ChevronRight,
    ChevronLast,
    Users,
    Sword,
    Flag,
    Handshake,
    Loader2,
    Play,
    RotateCcw,
    Clock,
    ChevronDown,
    ChevronUp,
    Palette,
    RefreshCw,
    ListOrdered,
    Undo2,
    Bot,
    MessageSquareQuote
} from 'lucide-react';
import {gameSocket} from '../services/gameSocket';

const API_BASE_URL = import.meta.env.VITE_API_URL || ('http:' + '//127.0.0.1:8000');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export const MIN_BOARD_SIZE = 380;
export const MAX_BOARD_SIZE = 860;

export function getDefaultBoardSize(): number {
    if (typeof window !== 'undefined') {
        const calculated = window.innerHeight - 230;
        return Math.min(Math.max(calculated, 440), 720);
    }
    return 580;
}

interface QueuePlayer {
    user_id: number;
    username: string;
    rating: number;
    base_time_ms: number;
    increment_ms: number;
}

export interface BoardTheme {
    id: string;
    name: string;
    light: string;
    dark: string;
    coordLight: string;
    coordDark: string;
    border: string;
    useWoodGrain: boolean;
}

export const BOARD_THEMES: Record<string, BoardTheme> = {
    walnut: {
        id: 'walnut',
        name: 'Орех',
        light: '#DFC8A2',
        dark: '#966C46',
        coordLight: '#6E4B2A',
        coordDark: '#F3E5AB',
        border: '#2A1810',
        useWoodGrain: true
    },
    maple: {
        id: 'maple',
        name: 'Клён',
        light: '#F0D9B5',
        dark: '#B58863',
        coordLight: '#8C6239',
        coordDark: '#F0D9B5',
        border: '#3D2314',
        useWoodGrain: false
    },
    tournament: {
        id: 'tournament',
        name: 'Турнирная',
        light: '#EBECD0',
        dark: '#739552',
        coordLight: '#537133',
        coordDark: '#EBECD0',
        border: '#263318',
        useWoodGrain: false
    },
    slate: {
        id: 'slate',
        name: 'Графит',
        light: '#DEE3E6',
        dark: '#788A94',
        coordLight: '#4E5D66',
        coordDark: '#DEE3E6',
        border: '#1F292E',
        useWoodGrain: false
    }
};

const TIME_CONTROLS = [
    {
        group: 'Пуля (Bullet)',
        options: [
            {base: 1, inc: 0, label: '1 мин'},
            {base: 1, inc: 1, label: '1 мин + 1 сек'},
            {base: 2, inc: 0, label: '2 мин'},
            {base: 2, inc: 1, label: '2 мин + 1 сек'}
        ]
    },
    {
        group: 'Блиц (Blitz)',
        options: [
            {base: 3, inc: 0, label: '3 мин'},
            {base: 3, inc: 2, label: '3 мин + 2 сек'},
            {base: 5, inc: 0, label: '5 мин'},
            {base: 5, inc: 3, label: '5 мин + 3 сек'}
        ]
    },
    {
        group: 'Рапид (Rapid)',
        options: [
            {base: 10, inc: 0, label: '10 мин'},
            {base: 10, inc: 10, label: '10 мин + 10 сек'},
            {base: 15, inc: 10, label: '15 мин + 10 сек'}
        ]
    }
];

const PIECE_VALUES: Record<string, number> = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
    k: 0
};

function calculateMaterialBalance(boardState: any[][]) {
    const startCounts: Record<string, number> = {p: 8, n: 2, b: 2, r: 2, q: 1};
    const currentWhite: Record<string, number> = {p: 0, n: 0, b: 0, r: 0, q: 0};
    const currentBlack: Record<string, number> = {p: 0, n: 0, b: 0, r: 0, q: 0};

    let whiteScore = 0;
    let blackScore = 0;

    for (const row of boardState) {
        for (const cell of row) {
            if (!cell) continue;
            const val = PIECE_VALUES[cell.type] || 0;
            if (cell.color === 'w') {
                whiteScore += val;
                if (currentWhite[cell.type] !== undefined) currentWhite[cell.type]++;
            } else {
                blackScore += val;
                if (currentBlack[cell.type] !== undefined) currentBlack[cell.type]++;
            }
        }
    }

    const whiteCapturedSymbols: string[] = [];
    const blackCapturedSymbols: string[] = [];
    const order = ['q', 'r', 'b', 'n', 'p'];
    const glyphs: Record<string, string> = {q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'};

    for (const t of order) {
        const missingBlack = Math.max(0, startCounts[t] - currentBlack[t]);
        for (let i = 0; i < missingBlack; i++) whiteCapturedSymbols.push(glyphs[t]);

        const missingWhite = Math.max(0, startCounts[t] - currentWhite[t]);
        for (let i = 0; i < missingWhite; i++) blackCapturedSymbols.push(glyphs[t]);
    }

    return {
        whiteAdvantage: Math.max(0, whiteScore - blackScore),
        blackAdvantage: Math.max(0, blackScore - whiteScore),
        whiteCapturedSymbols,
        blackCapturedSymbols
    };
}

function cloneChessInstance(source: Chess): Chess {
    const copy = new Chess();
    const currentPgn = source.pgn();
    if (currentPgn) {
        copy.loadPgn(currentPgn);
    } else {
        copy.load(source.fen());
    }
    return copy;
}

export default function Chessboard() {
    const [game, setGame] = useState(new Chess());
    const [history, setHistory] = useState<any[]>([]);
    // -1 = актуальная (живая) позиция; -2 = самое начало партии (до 1-го хода); 0..N = индекс полухода в history
    const [viewIndex, setViewIndex] = useState<number>(-1);
    const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
    const [isManualFlip, setIsManualFlip] = useState<boolean>(false);

    // Тема доски с сохранением в localStorage
    const [boardThemeKey, setBoardThemeKey] = useState<string>(() => {
        const saved = localStorage.getItem('michess_board_theme');
        return saved && BOARD_THEMES[saved] ? saved : 'walnut';
    });

    // Мультиплеерные состояния
    const [gameId, setGameId] = useState<number | null>(null);
    const [myColor, setMyColor] = useState<'white' | 'black'>('white');
    const [isSearching, setIsSearching] = useState(false);
    const [queuePlayers, setQueuePlayers] = useState<QueuePlayer[]>([]);
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [stateVersion, setStateVersion] = useState(0);

    // Состояния исторического бота (Филидор)
    const [activeBot, setActiveBot] = useState<'philidor' | null>(null);
    const [botComment, setBotComment] = useState<string | null>(null);
    const [isBotThinking, setIsBotThinking] = useState<boolean>(false);

    // Выбранный контроль времени и состояние кастомного селектора
    const [selectedTimeControl, setSelectedTimeControl] = useState({base: 3, inc: 0});
    const [isTimeDropdownOpen, setIsTimeDropdownOpen] = useState(false);
    const timeDropdownRef = useRef<HTMLDivElement>(null);
    const boardContainerRef = useRef<HTMLDivElement>(null);
    const notationScrollRef = useRef<HTMLDivElement>(null);

    // Данные игроков и изменения рейтинга
    const [whitePlayer, setWhitePlayer] = useState({username: 'Белые', rating: '1200'});
    const [blackPlayer, setBlackPlayer] = useState({username: 'Черные', rating: '1200'});
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

    // Размер доски и состояние перетаскивания правого нижнего угла
    const [boardSize, setBoardSize] = useState<number>(() => {
        const savedSize = localStorage.getItem('michess_board_size');
        if (savedSize) {
            const parsed = Number(savedSize);
            if (!Number.isNaN(parsed) && parsed >= MIN_BOARD_SIZE && parsed <= MAX_BOARD_SIZE) {
                return parsed;
            }
        }
        return getDefaultBoardSize();
    });
    const [isResizing, setIsResizing] = useState(false);
    const resizeStartRef = useRef<{ startX: number; startY: number; startSize: number } | null>(null);

    const [whiteTimeMs, setWhiteTimeMs] = useState(180000);
    const [blackTimeMs, setBlackTimeMs] = useState(180000);

    const [sessionStats, setSessionStats] = useState({wins: 0, losses: 0, draws: 0});
    const [gameOverResult, setGameOverResult] = useState<string | null>(null);
    const [drawOfferStatus, setDrawOfferStatus] = useState<string | null>(null);

    const activeTheme = BOARD_THEMES[boardThemeKey] || BOARD_THEMES.walnut;

    // Определяем ориентацию доски (с учетом цвета игрока и ручного переворота)
    const isBoardFlipped = (myColor === 'black') !== isManualFlip;

    const playAudio = useCallback((type: 'move' | 'capture' | 'start') => {
        const file = type === 'capture' ? 'Capture.mp3' : type === 'start' ? 'GenericNotify.mp3' : 'Move.mp3';
        const audio = new Audio(`/assets/sounds/${file}`);
        audio.currentTime = 0;
        audio.play().catch(() => {
        });
    }, []);

    const updateSessionStats = useCallback((result: string) => {
        if (!result) return;
        setSessionStats(prev => {
            if (result === '1/2-1/2' || result.includes('draw')) {
                return {...prev, draws: prev.draws + 1};
            }
            const whiteWon = result === '1-0' || result === 'white_won_on_time';
            const userIsWhite = myColor === 'white';
            if ((whiteWon && userIsWhite) || (!whiteWon && !userIsWhite)) {
                return {...prev, wins: prev.wins + 1};
            } else {
                return {...prev, losses: prev.losses + 1};
            }
        });
    }, [myColor]);

    const handleThemeChange = (themeId: string) => {
        setBoardThemeKey(themeId);
        localStorage.setItem('michess_board_theme', themeId);
    };

    // Старт партии против Франсуа-Андре Филидора
    const startPhilidorGame = (colorPref: 'white' | 'black' | 'random' = 'random') => {
        if (isSearching) {
            setIsSearching(false);
            gameSocket.send('leave_queue', {});
        }

        const chosenColor: 'white' | 'black' =
            colorPref === 'random'
                ? (Math.random() < 0.5 ? 'white' : 'black')
                : colorPref;

        const baseMs = selectedTimeControl.base * 60 * 1000;
        const freshGame = new Chess();

        setGameId(null);
        setActiveBot('philidor');
        setMyColor(chosenColor);
        setIsManualFlip(false);
        setGame(freshGame);
        setHistory([]);
        setViewIndex(-1);
        setSelectedSquare(null);
        setGameOverResult(null);
        setRatingInfo(null);
        setDrawOfferStatus(null);
        setWhiteTimeMs(baseMs);
        setBlackTimeMs(baseMs);
        moveStartTime.current = Date.now();

        if (chosenColor === 'white') {
            setWhitePlayer({username: 'Вы', rating: '1500'});
            setBlackPlayer({username: 'Ф.-А. Филидор (1749)', rating: '1850'});
        } else {
            setWhitePlayer({username: 'Ф.-А. Филидор (1749)', rating: '1850'});
            setBlackPlayer({username: 'Вы', rating: '1500'});
        }

        setBotComment('«Пешки — душа шахмат: именно они определяют атаку и защиту!»');
        playAudio('start');
    };

    // Реактивный ход бота Филидора, когда наступает его очередь
    useEffect(() => {
        if (!activeBot || gameOverResult || game.isGameOver()) return;

        const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';
        if (currentTurnColor === myColor) return;

        let isCancelled = false;
        setIsBotThinking(true);

        const timer = setTimeout(async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/v1/bots/move`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        bot_id: activeBot,
                        fen: game.fen()
                    })
                });

                if (!response.ok || isCancelled) return;
                const data = await response.json();
                if (isCancelled) return;

                const from = data.uci.slice(0, 2);
                const to = data.uci.slice(2, 4);
                const promotion = data.uci.length > 4 ? data.uci.slice(4, 5) : 'q';

                const nextGame = cloneChessInstance(game);
                const moveObj = nextGame.move({from, to, promotion});

                if (moveObj) {
                    setGame(nextGame);
                    setHistory(nextGame.history({verbose: true}));
                    setViewIndex(-1);
                    setBotComment(data.comment);
                    moveStartTime.current = Date.now();

                    playAudio(moveObj.san.includes('x') ? 'capture' : 'move');

                    if (nextGame.isGameOver()) {
                        let result = '1/2-1/2';
                        if (nextGame.isCheckmate()) {
                            result = nextGame.turn() === 'w' ? '0-1' : '1-0';
                        }
                        setGameOverResult(result);
                        setDrawOfferStatus(`Партия с Филидором окончена. Результат: ${result}`);
                        updateSessionStats(result);
                        playAudio('start');
                    }
                }
            } catch (err) {
                console.error('Ошибка получения хода бота:', err);
            } finally {
                if (!isCancelled) {
                    setIsBotThinking(false);
                }
            }
        }, 450);

        return () => {
            isCancelled = true;
            clearTimeout(timer);
        };
    }, [activeBot, game, myColor, gameOverResult, playAudio, updateSessionStats]);

    // Обработчик изменения размера доски за правый нижний угол
    useEffect(() => {
        if (!isResizing) return;

        const prevCursor = document.body.style.cursor;
        const prevUserSelect = document.body.style.userSelect;
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';

        const handleResizeMove = (e: MouseEvent) => {
            if (!resizeStartRef.current) return;
            const {startX, startY, startSize} = resizeStartRef.current;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            const delta = Math.round((deltaX + deltaY) / 2);

            const dynamicMax = typeof window !== 'undefined'
                ? Math.min(MAX_BOARD_SIZE, Math.max(MIN_BOARD_SIZE, window.innerWidth - 48))
                : MAX_BOARD_SIZE;

            const nextSize = Math.min(Math.max(startSize + delta, MIN_BOARD_SIZE), dynamicMax);
            setBoardSize(nextSize);
            localStorage.setItem('michess_board_size', String(nextSize));
        };

        const handleResizeEnd = () => {
            setIsResizing(false);
            resizeStartRef.current = null;
        };

        window.addEventListener('mousemove', handleResizeMove);
        window.addEventListener('mouseup', handleResizeEnd);

        return () => {
            document.body.style.cursor = prevCursor;
            document.body.style.userSelect = prevUserSelect;
            window.removeEventListener('mousemove', handleResizeMove);
            window.removeEventListener('mouseup', handleResizeEnd);
        };
    }, [isResizing]);

    const handleResizeMouseDown = (e: React.MouseEvent) => {
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

    // Навигация по истории ходов стрелками клавиатуры
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (history.length === 0) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setViewIndex(prev => {
                    const current = prev === -1 ? history.length - 1 : prev;
                    return current <= 0 ? -2 : current - 1;
                });
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setViewIndex(prev => {
                    if (prev === -1) return -1;
                    if (prev === -2) return history.length > 1 ? 0 : -1;
                    return prev + 1 >= history.length - 1 ? -1 : prev + 1;
                });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setViewIndex(-2);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setViewIndex(-1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [history.length]);

    // Автоскролл списка нотации к активному ходу
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
        };

        if (isTimeDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isTimeDropdownOpen]);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        fetch(`${API_BASE_URL}/api/v1/profile/me`, {
            headers: {'Authorization': `Bearer ${token}`}
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data) setCurrentUserId(data.id);
            })
            .catch(() => {
            });
    }, []);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        gameSocket.connect(token);

        const handleMatchFound = (data: any) => {
            setIsSearching(false);
            setActiveBot(null);
            setBotComment(null);
            setGameId(data.game_id);
            setMyColor(data.color);
            setIsManualFlip(false);
            setRatingInfo(null);
            setStateVersion(data.state_version || 0);

            const initialWhiteTime = data.white_time_ms !== undefined ? data.white_time_ms : (data.base_time_ms || 180000);
            const initialBlackTime = data.black_time_ms !== undefined ? data.black_time_ms : (data.base_time_ms || 180000);
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
            setSelectedSquare(null);
            setGameOverResult(null);
            setDrawOfferStatus('Партия началась!');
            playAudio('start');
            setTimeout(() => setDrawOfferStatus(null), 3000);
        };

        const handleMoveMade = (data: any) => {
            setGame(prev => {
                if (data.fen && prev.fen() === data.fen) {
                    return prev;
                }

                const nextGame = cloneChessInstance(prev);
                let applied = false;

                if (data.pgn) {
                    try {
                        const pgnGame = new Chess();
                        pgnGame.loadPgn(data.pgn);
                        setHistory(pgnGame.history({verbose: true}));
                        applied = true;
                        const isCapture = data.san && data.san.includes('x');
                        playAudio(isCapture ? 'capture' : 'move');
                        return pgnGame;
                    } catch {
                        applied = false;
                    }
                }

                if (!applied) {
                    try {
                        if (data.san) {
                            nextGame.move(data.san);
                        } else if (data.move) {
                            const from = data.move.slice(0, 2);
                            const to = data.move.slice(2, 4);
                            const promotion = data.move.length > 4 ? data.move.slice(4, 5) : 'q';
                            nextGame.move({from, to, promotion});
                        }
                    } catch {
                        if (data.fen) nextGame.load(data.fen);
                    }
                }

                setHistory(nextGame.history({verbose: true}));
                const isCapture = data.san && data.san.includes('x');
                playAudio(isCapture ? 'capture' : 'move');
                return nextGame;
            });

            setViewIndex(-1);
            if (data.state_version !== undefined) {
                setStateVersion(data.state_version);
            }
            if (data.white_time_ms !== undefined) setWhiteTimeMs(data.white_time_ms);
            if (data.black_time_ms !== undefined) setBlackTimeMs(data.black_time_ms);
            moveStartTime.current = Date.now();

            if (data.game_over) {
                setGameOverResult(data.result);
                setRatingInfo(data);
                playAudio('start');
                updateSessionStats(data.result);
            }
        };

        const handleGameOver = (data: any) => {
            setGameOverResult(prev => {
                if (!prev) {
                    playAudio('start');
                    updateSessionStats(data.result);
                }
                return data.result;
            });
            setRatingInfo(data);
            if (data.white_time_ms !== undefined) setWhiteTimeMs(data.white_time_ms);
            if (data.black_time_ms !== undefined) setBlackTimeMs(data.black_time_ms);
            if (data.result) {
                setDrawOfferStatus(`Партия окончена. Результат: ${data.result}`);
            }
        };

        const handleDrawOffered = () => {
            setDrawOfferStatus('Соперник предлагает ничью.');
        };

        const handleDrawDeclined = () => {
            setDrawOfferStatus('Предложение ничьей отклонено.');
            setTimeout(() => setDrawOfferStatus(null), 3000);
        };

        const handleServerError = (data: any) => {
            console.warn('Сервер отклонил действие:', data);
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
                setStateVersion(data.state_version);
            }
        };

        gameSocket.on('match_found', handleMatchFound);
        gameSocket.on('move_made', handleMoveMade);
        gameSocket.on('game_over', handleGameOver);
        gameSocket.on('draw_offered', handleDrawOffered);
        gameSocket.on('draw_declined', handleDrawDeclined);
        gameSocket.on('error', handleServerError);

        return () => {
            gameSocket.off('match_found', handleMatchFound);
            gameSocket.off('move_made', handleMoveMade);
            gameSocket.off('game_over', handleGameOver);
            gameSocket.off('draw_offered', handleDrawOffered);
            gameSocket.off('draw_declined', handleDrawDeclined);
            gameSocket.off('error', handleServerError);
        };
    }, [myColor, playAudio, updateSessionStats]);

    useEffect(() => {
        let interval: any;
        if (!gameId) {
            const fetchQueue = async () => {
                try {
                    const res = await fetch(`${API_BASE_URL}/api/v1/profile/matchmaking/queue`);
                    if (res.ok) {
                        const data = await res.json();
                        setQueuePlayers(data);
                    }
                } catch (e) {
                    console.error('Failed to fetch queue', e);
                }
            };
            fetchQueue();
            interval = setInterval(fetchQueue, 1500);
        } else {
            setQueuePlayers([]);
        }
        return () => clearInterval(interval);
    }, [gameId]);

    const currentTurnChar = game.turn();

    useEffect(() => {
        if ((!gameId && !activeBot) || gameOverResult) return;

        let lastTick = Date.now();
        const currentTurnColor = currentTurnChar === 'w' ? 'white' : 'black';

        const interval = setInterval(() => {
            const now = Date.now();
            const delta = now - lastTick;
            lastTick = now;

            if (currentTurnColor === 'white') {
                setWhiteTimeMs(prev => Math.max(0, prev - delta));
            } else {
                setBlackTimeMs(prev => Math.max(0, prev - delta));
            }
        }, 50);

        return () => clearInterval(interval);
    }, [gameId, activeBot, gameOverResult, currentTurnChar]);

    const executeMove = useCallback((from: string, to: string) => {
        if (gameOverResult || viewIndex !== -1) return;

        const piece = game.get(from as any);
        const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';

        if (!piece || piece.color !== (game.turn() === 'w' ? 'w' : 'b') || ((gameId || activeBot) && currentTurnColor !== myColor)) {
            setSelectedSquare(null);
            return;
        }

        try {
            const nextGame = cloneChessInstance(game);
            const move = nextGame.move({from, to, promotion: 'q'});

            if (move) {
                const timeTaken = Date.now() - moveStartTime.current;
                const uciMove = (move as any).uci || `${move.from}${move.to}${move.promotion || ''}`;

                setGame(nextGame);
                setHistory(nextGame.history({verbose: true}));
                setViewIndex(-1);
                playAudio(move.san.includes('x') ? 'capture' : 'move');
                moveStartTime.current = Date.now();

                if (gameId) {
                    const commandId = typeof crypto !== 'undefined' && crypto.randomUUID
                        ? crypto.randomUUID()
                        : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

                    gameSocket.send('make_move', {
                        game_id: gameId,
                        move: uciMove,
                        command_id: commandId,
                        state_version: stateVersion,
                        time_taken_ms: timeTaken,
                        window_blurred: document.hidden,
                        is_premove: false
                    });
                } else if (activeBot && nextGame.isGameOver()) {
                    let result = '1/2-1/2';
                    if (nextGame.isCheckmate()) {
                        result = nextGame.turn() === 'w' ? '0-1' : '1-0';
                    }
                    setGameOverResult(result);
                    setDrawOfferStatus(`Партия с Филидором окончена. Результат: ${result}`);
                    updateSessionStats(result);
                    playAudio('start');
                }
                setSelectedSquare(null);
            }
        } catch {
            setSelectedSquare(null);
        }
        setDragState(null);
    }, [game, gameId, activeBot, myColor, stateVersion, viewIndex, gameOverResult, playAudio, updateSessionStats]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragState) return;
            setDragState(prev => prev ? {...prev, x: e.clientX, y: e.clientY} : null);
        };

        const handleMouseUp = (e: MouseEvent) => {
            if (!dragState) return;

            let targetSquare: string | null = null;

            const elements = document.elementsFromPoint(e.clientX, e.clientY);
            const squareEl = Array.from(elements || []).find(el => el.hasAttribute('data-square'));
            if (squareEl) {
                targetSquare = squareEl.getAttribute('data-square');
            }

            if (!targetSquare && boardContainerRef.current) {
                const rect = boardContainerRef.current.getBoundingClientRect();
                const padding = 14;
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
                executeMove(dragState.from, targetSquare);
            }

            setDragState(null);
        };

        if (dragState) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragState, isBoardFlipped, executeMove]);

    const formatTime = (ms: number) => {
        const totalMs = Math.max(0, ms);
        const totalSecs = Math.floor(totalMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;

        if (totalMs < 30000 && totalMs > 0) {
            const tenths = Math.floor((totalMs % 1000) / 100);
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
        }

        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const startMatchmaking = () => {
        setGameId(null);
        setActiveBot(null);
        setBotComment(null);
        setGameOverResult(null);
        setRatingInfo(null);
        setIsSearching(true);
        setIsTimeDropdownOpen(false);
        setDrawOfferStatus('Вы опубликовали вызов в лобби...');

        gameSocket.send('join_queue', {
            base_time_ms: selectedTimeControl.base * 60 * 1000,
            increment_ms: selectedTimeControl.inc * 1000
        });
    };

    const cancelMatchmaking = () => {
        setIsSearching(false);
        setDrawOfferStatus(null);
        gameSocket.send('leave_queue', {});
    };

    const acceptChallenge = (targetUserId: number) => {
        setActiveBot(null);
        setBotComment(null);
        gameSocket.send('accept_challenge', {target_user_id: targetUserId});
    };

    const handleResign = () => {
        if ((!gameId && !activeBot) || gameOverResult) return;
        if (window.confirm('Вы действительно хотите сдаться?')) {
            if (gameId) {
                gameSocket.send('resign', {game_id: gameId});
            } else if (activeBot) {
                const res = myColor === 'white' ? '0-1' : '1-0';
                setGameOverResult(res);
                setDrawOfferStatus(`Вы сдались. Победа Филидора (${res}).`);
                updateSessionStats(res);
                playAudio('start');
            }
        }
    };

    const handleOfferDraw = () => {
        if (!gameId || gameOverResult) return;
        gameSocket.send('offer_draw', {game_id: gameId});
        setDrawOfferStatus('Вы предложили ничью...');
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
    };

    const handleResetSandbox = () => {
        if (gameId && !gameOverResult) return;
        setGameId(null);
        setActiveBot(null);
        setBotComment(null);
        setIsBotThinking(false);
        setGameOverResult(null);
        setRatingInfo(null);
        setDrawOfferStatus(null);
        setSelectedSquare(null);
        setViewIndex(-1);
        setGame(new Chess());
        setHistory([]);
    };

    const handleUndoSandboxMove = () => {
        if (gameId || history.length === 0 || isBotThinking) return;
        const nextGame = cloneChessInstance(game);
        nextGame.undo();
        // Если играем с ботом и сейчас наш ход, откатываем и ход бота, и свой ход
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
        setViewIndex(-1);
        setSelectedSquare(null);
    };

    const handleSquareClick = (squareId: string) => {
        if (viewIndex !== -1 || gameOverResult) return;
        if (selectedSquare) {
            if (selectedSquare === squareId) {
                setSelectedSquare(null);
            } else {
                const pieceOnTarget = game.get(squareId as any);
                const turnChar = game.turn();
                const currentTurnColor = turnChar === 'w' ? 'white' : 'black';
                if (pieceOnTarget && pieceOnTarget.color === turnChar && ((!gameId && !activeBot) || currentTurnColor === myColor)) {
                    setSelectedSquare(squareId);
                } else {
                    executeMove(selectedSquare, squareId);
                }
            }
        } else {
            const piece = game.get(squareId as any);
            const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';
            if (piece && piece.color === (game.turn() === 'w' ? 'w' : 'b') && ((!gameId && !activeBot) || currentTurnColor === myColor)) {
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

    // Индекс текущего отображаемого полухода для подсветки в таблице нотации и на доске
    const activeMoveIndex = viewIndex === -1 ? history.length - 1 : viewIndex;
    const lastMove = activeMoveIndex >= 0 ? history[activeMoveIndex] : null;

    // Доступные ходы для выбранной фигуры
    const legalTargetSquares = new Set<string>();
    if (selectedSquare && viewIndex === -1 && !gameOverResult) {
        try {
            const movesForSquare = currentGame.moves({square: selectedSquare as any, verbose: true});
            movesForSquare.forEach((m: any) => legalTargetSquares.add(m.to));
        } catch {
            // Игнорируем некорректный квадрат
        }
    }

    const displayedRanks = isBoardFlipped ? ['1', '2', '3', '4', '5', '6', '7', '8'] : ['8', '7', '6', '5', '4', '3', '2', '1'];
    const displayedFiles = isBoardFlipped ? [...FILES].reverse() : FILES;

    const topIsWhite = isBoardFlipped;
    const topPlayerInfo = topIsWhite ? whitePlayer : blackPlayer;
    const bottomPlayerInfo = topIsWhite ? blackPlayer : whitePlayer;
    const topPlayerTime = topIsWhite ? whiteTimeMs : blackTimeMs;
    const bottomPlayerTime = topIsWhite ? blackTimeMs : whiteTimeMs;
    const topCaptured = topIsWhite ? material.whiteCapturedSymbols : material.blackCapturedSymbols;
    const bottomCaptured = topIsWhite ? material.blackCapturedSymbols : material.whiteCapturedSymbols;
    const topAdvantage = topIsWhite ? material.whiteAdvantage : material.blackAdvantage;
    const bottomAdvantage = topIsWhite ? material.blackAdvantage : material.whiteAdvantage;

    // Формируем пары ходов (Номер хода | Белые | Черные) с точными индексами для клика
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
        if (targetIdx >= history.length - 1) {
            setViewIndex(-1);
        } else {
            setViewIndex(targetIdx);
        }
    };

    // Чистый высококонтрастный рендеринг SVG-фигур
    const renderPieceSvg = (piece: { type: string; color: string }) => {
        const isWhite = piece.color === 'w';
        const pieceFilter = isWhite
            ? 'sepia(0.12) saturate(0.85) brightness(1.03) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.65)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.85))'
            : 'brightness(0.95) contrast(1.08) drop-shadow(0 0 1.2px rgba(255, 248, 225, 0.55)) drop-shadow(0 3px 4px rgba(0, 0, 0, 0.65))';

        return (
            <div className="relative w-full h-full pointer-events-none flex items-center justify-center">
                <img
                    src={`/assets/pieces/${piece.color}${piece.type.toUpperCase()}.svg`}
                    className="w-[90%] h-[90%] object-contain select-none"
                    style={{filter: pieceFilter}}
                    draggable={false}
                    alt={`${piece.color}${piece.type}`}
                />
            </div>
        );
    };

    if (!localStorage.getItem('token')) {
        return (
            <div
                className="flex flex-col items-center justify-center p-8 bg-acacia rounded shadow-heavy border-4 border-acacia-dark text-boxwood-light text-center font-serif">
                <div className="text-xl font-bold mb-2">Требуется авторизация</div>
                <p className="text-sm text-boxwood/80 mb-4">
                    Пожалуйста, войдите в систему в правом верхнем углу, чтобы играть.
                </p>
            </div>
        );
    }

    const filteredQueue = queuePlayers.filter(p => p.user_id !== currentUserId);
    const sidePanelHeight = boardSize + 148;

    return (
        <div
            className="flex flex-col xl:flex-row items-center xl:items-start justify-center gap-6 w-full max-w-[1600px] mx-auto font-serif relative px-2">

            {dragState && (
                <div
                    className="fixed pointer-events-none z-50 scale-110"
                    style={{
                        left: `${dragState.x}px`,
                        top: `${dragState.y}px`,
                        width: `${boardSize / 8}px`,
                        height: `${boardSize / 8}px`,
                        transform: 'translate(-50%, -50%)'
                    }}
                >
                    {renderPieceSvg(dragState.piece)}
                </div>
            )}

            {/* ЛЕВАЯ КОЛОНКА: ЛОББИ, ИГРА С ЛЕГЕНДОЙ И ОФОРМЛЕНИЕ ДОСКИ */}
            <div
                style={{minHeight: `${Math.min(sidePanelHeight, 740)}px`}}
                className="w-full xl:w-80 2xl:w-[340px] bg-acacia p-4 rounded shadow-heavy border-4 border-acacia-dark flex flex-col gap-3.5 text-boxwood-light order-2 xl:order-1 shrink-0"
            >
                <div className="border-b border-acacia-light pb-3 flex justify-between items-center">
                    <div>
                        <div className="text-[11px] tracking-widest uppercase text-boxwood/70">Рейтинговый зал</div>
                        <div className="text-sm font-bold flex items-center gap-2 mt-1 font-mono">
                            <span className="text-xs text-boxwood/70 uppercase font-serif">Сессия:</span>
                            <span className="text-emerald-400">+{sessionStats.wins}</span>
                            <span className="text-red-400">-{sessionStats.losses}</span>
                            <span className="text-gray-300">={sessionStats.draws}</span>
                        </div>
                    </div>
                    <div className="p-2 bg-acacia-dark rounded border border-amber-600/30 text-amber-400">
                        <Sword size={18}/>
                    </div>
                </div>

                {/* Выбор контроля времени и кнопка поиска */}
                <div
                    className="bg-acacia-dark p-3 rounded border border-amber-900/40 flex flex-col gap-2.5 shadow-inner">
                    <label
                        className="text-[10px] uppercase tracking-widest text-boxwood/70 flex items-center gap-1.5 font-bold">
                        <Clock className="text-amber-500" size={12}/> Контроль времени
                    </label>

                    <div className="relative w-full" ref={timeDropdownRef}>
                        <button
                            type="button"
                            disabled={isSearching || !!gameId}
                            onClick={() => setIsTimeDropdownOpen(!isTimeDropdownOpen)}
                            className="w-full bg-black/40 border border-amber-700/50 hover:bg-black/60 disabled:opacity-50 transition text-amber-200 rounded p-2 text-xs font-bold outline-none cursor-pointer flex justify-between items-center shadow-inner"
                        >
                            <span>
                                {selectedTimeControl.base} мин {selectedTimeControl.inc > 0 ? `+ ${selectedTimeControl.inc} сек` : ''}
                            </span>
                            {isTimeDropdownOpen ? <ChevronUp className="text-amber-500/70" size={14}/> :
                                <ChevronDown className="text-amber-500/70" size={14}/>}
                        </button>

                        {isTimeDropdownOpen && (
                            <div
                                className="absolute z-50 w-full top-full mt-1 bg-[#1A120B] border border-amber-700/50 rounded shadow-2xl max-h-60 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-black/20 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                                {TIME_CONTROLS.map((group, gIdx) => (
                                    <div key={gIdx}>
                                        <div
                                            className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-amber-500/60 bg-black/60 font-bold sticky top-0 z-10 border-b border-t border-amber-900/30 first:border-t-0 backdrop-blur-sm">
                                            {group.group}
                                        </div>
                                        {group.options.map((opt, oIdx) => {
                                            const isSelected = selectedTimeControl.base === opt.base && selectedTimeControl.inc === opt.inc;
                                            return (
                                                <button
                                                    key={oIdx}
                                                    type="button"
                                                    className={`w-full text-left px-4 py-2 text-xs font-bold transition flex justify-between items-center ${
                                                        isSelected
                                                            ? 'bg-amber-900/40 text-amber-400'
                                                            : 'text-amber-100/80 hover:bg-amber-900/20 hover:text-amber-200'
                                                    }`}
                                                    onClick={() => {
                                                        setSelectedTimeControl({base: opt.base, inc: opt.inc});
                                                        setIsTimeDropdownOpen(false);
                                                    }}
                                                >
                                                    <span>{opt.label}</span>
                                                    {isSelected && <div
                                                        className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]"/>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {!gameId ? (
                        <button
                            onClick={isSearching ? cancelMatchmaking : startMatchmaking}
                            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 font-bold text-sm rounded transition shadow border ${
                                isSearching
                                    ? 'bg-red-900/80 text-red-100 border-red-700 hover:bg-red-900'
                                    : 'bg-boxwood text-acacia-dark border-amber-700/50 hover:bg-boxwood-light'
                            }`}
                        >
                            {isSearching ? <Loader2 className="animate-spin" size={16}/> : <Users size={16}/>}
                            {isSearching ? 'Отменить поиск' : 'Найти соперника'}
                        </button>
                    ) : (
                        <div
                            className="text-center py-1.5 px-2 rounded bg-emerald-950/50 border border-emerald-700/40 text-emerald-300 text-xs font-bold">
                            {gameOverResult ? `Партия завершена (${gameOverResult})` : 'Идет рейтинговая партия'}
                        </div>
                    )}
                </div>

                {/* КАРТОЧКА ИГРЫ ПРОТИВ ИСТОРИЧЕСКОЙ ЛЕГЕНДЫ: ФИЛИДОР */}
                <div
                    className="bg-acacia-dark p-3 rounded border border-amber-700/40 flex flex-col gap-2.5 shadow-inner">
                    <div className="flex items-center justify-between border-b border-amber-900/30 pb-2">
                        <div className="flex items-center gap-2.5">
                            <img
                                src="/champions/philidor.jpg"
                                alt="Филидор"
                                className="w-10 h-10 rounded-full object-cover border-2 border-amber-500/60 shrink-0"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                            <div>
                                <div className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                                    <Bot size={13} className="text-amber-400"/> Ф.-А. Филидор
                                </div>
                                <div className="text-[10px] text-amber-400/80 font-mono">
                                    Эпоха 1749–1795 • Рейтинг ~1850
                                </div>
                            </div>
                        </div>
                        {activeBot === 'philidor' && !gameOverResult && (
                            <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/50">
                                В игре
                            </span>
                        )}
                    </div>

                    <p className="text-[11px] italic text-boxwood/80 leading-snug">
                        «Пешки — душа шахмат: именно они определяют атаку и защиту».
                    </p>

                    <div className="grid grid-cols-3 gap-1.5">
                        <button
                            type="button"
                            disabled={!!gameId && !gameOverResult}
                            onClick={() => startPhilidorGame('white')}
                            className="px-2 py-1.5 text-[11px] font-bold rounded bg-boxwood text-acacia-dark hover:bg-boxwood-light disabled:opacity-40 transition cursor-pointer shadow"
                        >
                            ♔ Белыми
                        </button>
                        <button
                            type="button"
                            disabled={!!gameId && !gameOverResult}
                            onClick={() => startPhilidorGame('random')}
                            className="px-2 py-1.5 text-[11px] font-bold rounded bg-amber-700/80 text-amber-100 border border-amber-500/40 hover:bg-amber-600 disabled:opacity-40 transition cursor-pointer shadow"
                        >
                            🎲 Случайно
                        </button>
                        <button
                            type="button"
                            disabled={!!gameId && !gameOverResult}
                            onClick={() => startPhilidorGame('black')}
                            className="px-2 py-1.5 text-[11px] font-bold rounded bg-black/60 text-amber-200 border border-amber-700/50 hover:bg-black/80 disabled:opacity-40 transition cursor-pointer shadow"
                        >
                            ♚ Черными
                        </button>
                    </div>

                    {activeBot === 'philidor' && (
                        <div className="p-2.5 rounded bg-black/50 border border-amber-600/30 text-xs text-amber-100">
                            <div
                                className="font-bold text-amber-400 mb-1 flex items-center justify-between text-[11px]">
                                <span className="flex items-center gap-1">
                                    <MessageSquareQuote size={13}/> Мысль Филидора:
                                </span>
                                {isBotThinking && (
                                    <span className="animate-pulse text-amber-300 font-mono text-[10px]">
                                        обдумывает ход...
                                    </span>
                                )}
                            </div>
                            <div className="text-[11px] text-boxwood-light leading-relaxed">
                                {botComment || 'Посмотрим, как вы распорядитесь пешечным центром.'}
                            </div>
                        </div>
                    )}
                </div>

                {/* Открытые вызовы в лобби */}
                <div
                    className="flex flex-col flex-1 min-h-[9rem] bg-acacia-dark rounded border border-amber-900/40 p-3 shadow-inner">
                    <div
                        className="text-xs font-bold text-amber-200 mb-2 flex items-center justify-between border-b border-amber-900/30 pb-1.5">
                        <span>Открытые вызовы в лобби</span>
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-amber-400">
                            {filteredQueue.length}
                        </span>
                    </div>

                    <div
                        className="flex-1 overflow-y-auto space-y-2 text-xs font-mono [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                        {filteredQueue.length === 0 ? (
                            <div
                                className="h-full flex flex-col items-center justify-center p-3 text-boxwood/50 text-center font-serif text-xs">
                                <span>
                                    {isSearching
                                        ? 'Вы в очереди. Ожидание соперников...'
                                        : 'В лобби пока нет вызовов. Нажмите «Найти соперника» выше.'}
                                </span>
                            </div>
                        ) : (
                            filteredQueue.map((p) => (
                                <div
                                    key={p.user_id}
                                    className="p-2 bg-black/40 rounded border border-amber-600/30 flex justify-between items-center hover:border-amber-500/60 transition"
                                >
                                    <div>
                                        <span className="text-amber-300 font-bold">{p.username}</span>
                                        <div className="text-[10px] text-boxwood/70">
                                            Рейтинг: {p.rating} | {p.base_time_ms / 60000}+{(p.increment_ms || 0) / 1000}
                                        </div>
                                    </div>
                                    <button
                                        disabled={!!gameId && !gameOverResult}
                                        onClick={() => acceptChallenge(p.user_id)}
                                        className="px-2.5 py-1 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-emerald-100 rounded text-xs font-bold transition flex items-center gap-1 shadow"
                                    >
                                        <Play size={12}/> Играть
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Стиль доски и ориентация */}
                <div className="bg-acacia-dark p-3 rounded border border-amber-900/40 flex flex-col gap-2.5 mt-auto">
                    <div className="flex justify-between items-center text-xs text-boxwood/80">
                        <span className="flex items-center gap-1.5 font-bold">
                            <Palette className="text-amber-500" size={14}/> Стиль доски
                        </span>
                        <span className="text-amber-400 font-bold">{activeTheme.name}</span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                        {Object.values(BOARD_THEMES).map((theme) => {
                            const isCurrent = theme.id === activeTheme.id;
                            return (
                                <button
                                    key={theme.id}
                                    type="button"
                                    onClick={() => handleThemeChange(theme.id)}
                                    className={`flex flex-col items-center gap-1 p-1.5 rounded border text-[10px] font-bold transition ${
                                        isCurrent
                                            ? 'bg-amber-900/40 border-amber-400 text-amber-200 shadow'
                                            : 'bg-black/30 border-amber-900/40 text-boxwood/70 hover:text-amber-200 hover:border-amber-700/60'
                                    }`}
                                >
                                    <div
                                        className="w-6 h-6 rounded-sm overflow-hidden grid grid-cols-2 grid-rows-2 border border-black/50 shadow-sm">
                                        <div style={{backgroundColor: theme.light}}/>
                                        <div style={{backgroundColor: theme.dark}}/>
                                        <div style={{backgroundColor: theme.dark}}/>
                                        <div style={{backgroundColor: theme.light}}/>
                                    </div>
                                    <span className="truncate w-full text-center">{theme.name}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-amber-900/30 gap-2">
                        <button
                            type="button"
                            onClick={() => setIsManualFlip(prev => !prev)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded bg-black/35 hover:bg-black/55 border border-amber-900/50 text-xs font-bold text-amber-200 transition"
                            title="Перевернуть доску"
                        >
                            <RefreshCw className="text-amber-400" size={13}/> Перевернуть доску
                        </button>
                        <span className="text-[10px] font-mono text-boxwood/50 px-1.5">
                            {boardSize}px
                        </span>
                    </div>
                </div>
            </div>

            {/* ЦЕНТРАЛЬНАЯ КОЛОНКА: ИГРОКИ И ШАХМАТНАЯ ДОСКА */}
            <div className="flex flex-col items-center gap-3 order-1 xl:order-2 shrink-0">

                {/* Верхний игрок */}
                <div
                    style={{width: `${boardSize}px`}}
                    className={`bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light ${isResizing ? 'transition-none' : 'transition-colors'}`}
                >
                    <div className="flex items-center gap-3 min-w-0">
                        <div
                            className={`w-10 h-10 rounded flex items-center justify-center border border-amber-600/30 font-bold shrink-0 ${topIsWhite ? 'bg-boxwood text-acacia-dark' : 'bg-acacia text-amber-200'}`}>
                            {topIsWhite ? '♙' : '♟'}
                        </div>
                        <div className="min-w-0">
                            <div className="font-bold flex items-center gap-2">
                                <span
                                    className="truncate">{(gameId || activeBot) ? topPlayerInfo.username : (topIsWhite ? 'Белые (Анализ)' : 'Черные (Анализ)')}</span>
                                {(gameId || activeBot) && (
                                    <span
                                        className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20 flex items-center gap-1 font-mono">
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
                            <div className="flex items-center gap-1.5 text-xs text-amber-200/80 min-h-[18px]">
                                <span className="tracking-tighter truncate">{topCaptured.join('')}</span>
                                {topAdvantage > 0 && (
                                    <span
                                        className="text-[10px] font-mono font-bold px-1 rounded bg-amber-900/50 text-amber-300">
                                        +{topAdvantage}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div
                        className="bg-[#1A120B] px-5 py-2 rounded-md border-2 border-amber-700/50 shadow-inner font-mono text-3xl font-bold tracking-wider text-amber-500 min-w-[145px] text-center">
                        {(gameId || activeBot) ? formatTime(topPlayerTime) : `${selectedTimeControl.base.toString().padStart(2, '0')}:00`}
                    </div>
                </div>

                {/* ШАХМАТНАЯ ДОСКА */}
                <div
                    ref={boardContainerRef}
                    style={{
                        width: `${boardSize}px`,
                        height: `${boardSize}px`,
                        backgroundColor: activeTheme.border
                    }}
                    className={`p-3.5 rounded-md shadow-heavy border-2 border-amber-950/80 relative select-none group/board ${isResizing ? 'transition-none ring-2 ring-amber-500/60' : 'transition-colors'}`}
                >
                    {activeTheme.useWoodGrain && (
                        <div
                            className="absolute inset-0 opacity-25 mix-blend-multiply pointer-events-none"
                            style={{backgroundImage: "url('/assets/textures/wood-grain.png')"}}
                        />
                    )}

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

                                        {isLastMove && !isSelected && (
                                            <div className="absolute inset-0 bg-amber-300/35 z-10 pointer-events-none"/>
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
                                                onMouseDown={(e) => {
                                                    if (viewIndex !== -1 || gameOverResult) return;
                                                    const turnColor = currentGame.turn() === 'w' ? 'white' : 'black';
                                                    if (piece.color !== (currentGame.turn() === 'w' ? 'w' : 'b')) return;
                                                    if ((gameId || activeBot) && turnColor !== myColor) return;
                                                    e.stopPropagation();
                                                    moveStartTime.current = Date.now();
                                                    setSelectedSquare(squareId);
                                                    setDragState({
                                                        from: squareId,
                                                        piece,
                                                        x: e.clientX,
                                                        y: e.clientY
                                                    });
                                                }}
                                                className={`relative w-full h-full p-[3%] z-20 transition-transform duration-75 ${
                                                    piece.color === (currentGame.turn() === 'w' ? 'w' : 'b') && viewIndex === -1 && !gameOverResult
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
                                                className="absolute top-0.5 left-1 text-[10px] sm:text-[11px] font-sans font-bold opacity-85 z-20 pointer-events-none leading-none"
                                            >
                                                {rank}
                                            </span>
                                        )}
                                        {rank === displayedRanks[7] && (
                                            <span
                                                style={{color: isDark ? activeTheme.coordDark : activeTheme.coordLight}}
                                                className="absolute bottom-0.5 right-1 text-[10px] sm:text-[11px] font-sans font-bold opacity-85 z-20 pointer-events-none leading-none"
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
                            {boardSize} × {boardSize} px
                        </div>
                    )}

                    {/* Уголок изменения размера доски в стиле Lichess / Chess.com */}
                    <div
                        onMouseDown={handleResizeMouseDown}
                        onDoubleClick={handleResizeDoubleClick}
                        title="Потяните, чтобы изменить размер доски (двойной клик — сбросить)"
                        className={`absolute bottom-0 right-0 w-6 h-6 z-40 cursor-nwse-resize flex items-end justify-end p-0.5 rounded-tl transition-opacity ${
                            isResizing
                                ? 'opacity-100 text-amber-400'
                                : 'opacity-50 group-hover/board:opacity-90 hover:!opacity-100 text-amber-200/80 hover:text-amber-300'
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

                {/* Нижний игрок */}
                <div
                    style={{width: `${boardSize}px`}}
                    className={`bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light ${isResizing ? 'transition-none' : 'transition-colors'}`}
                >
                    <div className="flex items-center gap-3 min-w-0">
                        <div
                            className={`w-10 h-10 rounded flex items-center justify-center border border-amber-600/30 font-bold shrink-0 ${!topIsWhite ? 'bg-boxwood text-acacia-dark' : 'bg-acacia text-amber-200'}`}>
                            {!topIsWhite ? '♙' : '♟'}
                        </div>
                        <div className="min-w-0">
                            <div className="font-bold flex items-center gap-2">
                                <span
                                    className="truncate">{(gameId || activeBot) ? bottomPlayerInfo.username : (!topIsWhite ? 'Вы (Белые)' : 'Вы (Черные)')}</span>
                                {(gameId || activeBot) && (
                                    <span
                                        className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20 flex items-center gap-1 font-mono">
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
                            <div className="flex items-center gap-1.5 text-xs text-amber-200/80 min-h-[18px]">
                                <span className="tracking-tighter truncate">{bottomCaptured.join('')}</span>
                                {bottomAdvantage > 0 && (
                                    <span
                                        className="text-[10px] font-mono font-bold px-1 rounded bg-amber-900/50 text-amber-300">
                                        +{bottomAdvantage}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div
                        className="bg-[#1A120B] px-5 py-2 rounded-md border-2 border-amber-700/50 shadow-inner font-mono text-3xl font-bold tracking-wider text-amber-500 min-w-[145px] text-center">
                        {(gameId || activeBot) ? formatTime(bottomPlayerTime) : `${selectedTimeControl.base.toString().padStart(2, '0')}:00`}
                    </div>
                </div>

            </div>

            {/* ПРАВАЯ КОЛОНКА: ЖУРНАЛ ХОДОВ (НОТАЦИЯ), НАВИГАЦИЯ И ИГРОВЫЕ ДЕЙСТВИЯ */}
            <div
                style={{height: `${Math.max(sidePanelHeight, 560)}px`}}
                className="w-full xl:w-80 2xl:w-[340px] bg-acacia p-4 rounded shadow-heavy border-4 border-acacia-dark flex flex-col gap-3 text-boxwood-light order-3 shrink-0"
            >
                <div className="border-b border-acacia-light pb-3 flex justify-between items-center">
                    <div>
                        <div
                            className="text-[11px] tracking-widest uppercase text-boxwood/70 flex items-center gap-1.5">
                            <ListOrdered className="text-amber-400" size={14}/> Журнал ходов
                        </div>
                        <div className="text-xs font-bold text-amber-200 mt-0.5 truncate">
                            {(gameId || activeBot)
                                ? `${whitePlayer.username} vs ${blackPlayer.username}`
                                : 'Свободная доска / Разбор'}
                        </div>
                    </div>
                    <span
                        className="px-2 py-0.5 rounded bg-acacia-dark border border-amber-700/40 font-mono text-xs text-amber-400 font-bold">
                        {gameOverResult || (history.length > 0 ? `${Math.ceil(history.length / 2)} х.` : 'Старт')}
                    </span>
                </div>

                {drawOfferStatus && (
                    <div
                        className="bg-amber-950/90 p-2.5 rounded border border-amber-600/50 text-xs text-amber-200 text-center flex flex-col gap-2">
                        <span>{drawOfferStatus}</span>
                        {drawOfferStatus.includes('предлагает ничью') && (
                            <div className="flex justify-center gap-2">
                                <button onClick={acceptDraw}
                                        className="px-3 py-1 bg-emerald-800 hover:bg-emerald-700 text-white rounded text-xs font-bold">
                                    Принять
                                </button>
                                <button onClick={declineDraw}
                                        className="px-3 py-1 bg-red-800 hover:bg-red-700 text-white rounded text-xs font-bold">
                                    Отклонить
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Интерактивный список сделанных ходов (Всегда виден!) */}
                <div
                    className="flex-1 flex flex-col bg-[#1A120B]/90 rounded border border-amber-900/50 overflow-hidden shadow-inner">
                    <div
                        className="grid grid-cols-[44px_1fr_1fr] px-3 py-1.5 bg-black/50 border-b border-amber-900/40 text-[10px] uppercase tracking-wider text-boxwood/50 font-sans font-bold">
                        <span>№</span>
                        <span>Белые</span>
                        <span>Черные</span>
                    </div>

                    <div
                        ref={notationScrollRef}
                        className="flex-1 overflow-y-auto divide-y divide-amber-900/15 font-mono text-sm [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-900/50"
                    >
                        {movePairs.length === 0 ? (
                            <div
                                className="h-full flex flex-col items-center justify-center p-6 text-center text-boxwood/40 font-serif text-xs gap-1.5">
                                <span>Ходов пока нет.</span>
                                <span className="text-[11px] text-boxwood/30">
                                    {(gameId || activeBot)
                                        ? 'Сделайте первый ход на доске.'
                                        : 'Двигайте фигуры на доске для анализа или начните игру слева.'}
                                </span>
                            </div>
                        ) : (
                            movePairs.map((pair) => {
                                const isWhiteActive = activeMoveIndex === pair.whiteIdx;
                                const isBlackActive = pair.blackIdx !== undefined && activeMoveIndex === pair.blackIdx;

                                return (
                                    <div
                                        key={pair.moveNumber}
                                        className="grid grid-cols-[44px_1fr_1fr] items-center px-2 py-1 hover:bg-white/5 transition-colors"
                                    >
                                        <span className="text-xs text-amber-500/60 font-bold pl-1 select-none">
                                            {pair.moveNumber}.
                                        </span>

                                        <button
                                            type="button"
                                            onClick={() => handleSelectMoveFromList(pair.whiteIdx)}
                                            className={`text-left px-2 py-1 rounded text-xs font-bold transition truncate ${
                                                isWhiteActive
                                                    ? 'active-move-btn bg-amber-600/35 text-amber-200 border border-amber-500/50 shadow-sm'
                                                    : 'text-boxwood-light hover:bg-amber-900/30 hover:text-white'
                                            }`}
                                        >
                                            {pair.whiteSan}
                                        </button>

                                        {pair.blackSan !== undefined && pair.blackIdx !== undefined ? (
                                            <button
                                                type="button"
                                                onClick={() => handleSelectMoveFromList(pair.blackIdx!)}
                                                className={`text-left px-2 py-1 rounded text-xs font-bold transition truncate ${
                                                    isBlackActive
                                                        ? 'active-move-btn bg-amber-600/35 text-amber-200 border border-amber-500/50 shadow-sm'
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

                    {/* Плашка предупреждения, если игрок смотрит прошлые ходы */}
                    {viewIndex !== -1 && history.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setViewIndex(-1)}
                            className="w-full py-1.5 px-3 bg-amber-700/30 hover:bg-amber-700/50 border-t border-amber-500/40 text-amber-200 text-[11px] font-bold text-center transition"
                        >
                            Просмотр истории
                            ({viewIndex === -2 ? 'Начало' : `полуход ${viewIndex + 1} из ${history.length}`}) —
                            Вернуться к игре
                        </button>
                    )}
                </div>

                {/* Кнопки пошаговой навигации по истории */}
                <div
                    className="bg-acacia-dark p-2 rounded border border-amber-900/40 flex items-center justify-between">
                    <span className="text-[11px] text-boxwood/70 pl-1">Навигация:</span>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            disabled={history.length === 0 || viewIndex === -2}
                            onClick={() => setViewIndex(-2)}
                            className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition"
                            title="В начало партии (Стрелка вверх)"
                        >
                            <ChevronFirst size={16}/>
                        </button>
                        <button
                            type="button"
                            disabled={history.length === 0 || viewIndex === -2}
                            onClick={() => {
                                if (history.length > 0) {
                                    const current = viewIndex === -1 ? history.length - 1 : viewIndex;
                                    setViewIndex(current <= 0 ? -2 : current - 1);
                                }
                            }}
                            className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition"
                            title="Ход назад (Стрелка влево)"
                        >
                            <ChevronLeft size={16}/>
                        </button>
                        <button
                            type="button"
                            disabled={history.length === 0 || viewIndex === -1}
                            onClick={() => {
                                if (viewIndex === -2 && history.length > 0) {
                                    setViewIndex(history.length === 1 ? -1 : 0);
                                } else if (viewIndex !== -1 && viewIndex < history.length - 2) {
                                    setViewIndex(viewIndex + 1);
                                } else {
                                    setViewIndex(-1);
                                }
                            }}
                            className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition"
                            title="Ход вперед (Стрелка вправо)"
                        >
                            <ChevronRight size={16}/>
                        </button>
                        <button
                            type="button"
                            disabled={history.length === 0 || viewIndex === -1}
                            onClick={() => setViewIndex(-1)}
                            className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark disabled:opacity-30 transition"
                            title="К последнему ходу (Стрелка вниз)"
                        >
                            <ChevronLast size={16}/>
                        </button>
                    </div>
                </div>

                {/* Кнопки управления партией (Онлайн, Бот или Свободный анализ) */}
                {gameId ? (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={handleResign}
                                disabled={!!gameOverResult}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/80 text-red-200 text-xs font-bold rounded hover:bg-red-900 transition shadow border border-red-800/50 disabled:opacity-40"
                            >
                                <Flag size={14}/> Сдаться
                            </button>
                            <button
                                type="button"
                                onClick={handleOfferDraw}
                                disabled={!!gameOverResult}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs font-bold rounded hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40"
                            >
                                <Handshake size={14}/> Ничья
                            </button>
                        </div>

                        {gameOverResult && (
                            <button
                                type="button"
                                onClick={handleResetSandbox}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 font-bold text-sm rounded transition shadow bg-boxwood text-acacia-dark border border-amber-700/50 hover:bg-boxwood-light"
                            >
                                <RotateCcw size={16}/> Новая игра / В лобби
                            </button>
                        )}
                    </>
                ) : activeBot ? (
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            disabled={history.length === 0 || isBotThinking}
                            onClick={handleUndoSandboxMove}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs font-bold rounded hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40"
                        >
                            <Undo2 size={14}/> Вернуть ход
                        </button>
                        {!gameOverResult ? (
                            <button
                                type="button"
                                onClick={handleResign}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/80 text-red-200 text-xs font-bold rounded hover:bg-red-900 transition shadow border border-red-800/50"
                            >
                                <Flag size={14}/> Сдаться
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleResetSandbox}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-boxwood text-acacia-dark text-xs font-bold rounded hover:bg-boxwood-light transition shadow border border-amber-700/50"
                            >
                                <RotateCcw size={14}/> В режим разбора
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            disabled={history.length === 0}
                            onClick={handleUndoSandboxMove}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs font-bold rounded hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40"
                        >
                            <Undo2 size={14}/> Отменить ход
                        </button>
                        <button
                            type="button"
                            disabled={history.length === 0}
                            onClick={handleResetSandbox}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-amber-300 text-xs font-bold rounded hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40"
                        >
                            <RotateCcw size={14}/> Сбросить доску
                        </button>
                    </div>
                )}

            </div>

        </div>
    );
}