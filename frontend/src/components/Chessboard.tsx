// --- FILE: frontend/src/components/Chessboard.tsx ---

import { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import {
  ChevronFirst,
  ChevronLeft,
  ChevronRight,
  ChevronLast,
  Users,
  Sword,
  Sliders,
  Flag,
  Handshake,
  Loader2,
  Play,
  RotateCcw,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { gameSocket } from '../services/gameSocket';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

interface QueuePlayer {
  user_id: number;
  username: string;
  rating: number;
  base_time_ms: number;
  increment_ms: number;
}

const TIME_CONTROLS = [
  {
    group: 'Пуля (Bullet)',
    options: [
      { base: 1, inc: 0, label: '1 мин' },
      { base: 1, inc: 1, label: '1 мин + 1 сек' },
      { base: 2, inc: 0, label: '2 мин' },
      { base: 2, inc: 1, label: '2 мин + 1 сек' }
    ]
  },
  {
    group: 'Блиц (Blitz)',
    options: [
      { base: 3, inc: 0, label: '3 мин' },
      { base: 3, inc: 2, label: '3 мин + 2 сек' },
      { base: 5, inc: 0, label: '5 мин' },
      { base: 5, inc: 3, label: '5 мин + 3 сек' }
    ]
  },
  {
    group: 'Рапид (Rapid)',
    options: [
      { base: 10, inc: 0, label: '10 мин' },
      { base: 10, inc: 10, label: '10 мин + 10 сек' },
      { base: 15, inc: 10, label: '15 мин + 10 сек' }
    ]
  }
];

export default function Chessboard() {
  const [game, setGame] = useState(new Chess());
  const [history, setHistory] = useState<any[]>([]);
  const [viewIndex, setViewIndex] = useState<number>(-1);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  // Мультиплеерные состояния
  const [gameId, setGameId] = useState<number | null>(null);
  const [myColor, setMyColor] = useState<'white' | 'black'>('white');
  const [isSearching, setIsSearching] = useState(false);
  const [queuePlayers, setQueuePlayers] = useState<QueuePlayer[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // Выбранный контроль времени и состояние кастомного селектора
  const [selectedTimeControl, setSelectedTimeControl] = useState({ base: 3, inc: 0 });
  const [isTimeDropdownOpen, setIsTimeDropdownOpen] = useState(false);
  const timeDropdownRef = useRef<HTMLDivElement>(null);

  // Данные игроков и изменения рейтинга
  const [whitePlayer, setWhitePlayer] = useState({ username: 'Белые', rating: '1200' });
  const [blackPlayer, setBlackPlayer] = useState({ username: 'Черные', rating: '1200' });
  const [ratingInfo, setRatingInfo] = useState<{ white_delta?: number; black_delta?: number; white_new_rating?: number; black_new_rating?: number } | null>(null);

  const moveStartTime = useRef<number>(Date.now());

  const [dragState, setDragState] = useState<{
    from: string;
    piece: { type: string; color: string };
    x: number;
    y: number;
  } | null>(null);

  const [boardSize, setBoardSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const calculated = window.innerHeight - 260;
      return Math.min(Math.max(calculated, 400), 720);
    }
    return 540;
  });

  const [whiteTimeMs, setWhiteTimeMs] = useState(180000);
  const [blackTimeMs, setBlackTimeMs] = useState(180000);

  const [sessionStats, setSessionStats] = useState({ wins: 0, losses: 0, draws: 0 });
  const [gameOverResult, setGameOverResult] = useState<string | null>(null);
  const [drawOfferStatus, setDrawOfferStatus] = useState<string | null>(null);

  const topPlayerInfo = myColor === 'white' ? blackPlayer : whitePlayer;
  const bottomPlayerInfo = myColor === 'white' ? whitePlayer : blackPlayer;
  const topPlayerTime = myColor === 'white' ? blackTimeMs : whiteTimeMs;
  const bottomPlayerTime = myColor === 'white' ? whiteTimeMs : blackTimeMs;

  // Закрытие дропдауна по клику вне его области
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

  // Получаем ID текущего пользователя
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('http://127.0.0.1:8000/api/v1/profile/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) setCurrentUserId(data.id);
      })
      .catch(() => {});
  }, []);

  // Подключение к WebSocket при монтировании компонента
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    gameSocket.connect(token);

    const handleMatchFound = (data: any) => {
      console.log("ПОЛУЧЕНО СОБЫТИЕ MATCH_FOUND:", data);
      setIsSearching(false);
      setGameId(data.game_id);
      setMyColor(data.color);
      setRatingInfo(null);

      // Устанавливаем время на часах согласно контролю, с которым создана партия
      const initialTime = data.base_time_ms || 180000;
      setWhiteTimeMs(initialTime);
      setBlackTimeMs(initialTime);

      if (data.white_username) {
        setWhitePlayer({ username: data.white_username, rating: String(data.white_rating || '1200') });
      }
      if (data.black_username) {
        setBlackPlayer({ username: data.black_username, rating: String(data.black_rating || '1200') });
      }

      setGame(new Chess());
      setHistory([]);
      setGameOverResult(null);
      setDrawOfferStatus('Партия началась!');
      playAudio('start');
      setTimeout(() => setDrawOfferStatus(null), 3000);
    };

    const handleMoveMade = (data: any) => {
      const newGame = new Chess();
      if (data.pgn) {
        newGame.loadPgn(data.pgn);
      }
      setGame(newGame);
      setHistory(newGame.history({ verbose: true }));
      setWhiteTimeMs(data.white_time_ms);
      setBlackTimeMs(data.black_time_ms);
      moveStartTime.current = Date.now();

      const isCapture = data.move && (data.move.includes('x') || data.pgn?.includes('x'));
      playAudio(isCapture ? 'capture' : 'move');

      if (data.game_over) {
        setGameOverResult(data.result);
        setRatingInfo(data);
        playAudio('start');
        updateSessionStats(data.result);
      }
    };

    const handleGameOver = (data: any) => {
      setGameOverResult(data.result);
      setRatingInfo(data);
      playAudio('start');
      updateSessionStats(data.result);
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

    gameSocket.on('match_found', handleMatchFound);
    gameSocket.on('move_made', handleMoveMade);
    gameSocket.on('game_over', handleGameOver);
    gameSocket.on('draw_offered', handleDrawOffered);
    gameSocket.on('draw_declined', handleDrawDeclined);

    return () => {
      gameSocket.off('match_found', handleMatchFound);
      gameSocket.off('move_made', handleMoveMade);
      gameSocket.off('game_over', handleGameOver);
      gameSocket.off('draw_offered', handleDrawOffered);
      gameSocket.off('draw_declined', handleDrawDeclined);
    };
  }, []);

  const updateSessionStats = (result: string) => {
    if (!result) return;
    setSessionStats(prev => {
      if (result === '1/2-1/2' || result.includes('draw')) {
        return { ...prev, draws: prev.draws + 1 };
      }
      const whiteWon = result === '1-0' || result === 'white_won_on_time';
      const userIsWhite = myColor === 'white';
      if ((whiteWon && userIsWhite) || (!whiteWon && !userIsWhite)) {
        return { ...prev, wins: prev.wins + 1 };
      } else {
        return { ...prev, losses: prev.losses + 1 };
      }
    });
  };

  // Опрос очереди для отображения лобби всем пользователям вне игры
  useEffect(() => {
    let interval: any;
    if (!gameId) {
      const fetchQueue = async () => {
        try {
          const res = await fetch('http://127.0.0.1:8000/api/v1/profile/matchmaking/queue');
          if (res.ok) {
            const data = await res.json();
            setQueuePlayers(data);
          }
        } catch (e) {
          console.error("Failed to fetch queue", e);
        }
      };
      fetchQueue();
      interval = setInterval(fetchQueue, 1500);
    } else {
      setQueuePlayers([]);
    }
    return () => clearInterval(interval);
  }, [gameId]);

  // Локальный таймер реального времени (тикает во время партии)
  useEffect(() => {
    if (!gameId || gameOverResult) return;

    let lastTick = Date.now();
    const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';

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
  }, [gameId, gameOverResult, game.turn()]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState) return;
      setDragState(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragState) return;

      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      const squareElement = elements.find(el => el.hasAttribute('data-square'));

      if (squareElement) {
        const targetSquare = squareElement.getAttribute('data-square');
        if (targetSquare && targetSquare !== dragState.from) {
          executeMove(dragState.from, targetSquare);
        }
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
  }, [dragState, game, gameId]);

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

  const playAudio = (type: 'move' | 'capture' | 'start') => {
    const file = type === 'capture' ? 'Capture.mp3' : type === 'start' ? 'GenericNotify.mp3' : 'Move.mp3';
    const audio = new Audio(`/assets/sounds/${file}`);
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };

  const startMatchmaking = () => {
    setGameId(null);
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
    gameSocket.send('accept_challenge', { target_user_id: targetUserId });
  };

  const handleResign = () => {
    if (!gameId || gameOverResult) return;
    if (window.confirm('Вы действительно хотите сдаться?')) {
      gameSocket.send('resign', { game_id: gameId });
    }
  };

  const handleOfferDraw = () => {
    if (!gameId || gameOverResult) return;
    gameSocket.send('offer_draw', { game_id: gameId });
    setDrawOfferStatus('Вы предложили ничью...');
  };

  const acceptDraw = () => {
    if (!gameId) return;
    gameSocket.send('accept_draw', { game_id: gameId });
    setDrawOfferStatus(null);
  };

  const declineDraw = () => {
    if (!gameId) return;
    gameSocket.send('decline_draw', { game_id: gameId });
    setDrawOfferStatus(null);
  };

  const executeMove = (from: string, to: string) => {
    if (gameOverResult || viewIndex !== -1) return;

    const piece = game.get(from as any);
    const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';

    if (!piece || piece.color !== (game.turn() === 'w' ? 'w' : 'b') || currentTurnColor !== myColor) {
      setSelectedSquare(null);
      return;
    }

    try {
      const tempGame = new Chess(game.fen());
      const move = tempGame.move({ from, to, promotion: 'q' });

      if (move) {
        const timeTaken = Date.now() - moveStartTime.current;
        const uciMove = (move as any).uci || `${move.from}${move.to}${move.promotion || ''}`;

        if (gameId) {
          gameSocket.send('make_move', {
            game_id: gameId,
            move: uciMove,
            time_taken_ms: timeTaken,
            window_blurred: document.hidden,
            is_premove: false
          });
        }
        setSelectedSquare(null);
      }
    } catch {
      setSelectedSquare(null);
    }
    setDragState(null);
  };

  const handleSquareClick = (squareId: string) => {
    if (viewIndex !== -1 || gameOverResult) return;
    if (selectedSquare) {
      if (selectedSquare === squareId) {
        setSelectedSquare(null);
      } else {
        executeMove(selectedSquare, squareId);
      }
    } else {
      const piece = game.get(squareId as any);
      const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';
      if (piece && piece.color === (game.turn() === 'w' ? 'w' : 'b') && currentTurnColor === myColor) {
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

  const displayedRanks = myColor === 'black' ? ['1', '2', '3', '4', '5', '6', '7', '8'] : ['8', '7', '6', '5', '4', '3', '2', '1'];
  const displayedFiles = myColor === 'black' ? [...FILES].reverse() : FILES;

  const renderPieceSvg = (piece: { type: string; color: string }) => (
    <div className="relative w-full h-full pointer-events-none">
      <img
        src={`/assets/pieces/${piece.color}${piece.type.toUpperCase()}.svg`}
        className="absolute inset-0 w-full h-full z-10 object-contain"
        draggable={false}
        alt={`${piece.color} ${piece.type}`}
      />
      <div
        className={`absolute inset-0 z-20 mix-blend-color ${piece.color === 'w' ? 'bg-boxwood' : 'bg-acacia'}`}
        style={{
          WebkitMaskImage: `url(/assets/pieces/${piece.color}${piece.type.toUpperCase()}.svg)`,
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
        }}
      />
      <div
        className="absolute inset-0 z-30 mix-blend-multiply opacity-50"
        style={{
          backgroundImage: "url('/assets/textures/wood-grain.png')",
          WebkitMaskImage: `url(/assets/pieces/${piece.color}${piece.type.toUpperCase()}.svg)`,
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
        }}
      />
    </div>
  );

  if (!localStorage.getItem('token')) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-acacia rounded shadow-heavy border-4 border-acacia-dark text-boxwood-light text-center font-serif">
        <div className="text-xl font-bold mb-2">Требуется авторизация</div>
        <p className="text-sm text-boxwood/80 mb-4">Пожалуйста, войдите в систему в правом верхнем углу, чтобы играть.</p>
      </div>
    );
  }

  const filteredQueue = queuePlayers.filter(p => p.user_id !== currentUserId);

  return (
    <div className="flex flex-col xl:flex-row items-center xl:items-start justify-center gap-6 w-full max-w-7xl mx-auto font-serif relative">

      {dragState && (
        <div
          className="fixed pointer-events-none z-50 drop-shadow-[0_15px_15px_rgba(0,0,0,0.6)]"
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

      {/* Игроки и доска */}
      <div className="flex flex-col items-center gap-3">

        {/* Верхний игрок */}
        <div style={{ width: `${boardSize}px` }} className="bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-acacia flex items-center justify-center border border-amber-600/30 font-bold text-amber-200">
              ♟
            </div>
            <div>
              <div className="font-bold flex items-center gap-2">
                <span>{gameId ? topPlayerInfo.username : 'Ожидание...'}</span>
                {gameId && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20 flex items-center gap-1">
                    {topPlayerInfo.rating}
                    {ratingInfo && (
                      <span className={myColor === 'white' ? (Number(ratingInfo.black_delta) >= 0 ? 'text-emerald-400' : 'text-red-400') : (Number(ratingInfo.white_delta) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        ({myColor === 'white' ? (Number(ratingInfo.black_delta) >= 0 ? `+${ratingInfo.black_delta}` : ratingInfo.black_delta) : (Number(ratingInfo.white_delta) >= 0 ? `+${ratingInfo.white_delta}` : ratingInfo.white_delta)})
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="bg-[#1A120B] px-5 py-2 rounded-md border-2 border-amber-700/50 shadow-inner font-mono text-3xl font-bold tracking-wider text-amber-500 min-w-[150px] text-center">
            {gameId ? formatTime(topPlayerTime) : `${selectedTimeControl.base.toString().padStart(2, '0')}:00`}
          </div>
        </div>

        {/* ШАХМАТНАЯ ДОСКА */}
        <div
          style={{ width: `${boardSize}px`, height: `${boardSize}px` }}
          className="p-4 bg-acacia-dark rounded-sm shadow-heavy border-4 border-black/80 relative transition-all"
        >
          <div
            className="absolute inset-0 opacity-40 mix-blend-multiply pointer-events-none"
            style={{ backgroundImage: "url('/assets/textures/wood-grain.png')" }}
          />

          <div className="grid grid-cols-8 grid-rows-8 w-full h-full border-2 border-room-dark relative z-10 shadow-inner-board">
            {displayedRanks.map((rank) =>
              displayedFiles.map((file) => {
                const rIdx = RANKS.indexOf(rank);
                const fIdx = FILES.indexOf(file);
                const isDark = (rIdx + fIdx) % 2 !== 0;
                const squareId = `${file}${rank}`;

                const piece = boardState[rIdx][fIdx];

                const isSelected = selectedSquare === squareId;
                const isBeingDragged = dragState?.from === squareId;

                return (
                  <div
                    key={squareId}
                    data-square={squareId}
                    onClick={() => handleSquareClick(squareId)}
                    className={`w-full h-full flex items-center justify-center relative cursor-pointer ${isDark ? 'bg-acacia' : 'bg-boxwood'}`}
                  >
                    {isDark ? (
                      <div className="absolute inset-0 bg-black/10 pointer-events-none" />
                    ) : (
                      <div className="absolute inset-0 bg-white/20 pointer-events-none" />
                    )}

                    {isSelected && (
                      <div className="absolute inset-0 bg-yellow-500/30 z-10 pointer-events-none" />
                    )}

                    <div
                      className="absolute inset-0 opacity-40 mix-blend-multiply pointer-events-none"
                      style={{ backgroundImage: "url('/assets/textures/wood-grain.png')" }}
                    />

                    <div className="absolute inset-0 shadow-[inset_0_0_12px_rgba(0,0,0,0.3)] pointer-events-none" />

                    {piece && !isBeingDragged && (
                      <div
                        onMouseDown={(e) => {
                          if (viewIndex !== -1 || gameOverResult) return;
                          if (piece.color !== (currentGame.turn() === 'w' ? 'w' : 'b')) return;
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
                        className={`relative w-full h-full p-[2%] z-20 drop-shadow-[0_0_1px_rgba(255,255,255,0.4)] drop-shadow-[0_6px_6px_rgba(0,0,0,0.7)] ${piece.color === (currentGame.turn() === 'w' ? 'w' : 'b') && viewIndex === -1 && !gameOverResult ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        {renderPieceSvg(piece)}
                      </div>
                    )}

                    {file === displayedFiles[0] && (
                      <span className={`absolute top-1 left-1 text-[10px] sm:text-xs font-bold opacity-70 z-20 pointer-events-none ${isDark ? 'text-boxwood' : 'text-acacia-dark'}`}>
                        {rank}
                      </span>
                    )}
                    {rank === displayedRanks[7] && (
                      <span className={`absolute bottom-0 right-1 text-[10px] sm:text-xs font-bold opacity-70 z-20 pointer-events-none ${isDark ? 'text-boxwood' : 'text-acacia-dark'}`}>
                        {file}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Нижний игрок */}
        <div style={{ width: `${boardSize}px` }} className="bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-boxwood flex items-center justify-center border border-amber-600/30 font-bold text-acacia-dark">
              ♙
            </div>
            <div>
              <div className="font-bold flex items-center gap-2">
                <span>{gameId ? bottomPlayerInfo.username : 'Вы'}</span>
                {gameId && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20 flex items-center gap-1">
                    {bottomPlayerInfo.rating}
                    {ratingInfo && (
                      <span className={myColor === 'white' ? (Number(ratingInfo.white_delta) >= 0 ? 'text-emerald-400' : 'text-red-400') : (Number(ratingInfo.black_delta) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        ({myColor === 'white' ? (Number(ratingInfo.white_delta) >= 0 ? `+${ratingInfo.white_delta}` : ratingInfo.white_delta) : (Number(ratingInfo.black_delta) >= 0 ? `+${ratingInfo.black_delta}` : ratingInfo.black_delta)})
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="bg-[#1A120B] px-5 py-2 rounded-md border-2 border-amber-700/50 shadow-inner font-mono text-3xl font-bold tracking-wider text-amber-500 min-w-[150px] text-center">
            {gameId ? formatTime(bottomPlayerTime) : `${selectedTimeControl.base.toString().padStart(2, '0')}:00`}
          </div>
        </div>

      </div>

      {/* Правая панель управления / Лобби вызовов */}
      <div className="w-full xl:w-96 bg-acacia p-5 rounded shadow-heavy border-4 border-acacia-dark flex flex-col gap-4 text-boxwood-light">

        <div className="border-b border-acacia-light pb-3 flex justify-between items-center">
          <div>
            <div className="text-xs tracking-widest uppercase text-boxwood/70">Рейтинговая партия</div>
            <div className="text-sm font-bold flex items-center gap-2 mt-1 font-mono">
              <span className="text-xs text-boxwood/70 uppercase font-serif">Сессия:</span>
              <span className="text-emerald-400">+{sessionStats.wins}</span>
              <span className="text-red-400">-{sessionStats.losses}</span>
              <span className="text-gray-300">={sessionStats.draws}</span>
            </div>
          </div>
          <div className="p-2 bg-acacia-dark rounded border border-amber-600/30 text-amber-400">
            <Sword size={18} />
          </div>
        </div>

        {drawOfferStatus && (
          <div className="bg-amber-950/90 p-2.5 rounded border border-amber-600/50 text-xs text-amber-200 text-center flex flex-col gap-2">
            <span>{drawOfferStatus}</span>
            {drawOfferStatus.includes('предлагает ничью') && (
              <div className="flex justify-center gap-2">
                <button onClick={acceptDraw} className="px-3 py-1 bg-emerald-800 text-white rounded text-xs font-bold">Принять</button>
                <button onClick={declineDraw} className="px-3 py-1 bg-red-800 text-white rounded text-xs font-bold">Отклонить</button>
              </div>
            )}
          </div>
        )}

        {!gameId ? (
          <div className="flex flex-col min-h-[16rem] bg-acacia-dark rounded border border-amber-900/40 p-3 shadow-inner relative">
            <div className="text-xs font-bold text-amber-200 mb-2 flex items-center justify-between z-10">
              <span>Открытые вызовы в лобби</span>
              {isSearching && <Loader2 className="animate-spin text-amber-400" size={14} />}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 text-xs font-mono mb-2 z-10 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
              {filteredQueue.length === 0 ? (
                <div className="p-3 text-boxwood/60 text-center flex flex-col items-center gap-1">
                  <span>{isSearching ? 'Вы в очереди. Ожидание соперников...' : 'Лобби пусто. Создайте вызов кнопкой ниже.'}</span>
                </div>
              ) : (
                filteredQueue.map((p) => (
                  <div key={p.user_id} className="p-2 bg-black/40 rounded border border-amber-600/30 flex justify-between items-center">
                    <div>
                      <span className="text-amber-300 font-bold">{p.username}</span>
                      <div className="text-[10px] text-boxwood/70">Рейтинг: {p.rating} | {p.base_time_ms / 60000} мин {p.increment_ms > 0 ? `+ ${p.increment_ms / 1000} сек` : ''}</div>
                    </div>
                    <button
                      onClick={() => acceptChallenge(p.user_id)}
                      className="px-2.5 py-1 bg-emerald-800 hover:bg-emerald-700 text-emerald-100 rounded text-xs font-bold transition flex items-center gap-1 shadow"
                    >
                      <Play size={12} /> Играть
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Кастомный выбор контроля времени перед поиском */}
            {!isSearching && (
              <div className="flex flex-col gap-1.5 mt-auto pt-2 border-t border-amber-900/40 relative z-20">
                <label className="text-[10px] uppercase tracking-widest text-boxwood/60 flex items-center gap-1">
                  <Clock size={12} /> Контроль времени
                </label>

                <div className="relative w-full" ref={timeDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsTimeDropdownOpen(!isTimeDropdownOpen)}
                    className="w-full bg-black/40 border border-amber-700/50 hover:bg-black/60 transition text-amber-200 rounded p-2 text-xs font-bold outline-none cursor-pointer flex justify-between items-center shadow-inner"
                  >
                    <span>
                      {selectedTimeControl.base} мин {selectedTimeControl.inc > 0 ? `+ ${selectedTimeControl.inc} сек` : ''}
                    </span>
                    {isTimeDropdownOpen ? <ChevronUp size={14} className="text-amber-500/70" /> : <ChevronDown size={14} className="text-amber-500/70" />}
                  </button>

                  {/* Выпадающее меню вверх */}
                  {isTimeDropdownOpen && (
                    <div className="absolute z-50 w-full bottom-full mb-1 bg-[#1A120B] border border-amber-700/50 rounded shadow-2xl max-h-56 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-black/20 [&::-webkit-scrollbar-thumb]:bg-amber-900/50 overflow-x-hidden">
                      {TIME_CONTROLS.map((group, gIdx) => (
                        <div key={gIdx}>
                          <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-amber-500/60 bg-black/60 font-bold sticky top-0 z-10 border-b border-t border-amber-900/30 first:border-t-0 backdrop-blur-sm">
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
                                  setSelectedTimeControl({ base: opt.base, inc: opt.inc });
                                  setIsTimeDropdownOpen(false);
                                }}
                              >
                                <span>{opt.label}</span>
                                {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]" />}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {isSearching && (
              <button
                onClick={cancelMatchmaking}
                className="mt-2 py-1.5 bg-red-950/80 hover:bg-red-900 text-red-200 rounded text-xs font-bold border border-red-800/50 transition z-10 relative"
              >
                Отменить поиск
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-56 bg-[#F5DEB3]/10 rounded border border-amber-900/40 overflow-hidden shadow-inner">
            <div className="bg-acacia-dark px-3 py-2 text-xs font-bold text-amber-200 border-b border-amber-900/40 flex justify-between truncate">
              <span className="truncate">{whitePlayer.username} ({whitePlayer.rating}) - {blackPlayer.username} ({blackPlayer.rating})</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 font-mono text-sm space-y-1">
              {history.reduce((acc: any[], move: any, index: number) => {
                if (index % 2 === 0) {
                  acc.push({ white: move.san, black: '' });
                } else {
                  acc[acc.length - 1].black = move.san;
                }
                return acc;
              }, []).map((pair: any, idx: number) => (
                <div key={idx} className="flex px-2 py-1 hover:bg-black/20 rounded text-amber-100/90">
                  <span className="w-10 text-amber-500/70 font-bold">{idx + 1}.</span>
                  <span className="w-28">{pair.white}</span>
                  <span className="w-28">{pair.black}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleResign}
            disabled={!gameId || !!gameOverResult}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/80 text-red-200 text-xs font-bold rounded hover:bg-red-900 transition shadow border border-red-800/50 disabled:opacity-50"
          >
            <Flag size={14} />
            Сдаться
          </button>
          <button
            onClick={handleOfferDraw}
            disabled={!gameId || !!gameOverResult}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs font-bold rounded hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-50"
          >
            <Handshake size={14} />
            Ничья
          </button>
        </div>

        <div className="flex justify-between items-center bg-acacia-dark p-2 rounded border border-amber-900/40">
          <span className="text-xs text-boxwood/70">Просмотр:</span>
          <div className="flex gap-1">
            <button onClick={() => setViewIndex(-2)} className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"><ChevronFirst size={16} /></button>
            <button onClick={() => {
              if (history.length > 0) {
                const current = viewIndex === -1 ? history.length - 1 : viewIndex;
                setViewIndex(current === 0 ? -2 : Math.max(-2, current - 1));
              }
            }} className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"><ChevronLeft size={16} /></button>
            <button onClick={() => {
              if (viewIndex !== -1 && viewIndex < history.length - 1) {
                setViewIndex(viewIndex + 1);
              } else if (viewIndex === -2 && history.length > 0) {
                setViewIndex(0);
              } else {
                setViewIndex(-1);
              }
            }} className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"><ChevronRight size={16} /></button>
            <button onClick={() => setViewIndex(-1)} className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"><ChevronLast size={16} /></button>
          </div>
        </div>

        <div className="bg-acacia-dark p-3 rounded border border-amber-900/40 flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs text-boxwood/80">
            <span className="flex items-center gap-1"><Sliders size={14} /> Размер доски</span>
            <span>{boardSize}px</span>
          </div>
          <input
            type="range"
            min="400"
            max="720"
            step="20"
            value={boardSize}
            onChange={(e) => setBoardSize(Number(e.target.value))}
            className="w-full accent-amber-600 cursor-pointer"
          />
        </div>

        {gameOverResult ? (
          <button
            onClick={() => {
              setGameId(null);
              setGameOverResult(null);
              setRatingInfo(null);
              setGame(new Chess());
              setHistory([]);
            }}
            className="flex items-center justify-center gap-2 px-4 py-3 font-bold rounded transition shadow bg-boxwood text-acacia-dark border border-amber-700/50 hover:bg-boxwood-light"
          >
            <RotateCcw size={18} /> Новая игра / В лобби
          </button>
        ) : (
          !gameId && (
            <button
              onClick={isSearching ? cancelMatchmaking : startMatchmaking}
              className={`flex items-center justify-center gap-2 px-4 py-3 font-bold rounded transition shadow border ${
                isSearching 
                  ? 'bg-red-900/80 text-red-100 border-red-700 hover:bg-red-900' 
                  : 'bg-boxwood text-acacia-dark border-amber-700/50 hover:bg-boxwood-light'
              }`}
            >
              {isSearching ? <Loader2 className="animate-spin" size={18} /> : <Users size={18} />}
              {isSearching ? 'Отменить вызов' : 'Найти соперника'}
            </button>
          )
        )}

      </div>

    </div>
  );
}