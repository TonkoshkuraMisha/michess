// --- FILE: frontend/src/components/Profile.tsx ---

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { User, Trophy, Swords, Calendar, Download, Crosshair, Target } from 'lucide-react';

interface UserProfile {
  id: number;
  username: string;
  rating: number;
  created_at: string;
}

interface GameData {
  game_id: number;
  white_username: string;
  white_rating: number;
  black_username: string;
  black_rating: number;
  status: string;
  is_rated: boolean;
  result: string;
  finished_at: string;
}

export default function Profile() {
  const { targetUsername } = useParams<{ targetUsername: string }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [games, setGames] = useState<GameData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfileData = async () => {
      setLoading(true);
      setError(null);
      try {
        const profileRes = await fetch(`http://127.0.0.1:8000/api/v1/profile/${targetUsername}`);
        if (!profileRes.ok) throw new Error('Пользователь не найден');
        const profileData = await profileRes.json();
        setProfile(profileData);

        const gamesRes = await fetch(`http://127.0.0.1:8000/api/v1/profile/${targetUsername}/games?limit=30`);
        if (gamesRes.ok) {
          const gamesData = await gamesRes.json();
          setGames(gamesData);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (targetUsername) {
      fetchProfileData();
    }
  }, [targetUsername]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full text-boxwood-light font-serif">
        <div className="animate-spin text-amber-500 mb-4"><Swords size={40} /></div>
        <div>Загрузка профиля...</div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="bg-red-950/80 border border-red-800 p-6 rounded text-red-200 text-center font-serif">
        <h2 className="text-xl font-bold mb-2">Ошибка</h2>
        <p>{error || 'Не удалось загрузить профиль'}</p>
        <Link to="/" className="mt-4 inline-block text-amber-400 hover:underline">На главную</Link>
      </div>
    );
  }

  // Считаем статистику по последним загруженным играм
  let wins = 0, losses = 0, draws = 0;

  // Генерация визуального графика рейтинга на основе результатов партий
  // Так как мы не храним рейтинг после каждой игры, мы "отматываем" его назад для графика
  let currentRating = profile.rating;
  const chartData = [...games].reverse().map((game, index) => {
    const isWhite = game.white_username === profile.username;
    let delta = 0;

    if (game.result === '1-0') {
      isWhite ? (wins++, delta = -15) : (losses++, delta = 15);
    } else if (game.result === '0-1') {
      isWhite ? (losses++, delta = 15) : (wins++, delta = -15);
    } else if (game.result === '1/2-1/2') {
      draws++;
    }

    const dataPoint = {
      name: `Партия ${games.length - index}`,
      rating: currentRating,
      date: format(parseISO(game.finished_at), 'd MMM', { locale: ru })
    };

    currentRating += delta; // Отматываем рейтинг для предыдущей точки
    return dataPoint;
  }).reverse(); // Переворачиваем обратно для правильного отображения слева направо

  const winRate = games.length > 0 ? Math.round((wins / games.length) * 100) : 0;

  return (
    <div className="w-full max-w-6xl flex flex-col gap-6 font-serif">

      {/* Шапка профиля и статистика */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Карточка пользователя */}
        <div className="bg-acacia-dark border border-amber-900/40 p-6 rounded shadow-heavy flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <User size={120} />
          </div>

          <div className="w-24 h-24 rounded bg-boxwood text-acacia-dark flex items-center justify-center text-4xl font-bold shadow-inner border-2 border-amber-600/40 mb-4 z-10">
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-3xl font-bold text-amber-200 z-10">{profile.username}</h1>

          <div className="flex items-center gap-2 mt-4 text-boxwood-light/80 text-sm z-10">
            <Calendar size={16} className="text-amber-600" />
            На сайте с {format(parseISO(profile.created_at), 'd MMMM yyyy', { locale: ru })}
          </div>
        </div>

        {/* Ключевые показатели */}
        <div className="md:col-span-2 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#1A120B] border border-amber-900/60 p-5 rounded shadow-inner flex flex-col justify-center">
            <div className="text-boxwood/60 text-xs uppercase tracking-widest mb-1 flex items-center gap-1.5"><Trophy size={14}/> Рейтинг</div>
            <div className="text-4xl font-mono font-bold text-amber-400">{profile.rating}</div>
          </div>
          <div className="bg-[#1A120B] border border-amber-900/60 p-5 rounded shadow-inner flex flex-col justify-center">
            <div className="text-boxwood/60 text-xs uppercase tracking-widest mb-1 flex items-center gap-1.5"><Swords size={14}/> Игр сыграно</div>
            <div className="text-4xl font-mono font-bold text-blue-400">{games.length}</div>
          </div>
          <div className="bg-[#1A120B] border border-amber-900/60 p-5 rounded shadow-inner flex flex-col justify-center">
            <div className="text-boxwood/60 text-xs uppercase tracking-widest mb-1 flex items-center gap-1.5"><Target size={14}/> Винрейт</div>
            <div className="text-4xl font-mono font-bold text-emerald-400">{winRate}%</div>
          </div>
          <div className="bg-[#1A120B] border border-amber-900/60 p-5 rounded shadow-inner flex flex-col justify-center">
            <div className="text-boxwood/60 text-xs uppercase tracking-widest mb-1 flex items-center gap-1.5"><Crosshair size={14}/> Победы / Пораж.</div>
            <div className="text-2xl font-mono font-bold flex gap-2">
              <span className="text-emerald-400">{wins}</span>
              <span className="text-boxwood/40">/</span>
              <span className="text-red-400">{losses}</span>
            </div>
          </div>
        </div>
      </div>

      {/* График рейтинга */}
      <div className="bg-acacia-dark border border-amber-900/40 p-5 rounded shadow-heavy">
        <h2 className="text-sm uppercase tracking-widest text-amber-500/80 mb-6 font-bold">Динамика рейтинга (последние партии)</h2>
        <div className="h-64 w-full font-sans">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#5C3A21" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#8B5A2B"
                  tick={{ fill: '#D0A972', fontSize: 12 }}
                  dy={10}
                />
                <YAxis
                  domain={['dataMin - 30', 'dataMax + 30']}
                  stroke="#8B5A2B"
                  tick={{ fill: '#D0A972', fontSize: 12 }}
                  dx={-10}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1A120B', borderColor: '#7A4B31', color: '#F5DEB3', borderRadius: '8px' }}
                  itemStyle={{ color: '#fbbf24', fontWeight: 'bold' }}
                />
                <Line
                  type="monotone"
                  dataKey="rating"
                  stroke="#fbbf24"
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#1A120B', stroke: '#fbbf24', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#fbbf24' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-boxwood/50">
              Недостаточно данных для графика
            </div>
          )}
        </div>
      </div>

      {/* История партий */}
      <div className="bg-acacia-dark border border-amber-900/40 rounded shadow-heavy overflow-hidden">
        <div className="p-5 border-b border-amber-900/40 bg-black/20">
          <h2 className="text-sm uppercase tracking-widest text-amber-500/80 font-bold">История партий</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm font-sans">
            <thead className="bg-black/40 text-boxwood/60 uppercase text-xs tracking-wider">
              <tr>
                <th className="px-6 py-3 font-medium">Белые</th>
                <th className="px-6 py-3 font-medium">Черные</th>
                <th className="px-6 py-3 font-medium text-center">Результат</th>
                <th className="px-6 py-3 font-medium">Дата</th>
                <th className="px-6 py-3 font-medium text-right">PGN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-900/20 text-boxwood-light">
              {games.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-boxwood/50 font-serif">
                    Партий пока нет.
                  </td>
                </tr>
              ) : (
                games.map((game) => {
                  const isWhite = game.white_username === profile.username;
                  let resultColor = 'text-gray-400';
                  let resultText = 'Ничья';

                  if (game.result === '1-0') {
                    resultColor = isWhite ? 'text-emerald-400' : 'text-red-400';
                    resultText = isWhite ? 'Победа' : 'Поражение';
                  } else if (game.result === '0-1') {
                    resultColor = isWhite ? 'text-red-400' : 'text-emerald-400';
                    resultText = isWhite ? 'Поражение' : 'Победа';
                  }

                  return (
                    <tr key={game.game_id} className="hover:bg-black/20 transition group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm border border-gray-400 bg-white inline-block"></span>
                          <Link to={`/profile/${game.white_username}`} className={`font-bold hover:underline ${isWhite ? 'text-amber-300' : ''}`}>
                            {game.white_username}
                          </Link>
                          <span className="text-xs font-mono text-boxwood/50">({game.white_rating})</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm border border-gray-600 bg-black inline-block"></span>
                          <Link to={`/profile/${game.black_username}`} className={`font-bold hover:underline ${!isWhite ? 'text-amber-300' : ''}`}>
                            {game.black_username}
                          </Link>
                          <span className="text-xs font-mono text-boxwood/50">({game.black_rating})</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className={`font-bold font-serif ${resultColor}`}>
                          {resultText} <span className="text-xs opacity-70 ml-1">({game.result})</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-boxwood/70 text-xs">
                        {format(parseISO(game.finished_at), 'd MMM yyyy, HH:mm', { locale: ru })}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <a
                          href={`http://127.0.0.1:8000/api/v1/profile/games/${game.game_id}/pgn`}
                          download
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/30 hover:bg-amber-900/60 text-amber-400 rounded transition border border-amber-900/40 text-xs font-bold"
                          title="Скачать PGN"
                        >
                          <Download size={14} /> PGN
                        </a>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}