// --- FILE: frontend/src/components/GameViewer.tsx ---

import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import {
  ChevronFirst,
  ChevronLeft,
  ChevronRight,
  ChevronLast,
  ArrowLeft,
  Download,
  Loader2,
  Sword,
  RefreshCw // <-- Иконка переворота доски
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export default function GameViewer() {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const gameDataFromState = location.state?.game;

  //const [game, setGame] = useState(new Chess());
  const [history, setHistory] = useState<any[]>([]);

  // -1 = Самое начало партии (0 ходов).
  // history.length - 1 = Конец партии.
  const [viewIndex, setViewIndex] = useState<number>(-1);
  const [isFlipped, setIsFlipped] = useState(false); // Состояние переворота доски

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const boardSize = 540;
  const notationScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadGame = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/v1/profile/games/${gameId}/pgn`);
        if (!res.ok) throw new Error('Не удалось загрузить данные партии');

        const pgnText = await res.text();
        const newGame = new Chess();
        newGame.loadPgn(pgnText);

        //setGame(newGame);
        setHistory(newGame.history({ verbose: true }));
        setViewIndex(-1); // При загрузке строго в начало партии!
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (gameId) loadGame();
  }, [gameId]);

  // Управление с клавиатуры
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewIndex(p => Math.max(-1, p - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewIndex(p => Math.min(history.length - 1, p + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setViewIndex(-1); // В начало
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setViewIndex(history.length - 1); // В конец
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history]);

  // Автоскролл нотации к активному ходу
  useEffect(() => {
    if (notationScrollRef.current) {
      const activeElement = notationScrollRef.current.querySelector('.active-move');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [viewIndex]);

  // Вычисляем положение фигур на доске до выбранного хода
  const currentGame = new Chess();
  for (let i = 0; i <= viewIndex; i++) {
    if (history[i]) currentGame.move(history[i]);
  }
  const boardState = currentGame.board();

  // Отрисовка фигур
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

  // Данные игроков из State роутера
  const whiteName = gameDataFromState?.white_username || 'Белые';
  const whiteRating = gameDataFromState?.white_rating || '?';
  const blackName = gameDataFromState?.black_username || 'Черные';
  const blackRating = gameDataFromState?.black_rating || '?';
  const resultStr = gameDataFromState?.result || '*';

  // Логика переворота
  const displayedRanks = isFlipped ? [...RANKS].reverse() : RANKS;
  const displayedFiles = isFlipped ? [...FILES].reverse() : FILES;

  const topName = isFlipped ? whiteName : blackName;
  const topRating = isFlipped ? whiteRating : blackRating;
  const bottomName = isFlipped ? blackName : whiteName;
  const bottomRating = isFlipped ? blackRating : whiteRating;

  const TopIcon = isFlipped ? '♙' : '♟';
  const BottomIcon = isFlipped ? '♟' : '♙';

  const topIconBg = isFlipped ? 'bg-boxwood text-acacia-dark' : 'bg-acacia text-amber-200';
  const bottomIconBg = isFlipped ? 'bg-acacia text-amber-200' : 'bg-boxwood text-acacia-dark';

  let displayDate = 'Неизвестная дата';
  if (gameDataFromState?.pgn_date && !gameDataFromState.pgn_date.includes('????')) {
    displayDate = gameDataFromState.pgn_date.replace(/\??/g, '').replace(/\.$/, '');
  } else if (gameDataFromState?.finished_at) {
    displayDate = format(parseISO(gameDataFromState.finished_at), 'd MMM yyyy', { locale: ru });
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full text-boxwood-light font-serif">
        <Loader2 className="animate-spin text-amber-500 mb-4" size={40} />
        <div>Загрузка доски...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/80 border border-red-800 p-6 rounded text-red-200 text-center font-serif">
        <h2 className="text-xl font-bold mb-2">Ошибка</h2>
        <p>{error}</p>
        <button onClick={() => window.history.back()} className="mt-4 inline-block px-4 py-2 bg-black/40 rounded hover:bg-black/60 transition text-amber-400 border border-amber-900/50">Вернуться</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col xl:flex-row items-center xl:items-start justify-center gap-6 w-full max-w-7xl mx-auto font-serif relative">

      {/* Левая часть: Игроки и доска */}
      <div className="flex flex-col items-center gap-3">

        {/* Верхний игрок */}
        <div style={{ width: `${boardSize}px` }} className="bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded flex items-center justify-center border border-amber-600/30 font-bold text-lg ${topIconBg}`}>
              {TopIcon}
            </div>
            <div>
              <div className="font-bold flex items-center gap-2">
                <Link to={`/profile/${topName}`} className="hover:underline text-amber-200">{topName}</Link>
                <span className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20">
                  {topRating}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ДОСКА */}
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

                // Подсветка хода
                const lastMove = viewIndex >= 0 ? history[viewIndex] : null;
                const isLastMoveSquare = lastMove && (lastMove.from === squareId || lastMove.to === squareId);

                return (
                  <div
                    key={squareId}
                    className={`w-full h-full flex items-center justify-center relative ${isDark ? 'bg-acacia' : 'bg-boxwood'}`}
                  >
                    {isDark ? (
                      <div className="absolute inset-0 bg-black/10 pointer-events-none" />
                    ) : (
                      <div className="absolute inset-0 bg-white/20 pointer-events-none" />
                    )}

                    {isLastMoveSquare && (
                      <div className="absolute inset-0 bg-amber-400/30 z-10 pointer-events-none" />
                    )}

                    <div
                      className="absolute inset-0 opacity-40 mix-blend-multiply pointer-events-none"
                      style={{ backgroundImage: "url('/assets/textures/wood-grain.png')" }}
                    />
                    <div className="absolute inset-0 shadow-[inset_0_0_12px_rgba(0,0,0,0.3)] pointer-events-none" />

                    {piece && (
                      <div className="relative w-full h-full p-[2%] z-20 drop-shadow-[0_0_1px_rgba(255,255,255,0.4)] drop-shadow-[0_6px_6px_rgba(0,0,0,0.7)]">
                        {renderPieceSvg(piece)}
                      </div>
                    )}

                    {/* Координаты */}
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
        <div style={{ width: `${boardSize}px` }} className="bg-acacia-dark p-3 rounded shadow-heavy border-2 border-amber-900/40 flex justify-between items-center text-boxwood-light">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded flex items-center justify-center border border-amber-600/30 font-bold text-lg ${bottomIconBg}`}>
              {BottomIcon}
            </div>
            <div>
              <div className="font-bold flex items-center gap-2">
                <Link to={`/profile/${bottomName}`} className="hover:underline text-amber-200">{bottomName}</Link>
                <span className="text-xs px-1.5 py-0.5 rounded bg-black/40 text-amber-400 border border-amber-600/20">
                  {bottomRating}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Правая часть: Нотация и Управление */}
      <div className="w-full xl:w-96 bg-acacia p-5 rounded shadow-heavy border-4 border-acacia-dark flex flex-col gap-4 text-boxwood-light h-[650px]">

        <div className="flex items-center gap-3 border-b border-acacia-light pb-3">
          <button
            onClick={() => window.history.back()}
            className="p-1.5 bg-black/20 hover:bg-black/40 rounded transition border border-amber-900/50"
            title="Назад"
          >
            <ArrowLeft size={16} className="text-amber-500" />
          </button>
          <div>
            <div className="text-xs tracking-widest uppercase text-boxwood/70 flex items-center gap-1.5">
              <Sword size={12} /> Просмотр партии
            </div>
            {gameDataFromState && (
              <div className="text-[10px] text-amber-500 mt-1 font-mono leading-tight">
                {gameDataFromState.site && gameDataFromState.site !== '?' && `${gameDataFromState.site}, `}
                {displayDate}
                {gameDataFromState.eco && ` • ECO: ${gameDataFromState.eco}`}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col flex-1 bg-[#F5DEB3]/10 rounded border border-amber-900/40 overflow-hidden shadow-inner">
          <div className="bg-acacia-dark px-3 py-2 text-xs font-bold text-amber-200 border-b border-amber-900/40 flex justify-between items-center">
            <span>Нотация ходов</span>
            <span className="bg-black/40 px-2 py-0.5 rounded border border-amber-700/50 text-amber-400">
              {resultStr}
            </span>
          </div>

          <div ref={notationScrollRef} className="flex-1 overflow-y-auto p-2 font-mono text-sm space-y-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
            {history.reduce((acc: any[], move: any, index: number) => {
              if (index % 2 === 0) {
                acc.push({ white: move.san, black: '', whiteIndex: index, blackIndex: -1 });
              } else {
                acc[acc.length - 1].black = move.san;
                acc[acc.length - 1].blackIndex = index;
              }
              return acc;
            }, []).map((pair: any, idx: number) => {
              const isActiveWhite = viewIndex === pair.whiteIndex;
              const isActiveBlack = viewIndex === pair.blackIndex;

              return (
                <div key={idx} className="flex px-2 py-1 hover:bg-black/20 rounded text-amber-100/90">
                  <span className="w-10 text-amber-500/70 font-bold">{idx + 1}.</span>
                  <button
                    onClick={() => setViewIndex(pair.whiteIndex)}
                    className={`w-24 text-left hover:text-white ${isActiveWhite ? 'active-move bg-amber-600/30 text-white font-bold rounded px-1' : 'px-1'}`}
                  >
                    {pair.white}
                  </button>
                  {pair.black && (
                    <button
                      onClick={() => setViewIndex(pair.blackIndex)}
                      className={`w-24 text-left hover:text-white ${isActiveBlack ? 'active-move bg-amber-600/30 text-white font-bold rounded px-1' : 'px-1'}`}
                    >
                      {pair.black}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3">

          {/* Панель Управления */}
          <div className="flex justify-between items-center bg-acacia-dark p-2 rounded border border-amber-900/40">
            <span className="text-xs text-boxwood/70 pl-1">Управление:</span>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setViewIndex(-1)}
                className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"
                title="Начало партии"
              >
                <ChevronFirst size={16} />
              </button>

              <button
                onClick={() => setViewIndex(p => Math.max(-1, p - 1))}
                className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"
                title="Ход назад"
              >
                <ChevronLeft size={16} />
              </button>

              <button
                onClick={() => setViewIndex(p => Math.min(history.length - 1, p + 1))}
                className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"
                title="Ход вперед"
              >
                <ChevronRight size={16} />
              </button>

              <button
                onClick={() => setViewIndex(history.length - 1)}
                className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition"
                title="Конец партии"
              >
                <ChevronLast size={16} />
              </button>

              <div className="w-px h-4 bg-amber-900/50 mx-1"></div>

              <button
                onClick={() => setIsFlipped(!isFlipped)}
                className="p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition text-amber-500"
                title="Перевернуть доску"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <a
            href={`http://127.0.0.1:8000/api/v1/profile/games/${gameId}/pgn`}
            download
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-[#1A120B] text-amber-500 font-bold text-sm rounded hover:bg-black transition shadow border border-amber-900/60"
          >
            <Download size={16} /> Скачать PGN файл
          </a>
        </div>

      </div>
    </div>
  );
}