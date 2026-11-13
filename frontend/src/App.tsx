// --- FILE: frontend/src/App.tsx ---

import {useState, useRef, useEffect} from 'react';
import {Routes, Route, useNavigate, Link, useLocation} from 'react-router-dom';
import Chessboard from './components/Chessboard';
import AuthModal from './components/AuthModal';
import Profile from './components/Profile';
import GameViewer from './components/GameViewer';
import ChampionGames from './components/ChampionGames';
import Leaderboard from './components/Leaderboard';
import About from './components/About';
import Settings from './components/Settings';
import PuzzlesPage from './components/puzzles/PuzzlesPage';
import {LearnPage, LessonPage} from './components/learn/LearnPage';
import {TournamentView, TournamentsPage} from './components/tournaments/TournamentsPage';
import {CHAMPIONS_LIST} from './config/champions';
import {API_BASE_URL} from './config/api';
import {gameSocket} from './services/gameSocket';

import {
    Swords,
    LogOut,
    User,
    Settings as SettingsIcon,
    LogIn,
    Crown,
    ChevronDown,
    Trophy,
    Scale,
    Puzzle
} from 'lucide-react';
import {useI18n} from './i18n';
import LanguageSwitcher from './components/LanguageSwitcher';

interface UserProfile {
    id: number;
    username: string;
    bullet_rating: number;
    blitz_rating: number;
    rapid_rating: number;
    classical_rating: number;
    is_cheater: boolean;
}

export default function App() {
    const {t} = useI18n();
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [profileRetry, setProfileRetry] = useState(0);

    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isChampionsMenuOpen, setIsChampionsMenuOpen] = useState(false);

    const [showAuthModal, setShowAuthModal] = useState(false);
    const [serverPing, setServerPing] = useState<number | null>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const championsMenuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const location = useLocation();

    const isSingleScreenRoute =
        location.pathname === '/' ||
        location.pathname.startsWith('/challenge/') ||
        location.pathname.startsWith('/game/');

    useEffect(() => {
        const syncTokenFromStorage = () => {
            const current = localStorage.getItem('token');
            setToken(current);
            if (!current) {
                setUserProfile(null);
                gameSocket.disconnect();
            }
        };

        window.addEventListener('storage', syncTokenFromStorage);
        window.addEventListener('michess-auth-expired', syncTokenFromStorage);
        return () => {
            window.removeEventListener('storage', syncTokenFromStorage);
            window.removeEventListener('michess-auth-expired', syncTokenFromStorage);
        };
    }, []);

    useEffect(() => {
        if (!token) {
            setUserProfile(null);
            gameSocket.disconnect();
            return;
        }

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        fetch(`${API_BASE_URL}/api/v1/profile/me`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'accept': 'application/json'
            }
        })
            .then(res => {
                if (res.status === 401) {
                    // Только отказ в авторизации означает, что токен недействителен. Сетевая
                    // ошибка или 5xx (например, сервер перезапускается) — не повод разлогинивать.
                    localStorage.removeItem('token');
                    gameSocket.disconnect();
                    setToken(null);
                    setUserProfile(null);
                    return null;
                }
                if (!res.ok) throw new Error(`profile/me: HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (!cancelled && data) setUserProfile(data);
            })
            .catch(() => {
                // Профиль не загрузился — пробуем ещё раз, сессию не трогаем.
                if (!cancelled) retryTimer = setTimeout(() => setProfileRetry(n => n + 1), 3000);
            });

        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
    }, [token, profileRetry]);

    useEffect(() => {
        if (!isProfileOpen) return;
        const measurePing = async () => {
            const start = Date.now();
            try {
                await fetch(`${API_BASE_URL}/health`);
                setServerPing(Date.now() - start);
            } catch {
                setServerPing(-1);
            }
        };
        measurePing();
        const interval = setInterval(measurePing, 3000);
        return () => clearInterval(interval);
    }, [isProfileOpen]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        gameSocket.disconnect();
        setToken(null);
        setUserProfile(null);
        setIsProfileOpen(false);
        navigate('/');
    };

    const handleLogoutEverywhere = async () => {
        // Сервер отзывает все токены и закрывает WebSocket во всех вкладках и на всех устройствах.
        if (token) {
            try {
                await fetch(`${API_BASE_URL}/api/v1/auth/logout-all`, {
                    method: 'POST',
                    headers: {Authorization: `Bearer ${token}`},
                });
            } catch {
                // Сеть недоступна — локальный выход всё равно выполняем.
            }
        }
        handleLogout();
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsProfileOpen(false);
            }
            if (championsMenuRef.current && !championsMenuRef.current.contains(event.target as Node)) {
                setIsChampionsMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const username = userProfile?.username || t('nav.guest');
    // Блиц — заголовочный рейтинг в компактной навигации (как на chess.com/lichess.org);
    // полный разбор по пуле/блицу/рапиду/классике — на странице профиля.
    const userRating = userProfile?.blitz_rating || 1200;

    return (
        <div
            className={`w-full flex flex-col bg-room text-paper font-sans select-none ${
                isSingleScreenRoute ? 'min-h-dvh xl:h-dvh xl:overflow-hidden' : 'min-h-dvh'
            }`}
        >
            <header
                className="h-14 shrink-0 bg-acacia-dark border-b-2 border-amber-900/60 px-3 sm:px-5 flex items-center justify-between shadow-heavy relative z-30">
                <div className="flex items-center gap-7">
                    <Link to="/" className="flex items-center gap-2.5 cursor-pointer group outline-none">
                        <div
                            className="w-9 h-9 rounded-md bg-boxwood flex items-center justify-center shadow-inner border border-amber-600/40 text-acacia-dark font-bold text-xl">
                            ♞
                        </div>
                        <span
                            className="hidden min-[380px]:inline text-2xl font-extrabold tracking-wide text-boxwood-light group-hover:text-white transition">
                            michess
                        </span>
                    </Link>

                    <nav className="hidden md:flex items-center gap-6 text-[15px] font-semibold text-boxwood/90">
                        <Link
                            to="/"
                            className={`flex items-center gap-2 transition ${
                                location.pathname === '/' ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Swords size={17}/> {t('nav.play')}
                        </Link>

                        <Link
                            to="/puzzles"
                            className={`flex items-center gap-2 transition ${
                                location.pathname === '/puzzles' ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Puzzle size={17}/> {t('nav.puzzles')}
                        </Link>

                        <Link
                            to="/tournaments"
                            className={`flex items-center gap-2 transition ${
                                location.pathname.startsWith('/tournaments') ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Trophy size={17}/> {t('nav.tournaments')}
                        </Link>

                        <Link
                            to="/leaderboard"
                            className={`flex items-center gap-2 transition ${
                                location.pathname === '/leaderboard' ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Trophy size={17}/> {t('nav.leaderboard')}
                        </Link>

                        <div className="relative" ref={championsMenuRef}>
                            <button
                                onClick={() => setIsChampionsMenuOpen(!isChampionsMenuOpen)}
                                className={`flex items-center gap-2 transition outline-none cursor-pointer ${
                                    isChampionsMenuOpen || location.pathname.startsWith('/champions')
                                        ? 'text-amber-300'
                                        : 'hover:text-amber-300'
                                }`}
                            >
                                <Crown size={17}/> {t('nav.legends')}
                                <ChevronDown
                                    size={15}
                                    className={`transition-transform ${isChampionsMenuOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {isChampionsMenuOpen && (
                                <div
                                    className="absolute top-full left-0 mt-3 w-80 bg-[#261C14] border-2 border-amber-900/80 rounded-lg shadow-2xl z-50 max-h-[75vh] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                                    {CHAMPIONS_LIST.map(champ => (
                                        <Link
                                            key={champ.id}
                                            to={`/champions/${encodeURIComponent(champ.id)}`}
                                            onClick={() => setIsChampionsMenuOpen(false)}
                                            className="flex items-center gap-3.5 px-4 py-2.5 hover:bg-black/40 transition border-b border-amber-900/30 last:border-b-0 group outline-none"
                                        >
                                            <img
                                                src={champ.img}
                                                alt={champ.name}
                                                referrerPolicy="no-referrer"
                                                className="w-11 h-11 object-cover rounded-md shadow border border-amber-900/50 group-hover:border-amber-500/60 transition shrink-0"
                                            />
                                            <div className="flex flex-col min-w-0">
                                                <span
                                                    className="font-bold text-amber-200 text-[15px] group-hover:text-white transition truncate">
                                                    {champ.name}
                                                </span>
                                                <span
                                                    className="text-xs text-boxwood/70 font-mono group-hover:text-amber-400 transition">
                                                    {t(champ.worldChampion ? 'nav.worldChampionYears' : 'nav.careerYears', {years: champ.years})}
                                                </span>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>

                    </nav>
                </div>

                <div className="flex items-center gap-1 sm:gap-3 text-boxwood-light relative" ref={dropdownRef}>
                    <LanguageSwitcher compact/>
                    <Link
                        to="/leaderboard"
                        className="md:hidden p-2 hover:bg-black/30 rounded-md transition text-boxwood/85 hover:text-amber-300"
                        title={t('nav.leaderboardFull')}
                        aria-label={t('nav.leaderboardFull')}
                    >
                        <Trophy size={19}/>
                    </Link>
                    <Link
                        to="/about"
                        className="p-2 hover:bg-black/30 rounded-md transition text-boxwood/85 hover:text-amber-300"
                        title={t('nav.about')}
                        aria-label={t('nav.about')}
                    >
                        <Scale size={19}/>
                    </Link>
                    {!(token && userProfile) && (
                        <Link
                            to="/settings"
                            className="p-2 hover:bg-black/30 rounded-md transition text-boxwood/85 hover:text-amber-300"
                            title={t('nav.settings')}
                            aria-label={t('nav.settings')}
                        >
                            <SettingsIcon size={19}/>
                        </Link>
                    )}

                    {token && userProfile ? (
                        <>
                            <div
                                onClick={() => setIsProfileOpen(!isProfileOpen)}
                                className="flex items-center gap-2.5 pl-3 border-l border-amber-900/50 cursor-pointer hover:opacity-90 transition select-none py-1 px-2.5 rounded-md hover:bg-black/25"
                            >
                                <img
                                    src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(username)}&backgroundColor=D0A972`}
                                    alt="Avatar"
                                    className="w-8 h-8 rounded bg-black/40 border border-amber-900/50 shadow"
                                />
                                <div className="flex flex-col items-start hidden sm:flex">
                                    <span className="font-bold text-sm text-amber-200 leading-tight">{username}</span>
                                    <span
                                        className="text-xs text-amber-400 font-mono font-semibold">({userRating})</span>
                                </div>
                                <span className="text-xs text-amber-400 ml-0.5">▼</span>
                            </div>

                            {isProfileOpen && (
                                <div
                                    className="absolute right-0 top-12 w-64 bg-[#261C14] border-2 border-amber-900/80 rounded-lg shadow-2xl py-2 z-50 text-boxwood-light">
                                    <div className="px-4 py-2.5 border-b border-amber-900/40 flex items-center gap-3">
                                        <img
                                            src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(username)}&backgroundColor=D0A972`}
                                            alt="Avatar"
                                            className="w-10 h-10 rounded bg-black/40 border border-amber-900/50 shadow"
                                        />
                                        <div>
                                            <div className="font-bold text-base text-amber-200">{username}</div>
                                            <div
                                                className="text-xs text-amber-400 font-mono">{t('nav.rating', {rating: userRating})}</div>
                                            <div className="text-xs text-emerald-400 flex items-center gap-1.5 mt-0.5">
                                                <span
                                                    className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                                                {t('nav.online')}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="py-1 border-b border-amber-900/40 text-sm font-medium">
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate(`/profile/${encodeURIComponent(username)}`);
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <User size={16} className="text-amber-500"/> {t('nav.profile')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/puzzles');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Puzzle size={16} className="text-amber-500"/> {t('nav.puzzles')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/tournaments');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Trophy size={16} className="text-amber-500"/> {t('nav.tournaments')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/leaderboard');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Trophy size={16} className="text-amber-500"/> {t('nav.leaderboardFull')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/settings');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <SettingsIcon size={16} className="text-amber-500"/> {t('nav.settings')}
                                        </button>
                                        <button
                                            onClick={handleLogout}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-red-950/40 transition text-red-300 hover:text-red-200 cursor-pointer"
                                        >
                                            <LogOut size={16} className="text-red-400"/> {t('nav.logout')}
                                        </button>
                                        <button
                                            onClick={handleLogoutEverywhere}
                                            title={t('nav.logoutEverywhereHint')}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-red-950/40 transition text-red-300/80 hover:text-red-200 cursor-pointer text-sm"
                                        >
                                            <LogOut size={16} className="text-red-500"/> {t('nav.logoutEverywhere')}
                                        </button>
                                    </div>

                                    <div
                                        className="px-4 py-2 text-xs font-mono text-boxwood/70 flex justify-between items-center bg-black/20">
                                        <span>{t('nav.ping', {
                                            value: serverPing === null ? '…'
                                                : serverPing === -1 ? t('nav.pingError') : t('nav.pingMs', {ms: serverPing}),
                                        })}</span>
                                        <span className="text-emerald-400 font-bold">{t('nav.server')}</span>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <button
                            onClick={() => setShowAuthModal(true)}
                            aria-label={t('nav.login')}
                            className="flex items-center gap-2 px-2.5 sm:px-4 py-1.5 bg-boxwood text-acacia-dark font-bold text-sm rounded-md hover:bg-boxwood-light transition shadow border border-amber-600/40 cursor-pointer"
                        >
                            {/* На узком экране — только иконка: иначе шапка шире экрана. */}
                            <LogIn size={16}/> <span className="hidden sm:inline">{t('nav.login')}</span>
                        </button>
                    )}
                </div>
            </header>

            <main
                className={`flex-1 flex justify-center w-full ${
                    isSingleScreenRoute
                        ? 'items-stretch p-2 sm:p-3 xl:overflow-hidden'
                        : 'items-start p-4 sm:p-6 overflow-y-auto'
                }`}
            >
                <Routes>
                    <Route path="/" element={<Chessboard key={token ? token : 'guest'}/>}/>
                    <Route path="/challenge/:inviteCode" element={<Chessboard key={token ? token : 'guest'}/>}/>
                    <Route path="/leaderboard" element={<Leaderboard/>}/>
                    <Route path="/puzzles" element={<PuzzlesPage/>}/>
                    <Route path="/learn" element={<LearnPage/>}/>
                    <Route path="/learn/:lessonId" element={<LessonPage/>}/>
                    <Route path="/tournaments" element={<TournamentsPage/>}/>
                    <Route path="/tournaments/:tournamentId" element={<TournamentView/>}/>
                    <Route path="/profile/:targetUsername" element={<Profile/>}/>
                    <Route path="/game/:gameId" element={<GameViewer/>}/>
                    <Route path="/champions/:championId" element={<ChampionGames/>}/>
                    <Route path="/about" element={<About/>}/>
                    <Route
                        path="/settings"
                        element={
                            <Settings
                                token={token}
                                username={userProfile?.username ?? null}
                                onTokenChange={setToken}
                                onLogoutEverywhere={handleLogoutEverywhere}
                            />
                        }
                    />
                </Routes>
            </main>

            {showAuthModal && (
                <AuthModal
                    onSuccess={(newToken) => {
                        setToken(newToken);
                        setShowAuthModal(false);
                    }}
                    onClose={() => setShowAuthModal(false)}
                />
            )}
        </div>
    );
}