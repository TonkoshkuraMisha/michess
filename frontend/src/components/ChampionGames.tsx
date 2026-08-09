// --- FILE: frontend/src/components/ChampionGames.tsx ---

import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  Swords, Download, ArrowLeft, Crown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight
} from 'lucide-react';
import { CHAMPIONS_LIST } from '../config/champions';

interface GameData {
  game_id: number;
  white_username: string;
  white_rating: number;
  black_username: string;
  black_rating: number;
  status: string;
  is_rated: boolean;
  result: string;
  pgn_date: string | null;
  site: string | null;
  eco: string | null;
  finished_at: string | null;
}

const displayDate = (game: GameData) => {
  if (game.pgn_date && !game.pgn_date.includes('????')) {
    // Очищаем дату от неизвестных месяцев/дней: "1860.??.??" -> "1860"
    return game.pgn_date.replace(/\??/g, '').replace(/\.$/, '');
  }
  if (game.finished_at) {
    return format(parseISO(game.finished_at), 'd MMM yyyy', { locale: ru });
  }
  return '—';
};

export default function ChampionGames() {
  const { championId } = useParams<{ championId: string }>();
  const navigate = useNavigate();

  const [games, setGames] = useState<GameData[]>([]);
  const [totalGames, setTotalGames] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const champion = CHAMPIONS_LIST.find(c => c.id === championId);

  useEffect(() => {
    const fetchGames = async () => {
      setLoading(true);
      setError(null);
      try {
        const offset = (page - 1) * limit;
        const res = await fetch(`http://127.0.0.1:8000/api/v1/profile/${championId}/games?limit=${limit}&offset=${offset}&sort=asc`);

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || 'Не удалось загрузить партии из базы данных');
        }

        const data = await res.json();
        setTotalGames(data.total || 0);
        setGames(data.items || []);

      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (championId) fetchGames();
  }, [championId, page, limit]);

  if (!champion) {
    return (
      <div className="bg-red-950/80 border border-red-800 p-6 rounded text-red-200 text-center font-serif">
        <h2 className="text-xl font-bold mb-2">Ошибка</h2>
        <p>Игрок с идентификатором {championId} не найден в конфигурации.</p>
        <Link to="/" className="mt-4 inline-block text-amber-400 hover:underline">На главную</Link>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalGames / limit));

  const getVisiblePages = () => {
    const pages = [];
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, page + 2);

    if (page <= 3) end = Math.min(5, totalPages);
    if (page >= totalPages - 2) start = Math.max(1, totalPages - 4);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  return (
    <div className="w-full max-w-6xl flex flex-col gap-6 font-serif">

      <div className="bg-acacia-dark border border-amber-900/40 p-6 rounded shadow-heavy flex items-center gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
          <Crown size={180} />
        </div>

        <img
          src={champion.img}
          alt={champion.name}
          referrerPolicy="no-referrer"
          className="w-32 h-32 object-cover rounded-lg bg-black/40 shadow-inner border-2 border-amber-600/40 z-10"
        />

        <div className="flex flex-col z-10">
          <div className="text-amber-600 text-sm font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
            <Crown size={16} /> Исторический архив
          </div>
          <h1 className="text-4xl font-bold text-amber-200 mb-2">{champion.name}</h1>
          <div className="text-boxwood-light/80">
            Эпоха: <span className="font-mono text-amber-400 font-bold ml-1">{champion.years}</span>
          </div>
          <div className="text-boxwood-light/80 mt-1">
            Партий в базе: <span className="font-mono text-amber-400 font-bold ml-1">{totalGames}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/80 border border-red-800 p-6 rounded text-red-200 text-center shadow-heavy">
          <h2 className="text-xl font-bold mb-2">Ошибка загрузки</h2>
          <p>{error}</p>
        </div>
      )}

      <div className="bg-acacia-dark border border-amber-900/40 rounded shadow-heavy flex flex-col min-h-[500px]">
        <div className="p-5 border-b border-amber-900/40 bg-black/20 flex items-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="p-1.5 bg-black/20 hover:bg-black/40 rounded transition border border-amber-900/50"
            title="Назад"
          >
            <ArrowLeft size={16} className="text-amber-500" />
          </button>
          <h2 className="text-sm uppercase tracking-widest text-amber-500/80 font-bold">
            Хронология игр (От самых ранних к поздним)
          </h2>
        </div>

        <div className="flex-1 overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 z-20 bg-acacia-dark/80 backdrop-blur-sm flex flex-col items-center justify-center text-amber-500">
              <Swords size={40} className="animate-spin mb-4" />
              <span className="font-bold">Загрузка архивов...</span>
            </div>
          )}

          <table className="w-full text-left text-sm font-sans whitespace-nowrap">
            <thead className="bg-[#1A120B] text-boxwood/60 uppercase text-xs tracking-wider sticky top-0 z-10 border-b border-amber-900/50 shadow">
              <tr>
                <th className="px-4 py-4 font-medium">№</th>
                <th className="px-4 py-4 font-medium">Белые</th>
                <th className="px-4 py-4 font-medium">Черные</th>
                <th className="px-4 py-4 font-medium text-center">Результат</th>
                <th className="px-4 py-4 font-medium text-center">Дебют</th>
                <th className="px-4 py-4 font-medium text-center">Место</th>
                <th className="px-4 py-4 font-medium text-center">Дата</th>
                <th className="px-4 py-4 font-medium text-right">PGN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-900/20 text-boxwood-light">
              {games.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-boxwood/50 font-serif text-lg">
                    В архиве нет записей для этой страницы.
                  </td>
                </tr>
              ) : (
                games.map((game, index) => {
                  const isWhite = game.white_username.includes(champion.id);
                  let resultColor = 'text-gray-400';
                  let resultText = 'Ничья';

                  if (game.result === '1-0') {
                    resultColor = isWhite ? 'text-emerald-400' : 'text-red-400';
                    resultText = isWhite ? 'Победа' : 'Поражение';
                  } else if (game.result === '0-1') {
                    resultColor = isWhite ? 'text-red-400' : 'text-emerald-400';
                    resultText = isWhite ? 'Поражение' : 'Победа';
                  }

                  const absoluteIndex = (page - 1) * limit + index + 1;

                  return (
                    <tr
                      key={game.game_id}
                      onClick={() => navigate(`/game/${game.game_id}`, { state: { game } })}
                      className="hover:bg-black/30 transition group cursor-pointer"
                    >
                      <td className="px-4 py-4 font-mono text-boxwood/40">
                        {absoluteIndex}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm border border-gray-400 bg-white inline-block"></span>
                          <span className={`font-bold ${isWhite ? 'text-amber-300' : ''}`}>
                            {game.white_username}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm border border-gray-600 bg-black inline-block"></span>
                          <span className={`font-bold ${!isWhite ? 'text-amber-300' : ''}`}>
                            {game.black_username}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className={`font-bold font-serif ${resultColor}`}>
                          {resultText} <span className="text-xs opacity-70 ml-1">({game.result})</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-amber-500/80">
                        {game.eco || '—'}
                      </td>
                      <td className="px-4 py-4 text-center text-boxwood/70">
                        {game.site || '—'}
                      </td>
                      <td className="px-4 py-4 text-center text-boxwood/70 font-mono">
                        {displayDate(game)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <a
                          href={`http://127.0.0.1:8000/api/v1/profile/games/${game.game_id}/pgn`}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/30 hover:bg-amber-900/60 text-amber-400 rounded transition border border-amber-900/40 text-xs font-bold"
                          title="Скачать PGN"
                        >
                          <Download size={14} />
                        </a>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Панель пагинации */}
        {totalGames > 0 && (
          <div className="bg-[#1A120B] p-4 border-t border-amber-900/50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3 text-boxwood/60 text-sm">
              <span className="hidden sm:inline">Показывать по:</span>
              <select
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                className="bg-black/40 border border-amber-900/50 rounded px-2 py-1 text-amber-200 outline-none cursor-pointer focus:border-amber-600"
              >
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
              <span className="font-mono bg-black/30 px-2 py-1 rounded">Всего: {totalGames}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="p-1.5 rounded bg-black/40 hover:bg-amber-900/60 disabled:opacity-30 disabled:cursor-not-allowed text-amber-500 transition border border-transparent hover:border-amber-900/50"
              >
                <ChevronsLeft size={18} />
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded bg-black/40 hover:bg-amber-900/60 disabled:opacity-30 disabled:cursor-not-allowed text-amber-500 transition border border-transparent hover:border-amber-900/50"
              >
                <ChevronLeft size={18} />
              </button>

              <div className="flex items-center gap-1 mx-2">
                {getVisiblePages().map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded text-sm font-bold font-mono transition flex items-center justify-center ${
                      page === p 
                        ? 'bg-amber-600 text-white shadow shadow-amber-600/20' 
                        : 'bg-black/40 text-amber-500 hover:bg-amber-900/60 border border-transparent hover:border-amber-900/50'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded bg-black/40 hover:bg-amber-900/60 disabled:opacity-30 disabled:cursor-not-allowed text-amber-500 transition border border-transparent hover:border-amber-900/50"
              >
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="p-1.5 rounded bg-black/40 hover:bg-amber-900/60 disabled:opacity-30 disabled:cursor-not-allowed text-amber-500 transition border border-transparent hover:border-amber-900/50"
              >
                <ChevronsRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}