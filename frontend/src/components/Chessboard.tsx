import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import {
  RotateCcw,
  ChevronFirst,
  ChevronLeft,
  ChevronRight,
  ChevronLast,
  Users,
  Sword,
  Sliders,
  Flag,
  Handshake,
  Loader2
} from 'lucide-react';
import { gameSocket } from '../services/gameSocket';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const PIECE_VALUES: { [key: string]: number } = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0
};

export default function Chessboard() {
  const [game, setGame] = useState(new Chess());
  const [history, setHistory] = useState<any[]>([]);
  const [viewIndex, setViewIndex] = useState<number>(-1);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  // Мультиплеерные состояния
  const [gameId, setGameId] = useState<number | null>(null);
  const [myColor, setMyColor] = useState<'white' | 'black'>('white');
  const [isSearching, setIsSearching] = useState(false);
  const [, setOpponentConnected] = useState(false);

  const moveStartTime = useRef<number>(Date.now());

  // Состояние для кастомного перетаскивания мышкой (Drag & Drop)
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

  // Таймеры игроков в миллисекундах
  const [whiteTimeMs, setWhiteTimeMs] = useState(180000);
  const [blackTimeMs, setBlackTimeMs] = useState(180000);

  const [h2h] = useState({ whiteWins: 12, blackWins: 5, draws: 4 });
  const [gameOverResult, setGameOverResult] = useState<string | null>(null);
  const [drawOfferStatus, setDrawOfferStatus] = useState<string | null>(null);

  // Данные игроков для шапки (Белые всегда первыми)
  const whitePlayerInfo = {
    username: myColor === 'white' ? 'Mykhailo_T' : 'Grandmaster_A',
    rating: myColor === 'white' ? '1996' : '2144'
  };
  const blackPlayerInfo = {
    username: myColor === 'white' ? 'Grandmaster_A' : 'Mykhailo_T',
    rating: myColor === 'white' ? '2144' : '1996'
  };

  // Подключение к WebSocket при монтировании компонента
  useEffect(() => {
    const token = localStorage.getItem('token') || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwbGF5ZXIxIiwiZXhwIjoxNzg1OTY5MjQwfQ.NHjXmbJAmHcd_WhRE2ni0EhVYefuPb2HX925cRQMgX8";
    gameSocket.connect(token);

    const handleMatchFound = (data: any) => {
      setIsSearching(false);
      setGameId(data.game_id);
      setMyColor(data.color);
      setOpponentConnected(true);
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
      }
    };

    const handleGameOver = (data: any) => {
      setGameOverResult(data.result);
      if (data.white_new_rating) {
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
      gameSocket.disconnect();
    };
  }, []);

  // Глобальные слушатели мыши для перетаскивания фигуры за курсором
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
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const playAudio = (type: 'move' | 'capture' | 'start') => {
    const file = type === 'capture' ? 'Capture.mp3' : type === 'start' ? 'GenericNotify.mp3' : 'Move.mp3';
    const audio = new Audio(`/assets/sounds/${file}`);
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };

  const startMatchmaking = () => {
    setIsSearching(true);
    setDrawOfferStatus('Поиск достойного соперника в очереди...');
    gameSocket.send('join_queue', { base_time_ms: 180000, increment_ms: 0 });
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
    setDrawOfferStatus('Вы предложили ничью. Ожидание ответа...');
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
    if (!piece || piece.color !== game.turn() || currentTurnColor !== myColor) {
      setSelectedSquare(null);
      return;
    }

    try {
      const tempGame = new Chess(game.fen());
      const move = tempGame.move({ from, to, promotion: 'q' });

      if (move) {
        const timeTaken = Date.now() - moveStartTime.current;

        if (gameId) {
          gameSocket.send('make_move', {
            game_id: gameId,
            move: move.uci,
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
      if (piece && piece.color === game.turn() && currentTurnColor === myColor) {
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

  const displayedRanks = myColor === 'black' ? [...RANKS].reverse() : RANKS;
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

      {/* ЛЕВАЯ / ЦЕНТРАЛЬНАЯ ЧАСТЬ: Игроки и доска */}
      <div className="flex flex-col items-center gap-3">

        {/* Игрок сверху (Черные, если вы белые, или наоборот) */}
        <div style={{ width: `${boardSize}px` }} className="bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-acacia flex items-center justify-center border border-amber-600/30 font-bold text-amber-200">
              ♟
            </div>
            <div>
              <div className="font-bold flex items-center gap-2">
                <span>{blackPlayerInfo.username}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20">
                  {blackPlayerInfo.rating}
                </span>
              </div>
            </div>
          </div>
          <div className="bg-[#1A120B] px-4 py-1.5 rounded border-2 border-amber-700/50 shadow-inner font-mono text-xl tracking-wider text-amber-500">
            {formatTime(myColor === 'white' ? blackTimeMs : whiteTimeMs)}
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
            {displayedRanks.map((rank, rankIndex) =>
              displayedFiles.map((file, fileIndex) => {
                const isDark = (rankIndex + fileIndex) % 2 !== 0;
                const squareId = `${file}${rank}`;
                const piece = boardState[rankIndex][fileIndex];
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
                          if (piece.color !== currentGame.turn()) return;
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
                        className={`relative w-full h-full p-[2%] z-20 drop-shadow-[0_0_1px_rgba(255,255,255,0.4)] drop-shadow-[0_6px_6px_rgba(0,0,0,0.7)] ${piece.color === currentGame.turn() && viewIndex === -1 && !gameOverResult ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        {renderPieceSvg(piece)}
                      </div>
                    )}

                    {fileIndex === 0 && (
                      <span className={`absolute top-1 left-1 text-[10px] sm:text-xs font-bold opacity-70 z-20 pointer-events-none ${isDark ? 'text-boxwood' : 'text-acacia-dark'}`}>
                        {rank}
                      </span>
                    )}
                    {rankIndex === 7 && (
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

        {/* Игрок снизу (Белые, если вы белые, или наоборот) */}
        <div style={{ width: `${boardSize}px` }} className="bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-boxwood flex items-center justify-center border border-amber-600/30 font-bold text-acacia-dark">
              ♙
            </div>
            <div>
              <div className="font-bold flex items-center gap-2">
                <span>{whitePlayerInfo.username}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20">
                  {whitePlayerInfo.rating}
                </span>
              </div>
            </div>
          </div>
          <div className="bg-[#1A120B] px-4 py-1.5 rounded border-2 border-amber-700/50 shadow-inner font-mono text-xl tracking-wider text-amber-500">
            {formatTime(myColor === 'white' ? whiteTimeMs : blackTimeMs)}
          </div>
        </div>

      </div>

      {/* ПРАВАЯ ПАНЕЛЬ: Журнал ходов (Белые — Черные), навигация, управление */}
      <div className="w-full xl:w-96 bg-acacia p-5 rounded shadow-heavy border-4 border-acacia-dark flex flex-col gap-4 text-boxwood-light">

        <div className="border-b border-acacia-light pb-3 flex justify-between items-center">
          <div>
            <div className="text-xs tracking-widest uppercase text-boxwood/70">Рейтинговая партия</div>
            <div className="text-sm font-bold flex items-center gap-2 mt-1 font-mono">
              <span className="text-xs text-boxwood/70 uppercase font-serif">Счёт:</span>
              <span className="text-emerald-400">+{h2h.whiteWins}</span>
              <span className="text-red-400">-{h2h.blackWins}</span>
              <span className="text-gray-300">={h2h.draws}</span>
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

        {/* Журнал ходов с правильным порядком: Белые — Черные */}
        <div className="flex flex-col h-56 bg-[#F5DEB3]/10 rounded border border-amber-900/40 overflow-hidden shadow-inner">
          <div className="bg-acacia-dark px-3 py-2 text-xs font-bold text-amber-200 border-b border-amber-900/40 flex justify-between truncate">
            <span className="truncate">{whitePlayerInfo.username} ({whitePlayerInfo.rating}) - {blackPlayerInfo.username} ({blackPlayerInfo.rating})</span>
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

        <button
          onClick={startMatchmaking}
          disabled={isSearching || (!!gameId && !gameOverResult)}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-boxwood text-acacia-dark font-bold rounded hover:bg-boxwood-light transition shadow border border-amber-700/50 disabled:opacity-50"
        >
          {isSearching ? <Loader2 className="animate-spin" size={18} /> : <Users size={18} />}
          {isSearching ? 'Поиск соперника...' : 'Найти соперника'}
        </button>

      </div>

    </div>
  );
}