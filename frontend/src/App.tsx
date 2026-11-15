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
import {ResetPasswordPage, VerifyEmailPage} from './components/EmailLinkPages';
import PuzzlesPage from './components/puzzles/PuzzlesPage';
import {LearnPage, LessonPage} from './components/learn/LearnPage';
import {GuessPage} from './components/guess/GuessPage';
import {BasicsPage, BasicsSectionPage} from './components/learn/BasicsPage';
import {MateConstructionPage, MateCoursePage, MateExamPage} from './components/learn/MateCourse';
import {ClassicGamePage, ClassicsPage} from './components/learn/ClassicsPage';
import {EndgamesPage, EndgameTrainerPage} from './components/learn/EndgameTrainer';
import {ToolsPage} from './components/tools/ToolsPage';
import {WatchPage} from './components/watch/WatchPage';
import {ArenaPage, ArenasPage} from './components/arena/ArenaPages';
import {TeamsPage} from './components/social/TeamsPage';
import {StudyLobby, StudyRoomPage} from './components/study/StudyPages';
import {ModerationPage} from './components/social/ModerationPage';
import {moderationApi} from './services/moderation';
import {TrainerPage, TrainersPage} from './components/trainers/TrainersPage';
import {NotificationBell, PlayerSearch} from './components/social/SocialHeader';
import {TournamentView, TournamentsPage} from './components/tournaments/TournamentsPage';
import {CHAMPIONS_LIST} from './config/champions';
import {API_BASE_URL} from './config/api';
import {gameSocket} from './services/gameSocket';
import * as auth from './services/authToken';

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
    Puzzle,
    GraduationCap,
    Eye,
    Wrench,
    Dumbbell,
    Shield,
    Presentation,
    Gavel
} from 'lucide-react';
import {isLanguage, useI18n} from './i18n';
import {saveProfileSettings, setTranslationHelper} from './services/profileSettings';
import {applyPreset, findPreset, getSavedPresetId} from './config/themePresets';
import {TranslationHelper} from './components/social/TranslationHelper';
import LanguageSwitcher from './components/LanguageSwitcher';

interface UserProfile {
    id: number;
    username: string;
    bullet_rating: number;
    blitz_rating: number;
    rapid_rating: number;
    classical_rating: number;
    is_cheater: boolean;
    /** Категории с временным рейтингом (таск 17.8): меньше 30 партий. */
    provisional?: string[];
    /** Языки (таск 17.7): язык из профиля и режим «помощник перевода». */
    language?: string | null;
    translation_helper?: boolean;
    /** Тема-комплект (таск 18.3). */
    theme_preset?: string | null;
}

export default function App() {
    const {t, language, setLanguage} = useI18n();
    // Токен — в памяти (services/authToken): при загрузке вход восстанавливается по httpOnly-cookie (таск 17.5).
    const [token, setToken] = useState<string | null>(() => auth.getToken());
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [profileRetry, setProfileRetry] = useState(0);

    const [isProfileOpen, setIsProfileOpen] = useState(false);
    // Язык хранится в профиле (таск 17.7): при входе язык профиля применяется (так он переходит между устройствами),
    // если в профиле его ещё нет — туда записывается текущий; дальше каждая смена языка сохраняется на сервере.
    const languageSyncedFor = useRef<number | null>(null);
    useEffect(() => {
        if (!token || !userProfile) {
            languageSyncedFor.current = null;
            setTranslationHelper(false);
            return;
        }
        setTranslationHelper(!!userProfile.translation_helper);
        if (languageSyncedFor.current !== userProfile.id) {
            languageSyncedFor.current = userProfile.id;
            if (isLanguage(userProfile.language) && userProfile.language !== language) {
                setLanguage(userProfile.language);
                return;
            }
        }
        if (userProfile.language !== language) {
            setUserProfile((p) => (p ? {...p, language} : p));
            saveProfileSettings({language}).catch(() => undefined);
        }
    }, [token, userProfile, language, setLanguage]);
    // Тема-комплект из профиля (таск 18.3) применяется при входе, если в браузере выбрана другая.
    const presetSyncedFor = useRef<number | null>(null);
    useEffect(() => {
        if (!userProfile || presetSyncedFor.current === userProfile.id) return;
        presetSyncedFor.current = userProfile.id;
        const preset = findPreset(userProfile.theme_preset);
        if (preset && preset.id !== getSavedPresetId()) applyPreset(preset);
    }, [userProfile]);
    // Пункт «Модерация» (17.4) — только модератору и игроку с флагом нечестной игры (там — апелляция).
    const [showModeration, setShowModeration] = useState(false);
    useEffect(() => {
        if (!token || !userProfile) {
            setShowModeration(false);
            return;
        }
        moderationApi.me().then((m) => setShowModeration(m.is_moderator || m.is_cheater)).catch(() => setShowModeration(false));
    }, [token, userProfile]);
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
        const unsubscribe = auth.onTokenChange((current) => {
            setToken(current);
            if (!current) {
                setUserProfile(null);
                gameSocket.disconnect();
            }
        });
        void auth.restoreSession();
        return unsubscribe;
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
                    // Только отказ в авторизации означает, что токен недействителен (например, истёк, пока
                    // компьютер спал). Сетевая ошибка или 5xx — не повод разлогинивать. Сначала — обновить токен по
                    // cookie; не вышло — выход (подписка выше).
                    void auth.refreshSession();
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
        void auth.logout();
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
    // Временный рейтинг (таск 17.8) — со знаком «?», пока сыграно мало партий блица.
    const ratingProvisional = Boolean(userProfile?.provisional?.includes('blitz'));
    const ratingLabel = ratingProvisional ? `${userRating}?` : String(userRating);

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

                    <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-[15px] font-semibold text-boxwood/90">
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

                        {/* Школа (14.2): три курса готовы — пункт вернулся в шапку (23.6). */}
                        <Link
                            to="/learn"
                            className={`flex items-center gap-2 transition ${
                                location.pathname.startsWith('/learn') ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <GraduationCap size={17}/> {t('learn.title')}
                        </Link>

                        <Link
                            to="/tournaments"
                            className={`flex items-center gap-2 transition ${
                                location.pathname.startsWith('/tournaments') ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Trophy size={17}/> {t('nav.tournaments')}
                        </Link>

                        {/* Тренажёры (19.1). */}
                        <Link
                            to="/train"
                            className={`flex items-center gap-2 transition ${
                                location.pathname.startsWith('/train') ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Dumbbell size={17}/> {t('trainers.title')}
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
                    {token && userProfile && <PlayerSearch/>}
                    {token && userProfile && <NotificationBell/>}
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
                                        className="text-xs text-amber-400 font-mono font-semibold"
                                        title={ratingProvisional ? t('nav.provisional') : undefined}>({ratingLabel})</span>
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
                                                className="text-xs text-amber-400 font-mono">{t('nav.rating', {rating: ratingLabel})}</div>
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
                                                navigate('/learn');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <GraduationCap size={16} className="text-amber-500"/> {t('learn.title')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/watch');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Eye size={16} className="text-amber-500"/> {t('watch.title')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/tools');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Wrench size={16} className="text-amber-500"/> {t('tools.title')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/teams');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Shield size={16} className="text-amber-500"/> {t('teams.title')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/study');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Presentation size={16} className="text-amber-500"/> {t('study.title')}
                                        </button>
                                        {showModeration && (
                                            <button
                                                onClick={() => {
                                                    setIsProfileOpen(false);
                                                    navigate('/moderation');
                                                }}
                                                className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                            >
                                                <Gavel size={16} className="text-amber-500"/> {t('moderation.title')}
                                            </button>
                                        )}
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
                        <Route path="/learn/basics" element={<BasicsPage/>}/>
                        <Route path="/learn/basics/:sectionId" element={<BasicsSectionPage/>}/>
                        <Route path="/learn/mates" element={<MateCoursePage/>}/>
                        <Route path="/learn/mates/exam" element={<MateExamPage/>}/>
                        <Route path="/learn/mates/:theme" element={<MateConstructionPage/>}/>
                        <Route path="/learn/classics" element={<ClassicsPage/>}/>
                        <Route path="/learn/classics/:gameId" element={<ClassicGamePage/>}/>
                        <Route path="/learn/endgames" element={<EndgamesPage/>}/>
                        <Route path="/learn/endgames/:exerciseId" element={<EndgameTrainerPage/>}/>
                        <Route path="/tools" element={<ToolsPage/>}/>
                        <Route path="/watch" element={<WatchPage/>}/>
                        <Route path="/arenas" element={<ArenasPage/>}/>
                        <Route path="/arenas/:arenaId" element={<ArenaPage/>}/>
                        <Route path="/teams" element={<TeamsPage/>}/>
                        <Route path="/study" element={<StudyLobby/>}/>
                        <Route path="/study/:code" element={<StudyRoomPage/>}/>
                        <Route path="/moderation" element={<ModerationPage/>}/>
                        <Route path="/train" element={<TrainersPage/>}/>
                        <Route path="/train/:trainerId" element={<TrainerPage/>}/>
                        <Route path="/guess" element={<GuessPage/>}/>
                        <Route path="/guess/:positionId" element={<GuessPage/>}/>
                    <Route path="/learn/:lessonId" element={<LessonPage/>}/>
                    <Route path="/tournaments" element={<TournamentsPage/>}/>
                    <Route path="/tournaments/:tournamentId" element={<TournamentView/>}/>
                    <Route path="/profile/:targetUsername" element={<Profile/>}/>
                    <Route path="/game/:gameId" element={<GameViewer/>}/>
                    <Route path="/champions/:championId" element={<ChampionGames/>}/>
                    <Route path="/about" element={<About/>}/>
                    <Route path="/verify-email" element={<VerifyEmailPage/>}/>
                    <Route path="/reset-password" element={<ResetPasswordPage/>}/>
                    <Route
                        path="/settings"
                        element={
                            <Settings
                                token={token}
                                username={userProfile?.username ?? null}
                                onTokenChange={setToken}
                                onLogoutEverywhere={handleLogoutEverywhere}
                                onAccountDeleted={handleLogout}
                            />
                        }
                    />
                </Routes>
            </main>
            <TranslationHelper/>

            {showAuthModal && (
                <AuthModal
                    onSuccess={(newToken) => {
                        setToken(newToken);
                        setShowAuthModal(false);
                    }}
                    onClose={() => setShowAuthModal(false)}
                    onFirstGame={(rating) => navigate('/', {state: {firstGame: {rating}}})}
                />
            )}
        </div>
    );
}