import React, { useState, useEffect } from 'react';
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
  Handshake
} from 'lucide-react';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const PIECE_VALUES: { [key: string]: number } = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0
};

export default function Chessboard() {
  const [game, setGame] = useState(new Chess());
  const [history, setHistory] = useState<any[]>([]);
  const [viewIndex, setViewIndex] = useState<number>(-1); // -1 — актуальная позиция
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  // Состояние для кастомного перетаскивания мышкой (Drag & Drop)
  const [dragState, setDragState] = useState<{
    from: string;
    piece: { type: string; color: string };
    x: number;
    y: number;
  } | null>(null);

  // Динамический максимальный размер доски под экран по умолчанию
  const [boardSize, setBoardSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const calculated = window.innerHeight - 260;
      return Math.min(Math.max(calculated, 400), 720);
    }
    return 540;
  });

  // Таймеры игроков (5 минут = 300 секунд)
  const [whiteTime, setWhiteTime] = useState(300);
  const [blackTime, setBlackTime] = useState(300);
  const [isTimerActive, setIsTimerActive] = useState(false);

  // Статистика матчей (H2H) и результаты
  const [h2h, setH2h] = useState({ whiteWins: 12, blackWins: 5, draws: 4 });
  const [gameOverResult, setGameOverResult] = useState<string | null>(null);

  // Уведомления о ничьей
  const [drawOfferStatus, setDrawOfferStatus] = useState<string | null>(null);

  // Управление таймером
  useEffect(() => {
    let interval: any = null;
    const activeGame = getGameAtViewIndex(viewIndex);

    if (isTimerActive && !activeGame.isGameOver() && !gameOverResult) {
      interval = setInterval(() => {
        if (activeGame.turn() === 'w') {
          setWhiteTime((t) => (t > 0 ? t - 1 : 0));
        } else {
          setBlackTime((t) => (t > 0 ? t - 1 : 0));
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerActive, game, viewIndex, gameOverResult]);

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
          handleMove(dragState.from, targetSquare);
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
  }, [dragState, game, history, viewIndex]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const playAudio = (type: 'move' | 'capture' | 'start') => {
    const file = type === 'capture' ? 'Capture.mp3' : type === 'start' ? 'GenericNotify.mp3' : 'Move.mp3';
    const audio = new Audio(`/assets/sounds/${file}`);
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };

  const startNewGame = () => {
    const newGame = new Chess();
    setGame(newGame);
    setHistory([]);
    setViewIndex(-1);
    setSelectedSquare(null);
    setDragState(null);
    setWhiteTime(300);
    setBlackTime(300);
    setIsTimerActive(false);
    setGameOverResult(null);
    setDrawOfferStatus(null);
    playAudio('start');
  };

  // Логика сдачи партии
  const handleResign = () => {
    if (gameOverResult) return;
    const resigningPlayer = currentGame.turn() === 'w' ? 'Белые (Mykhailo_T)' : 'Чёрные (Grandmaster_A)';
    if (window.confirm(`${resigningPlayer}, вы действительно хотите сдаться?`)) {
      const winner = currentGame.turn() === 'w' ? 'black' : 'white';
      setGameOverResult(winner);
      setIsTimerActive(false);
      if (winner === 'white') setH2h(h => ({ ...h, whiteWins: h.whiteWins + 1 }));
      else setH2h(h => ({ ...h, blackWins: h.blackWins + 1 }));
      setDrawOfferStatus('Партия завершена сдачей.');
    }
  };

  // Логика предложения ничьей
  const handleOfferDraw = () => {
    if (gameOverResult || viewIndex !== -1) return;
    const offeringColor = currentGame.turn() === 'w' ? 'Белые' : 'Чёрные';
    setDrawOfferStatus(`${offeringColor} предложили ничью. Ожидание ответа...`);

    setTimeout(() => {
      if (Math.random() > 0.5) {
        setDrawOfferStatus('Соперник согласился на ничью. Ничья!');
        setGameOverResult('draw');
        setIsTimerActive(false);
        setH2h(h => ({ ...h, draws: h.draws + 1 }));
      } else {
        setDrawOfferStatus('Соперник отклонил предложение ничьей.');
        setTimeout(() => setDrawOfferStatus(null), 3000);
      }
    }, 3000);
  };

  const getGameAtViewIndex = (index: number) => {
    const tempGame = new Chess();
    if (index === -2) return tempGame;
    const limit = index === -1 ? history.length - 1 : index;
    for (let i = 0; i <= limit; i++) {
      if (history[i]) tempGame.move(history[i]);
    }
    return tempGame;
  };

  const currentGame = getGameAtViewIndex(viewIndex);
  const boardState = currentGame.board();

  const getMaterialDifference = () => {
    let whiteScore = 0;
    let blackScore = 0;

    boardState.forEach((row) => {
      row.forEach((piece) => {
        if (piece) {
          const val = PIECE_VALUES[piece.type] || 0;
          if (piece.color === 'w') whiteScore += val;
          else blackScore += val;
        }
      });
    });

    const diff = whiteScore - blackScore;
    if (diff > 0) return { white: `+${diff}`, black: '' };
    if (diff < 0) return { white: '', black: `+${Math.abs(diff)}` };
    return { white: '', black: '' };
  };

  const materialDiff = getMaterialDifference();

  const handleMove = (from: string, to: string) => {
    if (viewIndex !== -1 || gameOverResult) return;

    try {
      const gameCopy = new Chess(game.fen());
      const move = gameCopy.move({ from, to, promotion: 'q' });

      if (move) {
        setGame(gameCopy);
        const newHistory = [...history, move];
        setHistory(newHistory);
        setViewIndex(-1);
        setSelectedSquare(null);
        setDragState(null);
        setIsTimerActive(true);

        if (move.flags.includes('c') || move.flags.includes('e')) {
          playAudio('capture');
        } else {
          playAudio('move');
        }

        if (gameCopy.isGameOver()) {
          setIsTimerActive(false);
          if (gameCopy.isCheckmate()) {
            const winner = gameCopy.turn() === 'w' ? 'black' : 'white';
            setGameOverResult(winner);
            if (winner === 'white') setH2h(h => ({ ...h, whiteWins: h.whiteWins + 1 }));
            else setH2h(h => ({ ...h, blackWins: h.blackWins + 1 }));
          } else {
            setGameOverResult('draw');
            setH2h(h => ({ ...h, draws: h.draws + 1 }));
          }
        }
      }
    } catch (e) {
      const targetPiece = currentGame.get(to as any);
      if (targetPiece && targetPiece.color === currentGame.turn()) {
        setSelectedSquare(to);
      } else {
        setSelectedSquare(null);
      }
    }
    setDragState(null);
  };

  const handleSquareClick = (squareId: string) => {
    if (viewIndex !== -1 || gameOverResult) return;
    if (selectedSquare) {
      if (selectedSquare === squareId) {
        setSelectedSquare(null);
      } else {
        handleMove(selectedSquare, squareId);
      }
    } else {
      const piece = currentGame.get(squareId as any);
      if (piece && piece.color === currentGame.turn()) {
        setSelectedSquare(squareId);
      }
    }
  };

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

      {/* ПЛАВАЮЩАЯ ФИГУРА ПОД КУРСОРОМ */}
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

        {/* Игрок 1 (Чёрные сверху) */}
        <div style={{ width: `${boardSize}px` }} className="bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-acacia flex items-center justify-center border border-amber-600/30 font-bold text-amber-200">
              ♟
            </div>
            <div>
              <div className="font-bold flex items-center gap-2">
                <span>Grandmaster_A</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20">
                  2144 {gameOverResult && <span className="text-emerald-400">{gameOverResult === 'black' ? '+8' : '-8'}</span>}
                </span>
              </div>
              {materialDiff.black && (
                <div className="text-xs text-boxwood/75">
                  Преимущество: <span className="text-amber-200 font-bold">{materialDiff.black}</span>
                </div>
              )}
            </div>
          </div>
          <div className="bg-[#1A120B] px-4 py-1.5 rounded border-2 border-amber-700/50 shadow-inner font-mono text-xl tracking-wider text-amber-500">
            {formatTime(blackTime)}
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
            {RANKS.map((rank, rankIndex) =>
              FILES.map((file, fileIndex) => {
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

        {/* Игрок 2 (Белые снизу) */}
        <div style={{ width: `${boardSize}px` }} className="bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-boxwood flex items-center justify-center border border-amber-600/30 font-bold text-acacia-dark">
              ♙
            </div>
            <div>
              <div className="font-bold flex items-center gap-2">
                <span>Mykhailo_T</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20">
                  1996 {gameOverResult && <span className="text-emerald-400">{gameOverResult === 'white' ? '+8' : '-8'}</span>}
                </span>
              </div>
              {materialDiff.white && (
                <div className="text-xs text-boxwood/75">
                  Преимущество: <span className="text-amber-200 font-bold">{materialDiff.white}</span>
                </div>
              )}
            </div>
          </div>
          <div className="bg-[#1A120B] px-4 py-1.5 rounded border-2 border-amber-700/50 shadow-inner font-mono text-xl tracking-wider text-amber-500">
            {formatTime(whiteTime)}
          </div>
        </div>

      </div>

      {/* ПРАВАЯ ПАНЕЛЬ: Журнал ходов, навигация, управление */}
      <div className="w-full xl:w-96 bg-acacia p-5 rounded shadow-heavy border-4 border-acacia-dark flex flex-col gap-4 text-boxwood-light">

        {/* Шапка матча и H2H счет (+12 -5 =4) */}
        <div className="border-b border-acacia-light pb-3 flex justify-between items-center">
          <div>
            <div className="text-xs tracking-widest uppercase text-boxwood/70">Классическая партия</div>
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

        {/* Уведомление о ничьей / статусе партии */}
        {drawOfferStatus && (
          <div className="bg-amber-950/80 p-2.5 rounded border border-amber-600/50 text-xs text-amber-200 text-center animate-pulse">
            {drawOfferStatus}
          </div>
        )}

        {/* Журнал ходов с никнеймами в шапке */}
        <div className="flex flex-col h-64 bg-[#F5DEB3]/10 rounded border border-amber-900/40 overflow-hidden shadow-inner">
          <div className="bg-acacia-dark px-3 py-2 text-xs font-bold text-amber-200 border-b border-amber-900/40 flex justify-between truncate">
            <span className="truncate">Grandmaster_A (2144) - Mykhailo_T (1996)</span>
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

        {/* Кнопки управления игрой: Сдаться и Предложить ничью */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleResign}
            disabled={!!gameOverResult}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/80 text-red-200 text-xs font-bold rounded hover:bg-red-900 transition shadow border border-red-800/50 disabled:opacity-50"
          >
            <Flag size={14} />
            Сдаться
          </button>
          <button
            onClick={handleOfferDraw}
            disabled={!!gameOverResult}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs font-bold rounded hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-50"
          >
            <Handshake size={14} />
            Ничья
          </button>
        </div>

        {/* Навигационные стрелки для полного просмотра партии */}
        <div className="flex justify-between items-center bg-acacia-dark p-2 rounded border border-amber-900/40">
          <span className="text-xs text-boxwood/70">Просмотр:</span>
          <div className="flex gap-1">
            <button
              onClick={() => setViewIndex(-2)}
              title="В самое начало партии (стартовая позиция)"
              className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"
            >
              <ChevronFirst size={16} />
            </button>
            <button
              onClick={() => {
                if (history.length > 0) {
                  const current = viewIndex === -1 ? history.length - 1 : viewIndex;
                  const target = current === 0 ? -2 : Math.max(-2, current - 1);
                  setViewIndex(target);
                }
              }}
              title="На один ход назад"
              className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => {
                if (viewIndex !== -1 && viewIndex < history.length - 1) {
                  setViewIndex(viewIndex + 1);
                } else if (viewIndex === -2 && history.length > 0) {
                  setViewIndex(0);
                } else {
                  setViewIndex(-1);
                }
              }}
              title="На один ход вперёд"
              className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setViewIndex(-1)}
              title="В самый конец (актуальная позиция)"
              className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"
            >
              <ChevronLast size={16} />
            </button>
          </div>
        </div>

        {/* Регулятор размера доски (справа внизу) */}
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

        {/* Кнопки управления */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={startNewGame}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-boxwood text-acacia-dark font-bold rounded hover:bg-boxwood-light transition shadow border border-amber-700/50"
          >
            <RotateCcw size={16} />
            Новая игра
          </button>
          <button
            onClick={() => alert('Поиск нового соперника...')}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-acacia-dark text-boxwood-light font-bold rounded hover:bg-black/50 transition shadow border border-amber-700/30"
          >
            <Users size={16} />
            Соперник
          </button>
        </div>

      </div>

    </div>
  );
}