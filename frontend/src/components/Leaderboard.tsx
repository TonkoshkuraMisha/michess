// --- FILE: frontend/src/components/Leaderboard.tsx ---

import {useState, useEffect} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {Trophy, Medal, Crown, ArrowLeft, Swords, User} from 'lucide-react';
import {API_BASE_URL} from '../config/api';
import {useI18n} from '../i18n';

interface LeaderboardEntry {
    rank: number;
    username: string;
    rating: number;
}

type RatingCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

const CATEGORY_TABS: RatingCategory[] = ['bullet', 'blitz', 'rapid', 'classical'];

export default function Leaderboard() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [category, setCategory] = useState<RatingCategory>('blitz');
    const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<'leaderboard.loadFailed' | 'common.networkError' | null>(null);

    useEffect(() => {
        const fetchLeaderboard = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`${API_BASE_URL}/api/v1/profile/leaderboard?limit=50&category=${category}`);
                if (!res.ok) {
                    setError('leaderboard.loadFailed');
                    return;
                }
                const data = await res.json();
                setPlayers(Array.isArray(data) ? data : []);
            } catch {
                setError('common.networkError');
            } finally {
                setLoading(false);
            }
        };

        fetchLeaderboard();
    }, [category]);

    const renderRankBadge = (rank: number) => {
        if (rank === 1) {
            return (
                <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-amber-500/20 border border-amber-400 text-amber-300 font-bold shadow">
                    <Crown size={18}/>
                </span>
            );
        }
        if (rank === 2) {
            return (
                <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-300/15 border border-slate-300/60 text-slate-200 font-bold">
                    <Medal size={17}/>
                </span>
            );
        }
        if (rank === 3) {
            return (
                <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-amber-700/25 border border-amber-600/60 text-amber-400 font-bold">
                    <Medal size={17}/>
                </span>
            );
        }
        return (
            <span className="inline-flex items-center justify-center w-8 h-8 font-mono font-bold text-boxwood/60">
                {rank}
            </span>
        );
    };

    return (
        <div className="w-full max-w-5xl flex flex-col gap-6 font-serif">
            <div
                className="bg-acacia-dark border border-amber-900/40 p-6 rounded shadow-heavy flex items-center justify-between gap-4 relative overflow-hidden">
                <div className="flex items-center gap-4 z-10">
                    <div
                        className="w-14 h-14 rounded-lg bg-black/40 border-2 border-amber-600/50 flex items-center justify-center text-amber-400 shadow-inner shrink-0">
                        <Trophy size={30}/>
                    </div>
                    <div>
                        <div className="text-amber-500 text-xs font-bold uppercase tracking-widest mb-1">
                            {t('leaderboard.badge')}
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-amber-200">
                            {t('leaderboard.title')}
                        </h1>
                        <p className="text-xs sm:text-sm text-boxwood/75 mt-0.5">
                            {t('leaderboard.subtitle', {category: t(`ratingCategoryInline.${category}`)})}
                        </p>
                    </div>
                </div>

                <button
                    onClick={() => navigate('/')}
                    className="px-3.5 py-2 bg-black/35 hover:bg-black/55 text-amber-300 rounded-md border border-amber-800/50 text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer z-10 shrink-0"
                >
                    <ArrowLeft size={16}/> {t('leaderboard.toBoard')}
                </button>
            </div>

            {error && (
                <div className="bg-red-950/80 border border-red-800 p-5 rounded text-red-200 text-center">
                    {t(error)}
                </div>
            )}

            <div className="flex gap-2">
                {CATEGORY_TABS.map((tab) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => setCategory(tab)}
                        className={`flex-1 px-3.5 py-2.5 rounded-md border text-sm font-bold transition cursor-pointer ${
                            category === tab
                                ? 'bg-amber-700 text-white border-amber-400'
                                : 'bg-acacia-dark hover:bg-black/45 text-amber-200 border-amber-800/50'
                        }`}
                    >
                        {t(`ratingCategory.${tab}`)}
                    </button>
                ))}
            </div>

            <div
                className="bg-acacia-dark border border-amber-900/40 rounded shadow-heavy overflow-hidden min-h-[420px] relative">
                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center text-amber-500">
                        <Swords size={38} className="animate-spin mb-3"/>
                        <span className="font-bold">{t('leaderboard.loading')}</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm font-sans whitespace-nowrap">
                            <thead
                                className="bg-[#1A120B] text-boxwood/60 uppercase text-xs tracking-wider border-b border-amber-900/50">
                            <tr>
                                <th className="px-5 py-4 font-medium w-20">{t('leaderboard.place')}</th>
                                <th className="px-5 py-4 font-medium">{t('leaderboard.player')}</th>
                                <th className="px-5 py-4 font-medium text-right">{t('leaderboard.elo')}</th>
                                <th className="px-5 py-4 font-medium text-right">{t('leaderboard.profile')}</th>
                            </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-900/20 text-boxwood-light">
                            {players.length === 0 ? (
                                <tr>
                                    <td colSpan={4}
                                        className="px-6 py-12 text-center text-boxwood/50 font-serif text-base">
                                        {t('leaderboard.empty')}
                                    </td>
                                </tr>
                            ) : (
                                players.map((player) => (
                                    <tr
                                        key={player.username}
                                        onClick={() => navigate(`/profile/${encodeURIComponent(player.username)}`)}
                                        className="hover:bg-black/30 transition cursor-pointer group"
                                    >
                                        <td className="px-5 py-3.5">
                                            {renderRankBadge(player.rank)}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <img
                                                    src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${player.username}&backgroundColor=D0A972`}
                                                    alt={player.username}
                                                    className="w-9 h-9 rounded bg-black/40 border border-amber-900/50 shadow shrink-0"
                                                />
                                                <span
                                                    className="font-bold text-base text-amber-200 group-hover:text-white transition">
                                                    {player.username}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 text-right">
                                            <span
                                                className="font-mono font-extrabold text-base text-amber-400 px-2.5 py-1 rounded bg-black/40 border border-amber-800/40">
                                                {player.rating}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 text-right">
                                            <Link
                                                to={`/profile/${encodeURIComponent(player.username)}`}
                                                onClick={(e) => e.stopPropagation()}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/30 hover:bg-amber-900/60 text-amber-300 rounded border border-amber-900/40 text-xs font-bold transition"
                                            >
                                                <User size={14}/> {t('leaderboard.open')}
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}