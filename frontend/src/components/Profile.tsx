// --- FILE: frontend/src/components/Profile.tsx ---

import {useState, useEffect} from 'react';
import {useParams, Link, useNavigate} from 'react-router-dom';
import {format, parseISO} from 'date-fns';
import {ru} from 'date-fns/locale';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
    Trophy,
    Swords,
    Calendar,
    Download,
    Crosshair,
    Target
} from 'lucide-react';
import {API_BASE_URL} from '../config/api';

interface UserProfile {
    id: number;
    username: string;
    bullet_rating: number;
    blitz_rating: number;
    rapid_rating: number;
    classical_rating: number;
    created_at: string;
}

const RATING_CATEGORIES: Array<{ key: 'bullet_rating' | 'blitz_rating' | 'rapid_rating' | 'classical_rating'; label: string }> = [
    {key: 'bullet_rating', label: 'Пуля'},
    {key: 'blitz_rating', label: 'Блиц'},
    {key: 'rapid_rating', label: 'Рапид'},
    {key: 'classical_rating', label: 'Классика'},
];

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

type RatingCategoryKey = 'bullet' | 'blitz' | 'rapid' | 'classical';

const CHART_CATEGORIES: Array<{ key: RatingCategoryKey; label: string }> = [
    {key: 'bullet', label: 'Пуля'},
    {key: 'blitz', label: 'Блиц'},
    {key: 'rapid', label: 'Рапид'},
    {key: 'classical', label: 'Классика'},
];

interface PlayerStats {
    total: number;
    wins: number;
    draws: number;
    losses: number;
    rated_games: Record<RatingCategoryKey, number>;
}

interface RatingPoint {
    game_id: number;
    finished_at: string;
    rating: number;
    delta: number;
}

const GAMES_PAGE_SIZE = 30;

/** Точка графика рейтинга: рейтинг после партии, изменение за неё и ссылка на партию. */
export interface RatingChartPoint {
    game_id: number;
    rating: number;
    delta: number;
    /** Подпись оси: день партии. */
    date: string;
    /** Подсказка: дата и время завершения партии. */
    fullDate: string;
}

export function toRatingChartPoint(point: RatingPoint): RatingChartPoint {
    const finished = parseISO(point.finished_at);
    return {
        game_id: point.game_id,
        rating: point.rating,
        delta: point.delta,
        date: format(finished, 'd MMM', {locale: ru}),
        fullDate: format(finished, 'd MMMM yyyy, HH:mm', {locale: ru}),
    };
}

/** «+12», «-8», «0»: изменение рейтинга со знаком. */
export function formatRatingDelta(delta: number): string {
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return `${delta}`;
    return '0';
}

/** Подсказка графика: когда сыграна партия, рейтинг после неё и изменение за неё. */
export function RatingTooltip({active, payload}: {
    active?: boolean;
    payload?: Array<{ payload: RatingChartPoint }>;
}) {
    const point = active ? payload?.[0]?.payload : undefined;
    if (!point) return null;
    const deltaColor = point.delta > 0 ? 'text-emerald-400' : point.delta < 0 ? 'text-red-400' : 'text-boxwood/60';
    return (
        <div className="bg-[#1A120B] border border-[#7A4B31] rounded-lg px-3 py-2 text-sm font-sans shadow-heavy">
            <div className="text-boxwood/70 text-xs">{point.fullDate}</div>
            <div className="font-bold text-amber-400 font-mono">
                {point.rating} <span className={deltaColor}>({formatRatingDelta(point.delta)})</span>
            </div>
            <div className="text-[11px] text-boxwood/50 mt-0.5">Нажмите, чтобы открыть партию</div>
        </div>
    );
}

/**
 * Точка графика, по которой можно открыть партию. Recharts передаёт в свой элемент точки
 * координаты и данные точки (payload).
 */
export function RatingDot({cx, cy, payload, r = 4, active = false, onSelect}: {
    cx?: number;
    cy?: number;
    payload?: RatingChartPoint;
    r?: number;
    active?: boolean;
    onSelect: (gameId: number) => void;
}) {
    if (cx === undefined || cy === undefined || !payload) return null;
    return (
        <circle
            cx={cx}
            cy={cy}
            r={r}
            fill={active ? '#fbbf24' : '#1A120B'}
            stroke="#fbbf24"
            strokeWidth={2}
            style={{cursor: 'pointer'}}
            role="link"
            aria-label={`Партия от ${payload.fullDate}: рейтинг ${payload.rating}`}
            data-game-id={payload.game_id}
            onClick={() => onSelect(payload.game_id)}
        />
    );
}

/** Категория с наибольшим числом рейтинговых партий — её график показываем первым. */
function mostPlayedCategory(stats: PlayerStats | null): RatingCategoryKey {
    let best: RatingCategoryKey = 'blitz';
    let bestCount = 0;
    for (const {key} of CHART_CATEGORIES) {
        const count = stats?.rated_games?.[key] ?? 0;
        if (count > bestCount) {
            best = key;
            bestCount = count;
        }
    }
    return best;
}

const displayDate = (game: GameData) => {
    if (game.pgn_date && !game.pgn_date.includes('????')) {
        return game.pgn_date.replace(/\?/g, '').replace(/\.+$/, '');
    }
    if (game.finished_at) {
        return format(parseISO(game.finished_at), 'd MMM yyyy', {locale: ru});
    }
    return '—';
};

export default function Profile() {
    const {targetUsername} = useParams<{ targetUsername: string }>();
    const navigate = useNavigate();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [games, setGames] = useState<GameData[]>([]);
    const [gamesTotal, setGamesTotal] = useState(0);
    const [gamesPage, setGamesPage] = useState(0);
    const [stats, setStats] = useState<PlayerStats | null>(null);
    const [chartCategory, setChartCategory] = useState<RatingCategoryKey>('blitz');
    const [ratingPoints, setRatingPoints] = useState<RatingPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const profileApi = `${API_BASE_URL}/api/v1/profile/${encodeURIComponent(targetUsername ?? '')}`;

    // Профиль и итоги — один раз на игрока.
    useEffect(() => {
        if (!targetUsername) return;
        let cancelled = false;

        const fetchProfileData = async () => {
            setLoading(true);
            setError(null);
            setGamesPage(0);
            setStats(null);
            setRatingPoints([]);
            try {
                const profileRes = await fetch(profileApi);
                if (!profileRes.ok) throw new Error('Пользователь не найден');
                const profileData = await profileRes.json();
                if (cancelled) return;
                setProfile(profileData);

                // Итоги считаются на сервере по всем партиям, а не по загруженной странице.
                const statsRes = await fetch(`${profileApi}/stats`).catch(() => null);
                const statsData: PlayerStats | null = statsRes?.ok ? await statsRes.json() : null;
                if (cancelled) return;
                if (statsData && typeof statsData.total === 'number') {
                    setStats(statsData);
                    setChartCategory(mostPlayedCategory(statsData));
                } else {
                    setChartCategory('blitz');
                }
            } catch (err: any) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchProfileData();
        return () => {
            cancelled = true;
        };
    }, [targetUsername, profileApi]);

    // Страница истории партий.
    useEffect(() => {
        if (!targetUsername) return;
        let cancelled = false;
        fetch(`${profileApi}/games?limit=${GAMES_PAGE_SIZE}&offset=${gamesPage * GAMES_PAGE_SIZE}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return;
                setGames(data?.items || []);
                setGamesTotal(typeof data?.total === 'number' ? data.total : (data?.items?.length ?? 0));
            })
            .catch(() => {
                if (!cancelled) setGames([]);
            });
        return () => {
            cancelled = true;
        };
    }, [targetUsername, profileApi, gamesPage]);

    // История рейтинга выбранной категории — сохранённые сервером значения после каждой партии.
    useEffect(() => {
        if (!targetUsername) return;
        let cancelled = false;
        fetch(`${profileApi}/rating-history?category=${chartCategory}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setRatingPoints(Array.isArray(data?.points) ? data.points : []);
            })
            .catch(() => {
                if (!cancelled) setRatingPoints([]);
            });
        return () => {
            cancelled = true;
        };
    }, [targetUsername, profileApi, chartCategory]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center w-full h-full text-boxwood-light font-serif">
                <div className="animate-spin text-amber-500 mb-4"><Swords size={40}/></div>
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

    const totalGames = stats?.total ?? gamesTotal;
    const wins = stats?.wins ?? 0;
    const draws = stats?.draws ?? 0;
    const losses = stats?.losses ?? 0;
    const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

    const chartData = ratingPoints.map(toRatingChartPoint);
    const openGame = (gameId: number) => navigate(`/game/${gameId}`);
    const chartCategoryLabel = CHART_CATEGORIES.find((c) => c.key === chartCategory)?.label ?? '';
    const totalPages = Math.max(1, Math.ceil(gamesTotal / GAMES_PAGE_SIZE));

    return (
        <div className="w-full max-w-6xl flex flex-col gap-6 font-serif">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div
                    className="bg-acacia-dark border border-amber-900/40 p-6 rounded shadow-heavy flex flex-col items-center justify-center text-center relative overflow-hidden">
                    <img
                        src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(profile.username)}&backgroundColor=D0A972`}
                        alt="Avatar Background"
                        className="absolute top-0 right-0 w-48 h-48 opacity-10 pointer-events-none translate-x-10 -translate-y-10"
                    />
                    <img
                        src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(profile.username)}&backgroundColor=E6C998`}
                        alt="Avatar"
                        className="w-24 h-24 rounded-lg bg-black/40 shadow-inner border-2 border-amber-600/40 mb-3 z-10"
                    />
                    <h1 className="text-3xl font-bold text-amber-200 z-10">{profile.username}</h1>

                    <div className="flex items-center gap-2 mt-3 text-boxwood-light/80 text-sm z-10">
                        <Calendar size={16} className="text-amber-600"/>
                        На сайте с {format(parseISO(profile.created_at), 'd MMMM yyyy', {locale: ru})}
                    </div>
                </div>

                <div className="md:col-span-2 flex flex-col gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {RATING_CATEGORIES.map(({key, label}) => (
                            <div
                                key={key}
                                className="bg-[#1A120B] border border-amber-900/60 px-3 py-2.5 rounded shadow-inner flex flex-col items-center justify-center"
                            >
                                <div className="text-boxwood/60 text-[11px] uppercase tracking-widest mb-0.5 flex items-center gap-1">
                                    <Trophy size={11}/> {label}
                                </div>
                                <div className="text-2xl font-mono font-bold text-amber-400">{profile[key]}</div>
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div
                            className="bg-[#1A120B] border border-amber-900/60 p-5 rounded shadow-inner flex flex-col justify-center">
                            <div
                                className="text-boxwood/60 text-xs uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                <Swords size={14}/> Игр сыграно
                            </div>
                            <div className="text-4xl font-mono font-bold text-blue-400">{totalGames}</div>
                        </div>
                        <div
                            className="bg-[#1A120B] border border-amber-900/60 p-5 rounded shadow-inner flex flex-col justify-center">
                            <div
                                className="text-boxwood/60 text-xs uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                <Target size={14}/> Винрейт
                            </div>
                            <div className="text-4xl font-mono font-bold text-emerald-400">{winRate}%</div>
                        </div>
                        <div
                            className="bg-[#1A120B] border border-amber-900/60 p-5 rounded shadow-inner flex flex-col justify-center">
                            <div
                                className="text-boxwood/60 text-[10px] xl:text-xs uppercase tracking-wider mb-1 flex items-center gap-1.5 whitespace-nowrap">
                                <Crosshair size={14}/> WIN / DRAW / LOSE
                            </div>
                            <div className="text-2xl font-mono font-bold flex gap-2">
                                <span className="text-emerald-400">{wins}</span>
                                <span className="text-boxwood/40">/</span>
                                <span className="text-gray-400">{draws}</span>
                                <span className="text-boxwood/40">/</span>
                                <span className="text-red-400">{losses}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-acacia-dark border border-amber-900/40 p-5 rounded shadow-heavy">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                    <h2 className="text-sm uppercase tracking-widest text-amber-500/80 font-bold">
                        Динамика рейтинга — {chartCategoryLabel.toLowerCase()}
                    </h2>
                    <div className="flex gap-1 p-0.5 bg-black/40 rounded border border-amber-900/40 font-sans">
                        {CHART_CATEGORIES.map(({key, label}) => (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={chartCategory === key}
                                onClick={() => setChartCategory(key)}
                                className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${
                                    chartCategory === key
                                        ? 'bg-amber-700 text-white'
                                        : 'text-boxwood/70 hover:text-amber-200'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="h-64 w-full font-sans">
                    {chartData.length > 1 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#5C3A21" vertical={false}/>
                                <XAxis dataKey="date" stroke="#8B5A2B" tick={{fill: '#D0A972', fontSize: 12}} dy={10}/>
                                <YAxis domain={['dataMin - 30', 'dataMax + 30']} stroke="#8B5A2B"
                                       tick={{fill: '#D0A972', fontSize: 12}} dx={-10}/>
                                <Tooltip content={<RatingTooltip/>}/>
                                <Line type="monotone" dataKey="rating" stroke="#fbbf24" strokeWidth={3}
                                      isAnimationActive={false}
                                      dot={<RatingDot r={4} onSelect={openGame}/>}
                                      activeDot={<RatingDot r={6} active onSelect={openGame}/>}/>
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-boxwood/50">
                            Недостаточно рейтинговых партий в этой категории для графика
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-acacia-dark border border-amber-900/40 rounded shadow-heavy overflow-hidden">
                <div className="p-5 border-b border-amber-900/40 bg-black/20">
                    <h2 className="text-sm uppercase tracking-widest text-amber-500/80 font-bold">История партий</h2>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm font-sans whitespace-nowrap">
                        <thead className="bg-black/40 text-boxwood/60 uppercase text-xs tracking-wider">
                        <tr>
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
                        {games.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-8 text-center text-boxwood/50 font-serif">
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
                                    <tr
                                        key={game.game_id}
                                        onClick={() => navigate(`/game/${game.game_id}`, {state: {game}})}
                                        className="hover:bg-black/30 transition group cursor-pointer"
                                        title="Нажмите, чтобы просмотреть партию"
                                    >
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="w-3 h-3 rounded-sm border border-gray-400 bg-white inline-block"></span>
                                                <Link
                                                    to={`/profile/${encodeURIComponent(game.white_username)}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={`font-bold hover:underline ${isWhite ? 'text-amber-300' : ''}`}
                                                >
                                                    {game.white_username}
                                                </Link>
                                                <span
                                                    className="text-xs font-mono text-boxwood/50">({game.white_rating})</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="w-3 h-3 rounded-sm border border-gray-600 bg-black inline-block"></span>
                                                <Link
                                                    to={`/profile/${encodeURIComponent(game.black_username)}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={`font-bold hover:underline ${!isWhite ? 'text-amber-300' : ''}`}
                                                >
                                                    {game.black_username}
                                                </Link>
                                                <span
                                                    className="text-xs font-mono text-boxwood/50">({game.black_rating})</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-center">
                                            <div className={`font-bold font-serif ${resultColor}`}>
                                                {resultText} <span
                                                className="text-xs opacity-70 ml-1">({game.result})</span>
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
                                                href={`${API_BASE_URL}/api/v1/profile/games/${game.game_id}/pgn`}
                                                download
                                                onClick={(e) => e.stopPropagation()}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/30 hover:bg-amber-900/60 text-amber-400 rounded transition border border-amber-900/40 text-xs font-bold"
                                                title="Скачать PGN"
                                            >
                                                <Download size={14}/>
                                            </a>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                        </tbody>
                    </table>
                </div>

                {gamesTotal > GAMES_PAGE_SIZE && (
                    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-amber-900/40 bg-black/20 font-sans text-sm">
                        <button
                            type="button"
                            disabled={gamesPage === 0}
                            onClick={() => setGamesPage((page) => Math.max(0, page - 1))}
                            className="px-3 py-1.5 rounded border border-amber-900/60 bg-black/35 text-amber-200 hover:border-amber-600/60 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            ← Новее
                        </button>
                        <span className="text-boxwood/70 font-mono">
                            Стр. {gamesPage + 1} из {totalPages} · всего {gamesTotal}
                        </span>
                        <button
                            type="button"
                            disabled={gamesPage + 1 >= totalPages}
                            onClick={() => setGamesPage((page) => page + 1)}
                            className="px-3 py-1.5 rounded border border-amber-900/60 bg-black/35 text-amber-200 hover:border-amber-600/60 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Старее →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}