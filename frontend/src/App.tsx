// --- FILE: frontend/src/App.tsx ---
// Каркас приложения: шапка (разделы, язык, поиск игроков, уведомления, сообщения, меню профиля), окно входа и все
// маршруты сайта (<Routes> в конце файла). При загрузке восстанавливает вход по refresh-cookie
// (services/authToken.ts) и ждёт этого не дольше SESSION_RESTORE_WAIT_MS; профиль (/profile/me) задаёт язык
// интерфейса, тему-комплект и аватар. Страницы разделов — в components/<раздел>/; новая страница добавляется сюда
// маршрутом и, если она без параметров, — в список ROUTES проверки вёрстки (e2e/layout.e2e.ts).

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
import {ImportPage} from './components/gameImport/ImportPage';
import {TransparencyPage} from './components/TransparencyPage';
import {PrivacyPage} from './components/PrivacyPage';
import {ArenaPage, ArenasPage} from './components/arena/ArenaPages';
import {ConferencesPage} from './components/arena/ConferencesPage';
import {TeamsPage} from './components/social/TeamsPage';
import {StudyLobby, StudyRoomPage} from './components/study/StudyPages';
import {ModerationPage} from './components/social/ModerationPage';
import {MessagesPage} from './components/social/MessagesPage';
import {FeedPage, PostPage} from './components/social/FeedPage';
import {CommunityRulesPage} from './components/social/Civility';
import {DesignGallery} from './components/DesignGallery';
import {MiniGamePage, MiniGamesPage} from './components/trainers/MiniGames';
import {MiniGameRoomPage} from './components/trainers/MiniGameRoom';
import {Chess960Page} from './components/chess960/Chess960Page';
import {Chess960LiveGame} from './components/chess960/Chess960LiveGame';
import {WorkoutPage} from './components/WorkoutPage';
import {ExamPage} from './components/ExamPage';
import {ProgramPage, ProgramsPage} from './components/ProgramsPage';
import {SupercoursePage} from './components/learn/SupercoursePage';
import {PageErrorBoundary} from './components/PageErrorBoundary';
import {RepertoireEditorPage, RepertoireListPage} from './components/repertoire/RepertoirePages';
import {LibraryPage} from './components/library/LibraryPage';
import {RepertoireDrillPage} from './components/repertoire/RepertoireDrill';
import {moderationApi} from './services/moderation';
import {ReportProblem} from './components/beta/ReportProblem';
import {useSiteConfig} from './services/beta';
import {TrainerPage, TrainersPage} from './components/trainers/TrainersPage';
import {NotificationBell, PlayerSearch} from './components/social/SocialHeader';
import {TournamentView, TournamentsPage} from './components/tournaments/TournamentsPage';
import {TimeMachinePage} from './components/tournaments/TimeMachine';
import {MastersPage} from './components/tournaments/MastersPage';
import {CHAMPIONS_LIST} from './config/champions';
import {API_BASE_URL} from './config/api';
import {gameSocket} from './services/gameSocket';
import * as auth from './services/authToken';
import {isLearningPath, setCheckSounds} from './services/soundEngine';

import {
    Swords,
    Bug,
    LogOut,
    User,
    Settings as SettingsIcon,
    LogIn,
    Crown,
    Medal,
    ChevronDown,
    Trophy,
    Scale,
    Puzzle,
    CloudDownload,
    GraduationCap,
    Eye,
    Wrench,
    Dumbbell,
    Shield,
    Presentation,
    Gavel,
    Newspaper,
    MessageSquare
} from 'lucide-react';
import {isLanguage, useI18n} from './i18n';
import {saveProfileSettings, setTranslationHelper} from './services/profileSettings';
import {applyPreset, findPreset, getSavedPresetId} from './config/themePresets';
import {TranslationHelper} from './components/social/TranslationHelper';
import {PlayerAvatar} from './components/PlayerAvatar';
import {loadUnlocks} from './config/unlocks';
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
    /** Аватар из собственного набора (таск 18.4). */
    avatar?: string | null;
}

/** Сколько ждать восстановления входа, прежде чем показать страницу без него. */
export const SESSION_RESTORE_WAIT_MS = 3000;

export default function App() {
    const {t, language, setLanguage} = useI18n();
    // Токен — в памяти (services/authToken): при загрузке вход восстанавливается по httpOnly-cookie (таск 17.5).
    const [token, setToken] = useState<string | null>(() => auth.getToken());
    // Страницы рисуются после первой попытки восстановить вход (cookie → токен). Иначе при прямом заходе и при
    // обновлении страницы они запрашивали данные раньше, чем появлялся токен, и получали 401: «Машина времени»
    // показывала «Не удалось загрузить турниры», страница турнира — ошибку, список турниров оставался пустым.
    const [sessionChecked, setSessionChecked] = useState<boolean>(() => auth.getToken() !== null);
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
    // Открываемое оформление (таск 18.4): полученные достижения игрока; гость — ничего.
    useEffect(() => {
        void loadUnlocks(token && userProfile ? userProfile.username : null);
    }, [token, userProfile?.username]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // Программа беты (таск 24.4): «Сообщить о проблеме» — с любой страницы; закрыта ли регистрация — с сервера.
    const [showReport, setShowReport] = useState(false);
    const siteConfig = useSiteConfig();
    const [serverPing, setServerPing] = useState<number | null>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const championsMenuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const location = useLocation();
    // Ссылка-приглашение (/?invite=КОД): код запоминается, из адреса убирается, гостю сразу открывается регистрация.
    const [inviteCode] = useState(() => new URLSearchParams(location.search).get('invite')?.trim() || undefined);

    // Звук шаха — только в обучающих разделах; в партиях он отвлекает (решение владельца, 17.11).
    useEffect(() => {
        setCheckSounds(isLearningPath(location.pathname));
    }, [location.pathname]);

    const isSingleScreenRoute =
        location.pathname === '/' ||
        location.pathname.startsWith('/challenge/') ||
        // Просмотр партии — тот же экран с доской и для библиотеки, и для партий с других сайтов: иначе панель
        // с ходами растягивается на всю партию, и страница едет вслед за текущим ходом.
        /^\/(game|library\/game|import\/game)\//.test(location.pathname);

    useEffect(() => {
        const unsubscribe = auth.onTokenChange((current) => {
            setToken(current);
            if (!current) {
                setUserProfile(null);
                gameSocket.disconnect();
            }
        });
        // Страховка: если сервер не отвечает на восстановление входа, страницы не ждут его дольше трёх секунд —
        // гость должен видеть хотя бы то, что не требует сервера.
        const giveUp = setTimeout(() => setSessionChecked(true), SESSION_RESTORE_WAIT_MS);
        void Promise.resolve(auth.restoreSession()).then((restored) => {
            clearTimeout(giveUp);
            setSessionChecked(true);
            if (inviteCode && !restored) setShowAuthModal(true);
        });
        return () => {
            clearTimeout(giveUp);
            unsubscribe();
        };
    }, [inviteCode]);

    useEffect(() => {
        if (inviteCode && new URLSearchParams(location.search).has('invite')) {
            navigate(location.pathname, {replace: true});
        }
    }, [inviteCode, location.pathname, location.search, navigate]);

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

    // Подписи пунктов меню видны с той ширины, где шапка помещается целиком; уже — остаются значки с подсказками.
    // Шрифт интерфейса системный, и ширина текста зависит от системы игрока: на Linux (и там, где установлен Inter)
    // он на 9–10 % шире, чем Segoe UI на Windows. Пороги взяты по широкому шрифту (замер 17.11 с Verdana, которая
    // ещё на 15–25 px шире шрифта сборки в CI): гостю с подписями нужно до 1335 px, вошедшему игроку без самой
    // длинной подписи («Легенды шахмат») — до 1340 px, со всеми подписями — до 1465 px.
    const navLabel = 'hidden min-[1360px]:inline';
    const legendsLabel = token && userProfile ? 'hidden min-[1500px]:inline' : navLabel;

    return (
        <div
            className={`w-full flex flex-col text-paper font-sans select-none ${
                isSingleScreenRoute ? 'min-h-dvh xl:h-dvh xl:overflow-hidden' : 'min-h-dvh'
            }`}
        >
            <header
                className="h-14 shrink-0 bg-acacia-dark border-b-2 border-amber-900/60 px-3 sm:px-5 flex items-center justify-between shadow-heavy relative z-30">
                <div className="flex items-center gap-4 2xl:gap-7">
                    {/* Название у вошедшего игрока — с 720 px: на 640 px оно появлялось вместе с именем игрока, и шапке
                        с длинным именем не хватало места (на Windows — 8 px, с широким шрифтом — больше). */}
                    <Link to="/" className="flex items-center gap-2.5 cursor-pointer group outline-none">
                        <div
                            className="w-9 h-9 rounded-md bg-boxwood flex items-center justify-center shadow-inner border border-amber-600/40 text-acacia-dark font-bold text-xl">
                            ♞
                        </div>
                        <span
                            className={`hidden ${token && userProfile ? "min-[720px]:inline md:hidden lg:inline" : "min-[440px]:inline"} text-2xl font-extrabold tracking-wide text-boxwood-light group-hover:text-white transition`}>
                            regence
                        </span>
                    </Link>

                    <nav className="hidden md:flex items-center gap-3 2xl:gap-4 whitespace-nowrap text-[15px] font-semibold text-boxwood/90">
                        <Link
                            to="/"
                            title={t('nav.play')}
                            aria-label={t('nav.play')}
                            className={`flex items-center gap-1.5 transition ${
                                location.pathname === '/' ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Swords size={17}/> <span className={navLabel}>{t('nav.play')}</span>
                        </Link>

                        <Link
                            to="/puzzles"
                            title={t('nav.puzzles')}
                            aria-label={t('nav.puzzles')}
                            className={`flex items-center gap-1.5 transition ${
                                location.pathname === '/puzzles' ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Puzzle size={17}/> <span className={navLabel}>{t('nav.puzzles')}</span>
                        </Link>

                        {/* Школа (14.2): три курса готовы — пункт вернулся в шапку (23.6). */}
                        <Link
                            to="/learn"
                            title={t('learn.title')}
                            aria-label={t('learn.title')}
                            className={`flex items-center gap-1.5 transition ${
                                location.pathname.startsWith('/learn') ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <GraduationCap size={17}/> <span className={navLabel}>{t('learn.title')}</span>
                        </Link>

                        <Link
                            to="/tournaments"
                            title={t('nav.tournaments')}
                            aria-label={t('nav.tournaments')}
                            className={`flex items-center gap-1.5 transition ${
                                location.pathname.startsWith('/tournaments') ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Trophy size={17}/> <span className={navLabel}>{t('nav.tournaments')}</span>
                        </Link>

                        {/* Тренажёры (19.1). */}
                        <Link
                            to="/train"
                            title={t('trainers.title')}
                            aria-label={t('trainers.title')}
                            className={`flex items-center gap-1.5 transition ${
                                location.pathname.startsWith('/train') ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Dumbbell size={17}/> <span className={navLabel}>{t('trainers.title')}</span>
                        </Link>

                        <Link
                            to="/leaderboard"
                            title={t('nav.leaderboard')}
                            aria-label={t('nav.leaderboard')}
                            className={`flex items-center gap-1.5 transition ${
                                location.pathname === '/leaderboard' ? 'text-amber-300' : 'hover:text-amber-300'
                            }`}
                        >
                            <Medal size={17}/> <span className={navLabel}>{t('nav.leaderboard')}</span>
                        </Link>

                        <div className="relative" ref={championsMenuRef}>
                            <button
                                onClick={() => setIsChampionsMenuOpen(!isChampionsMenuOpen)}
                                title={t('nav.legends')}
                                aria-label={t('nav.legends')}
                                className={`flex items-center gap-1.5 transition outline-none cursor-pointer ${
                                    isChampionsMenuOpen || location.pathname.startsWith('/champions')
                                        ? 'text-amber-300'
                                        : 'hover:text-amber-300'
                                }`}
                            >
                                <Crown size={17}/> <span className={legendsLabel}>{t('nav.legends')}</span>
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
                                    {/* Каталог мастеров прошлого (таск 28.5): участники исторических турниров. */}
                                    <Link to="/masters" onClick={() => setIsChampionsMenuOpen(false)} data-testid="nav-masters"
                                          className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-black/40 transition outline-none">
                                        <span className="font-bold text-amber-200 text-[15px]">{t('masters.title')}</span>
                                        <span className="text-xs text-boxwood/70">{t('masters.teaser')}</span>
                                    </Link>
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
                    {/* Вошедшему на узком экране — пункт в меню профиля: в шапке не хватает места. */}
                    <button
                        type="button"
                        onClick={() => setShowReport(true)}
                        data-testid="report-problem-open"
                        className={`${token && userProfile ? 'hidden sm:block' : ''} p-2 hover:bg-black/30 rounded-md transition text-boxwood/85 hover:text-amber-300 cursor-pointer`}
                        title={t('nav.reportProblem')}
                        aria-label={t('nav.reportProblem')}
                    >
                        <Bug size={19}/>
                    </button>
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
                                className="flex items-center gap-1.5 sm:gap-2.5 border-l border-amber-900/50 cursor-pointer hover:opacity-90 transition select-none py-1 pl-1.5 pr-1 sm:pl-3 sm:pr-2.5 rounded-md hover:bg-black/25"
                            >
                                <PlayerAvatar username={username} avatar={userProfile.avatar}
                                              className="w-8 h-8 rounded border border-amber-900/50 shadow"/>
                                <div className="flex-col items-start hidden sm:flex md:hidden lg:flex">
                                    <span className="font-bold text-sm text-amber-200 leading-tight max-w-[7rem] truncate"
                                          title={username}>{username}</span>
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
                                        <PlayerAvatar username={username} avatar={userProfile.avatar}
                                                      className="w-10 h-10 rounded border border-amber-900/50 shadow"/>
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
                                                navigate('/import');
                                            }}
                                            data-testid="nav-import"
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <CloudDownload size={16} className="text-amber-500"/> {t('nav.importGames')}
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
                                                navigate('/feed');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Newspaper size={16} className="text-amber-500"/> {t('feed.title')}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                navigate('/messages');
                                            }}
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <MessageSquare size={16} className="text-amber-500"/> {t('dm.title')}
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
                                            onClick={() => {
                                                setIsProfileOpen(false);
                                                setShowReport(true);
                                            }}
                                            data-testid="report-problem-menu"
                                            className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300 cursor-pointer"
                                        >
                                            <Bug size={16} className="text-amber-500"/> {t('nav.reportProblem')}
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
                <PageErrorBoundary resetKey={location.pathname}>
                {!sessionChecked ? (
                    // Пока неизвестно, вошёл ли игрок: место страницы пустое (доли секунды), шапка уже на месте.
                    <div className="flex-1" data-testid="session-restoring" aria-busy="true"/>
                ) : (
                <Routes>
                    <Route path="/" element={<Chessboard key={token ? token : 'guest'}/>}/>
                    <Route path="/challenge/:inviteCode" element={<Chessboard key={token ? token : 'guest'}/>}/>
                    <Route path="/leaderboard" element={<Leaderboard/>}/>
                    <Route path="/puzzles" element={<PuzzlesPage/>}/>
                    <Route path="/learn" element={<LearnPage/>}/>
                        <Route path="/learn/course" element={<SupercoursePage/>}/>
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
                        <Route path="/conferences" element={<ConferencesPage/>}/>
                        <Route path="/teams" element={<TeamsPage/>}/>
                        <Route path="/study" element={<StudyLobby/>}/>
                        <Route path="/study/:code" element={<StudyRoomPage/>}/>
                        <Route path="/moderation" element={<ModerationPage/>}/>
                        <Route path="/messages" element={<MessagesPage/>}/>
                        <Route path="/messages/:username" element={<MessagesPage/>}/>
                        <Route path="/feed" element={<FeedPage/>}/>
                        <Route path="/feed/post/:postId" element={<PostPage/>}/>
                        <Route path="/rules" element={<CommunityRulesPage/>}/>
                        <Route path="/privacy" element={<PrivacyPage/>}/>
                        {/* Витрина общих компонентов дизайна — в меню нет (docs/design-system.md). */}
                        <Route path="/design" element={<DesignGallery/>}/>
                        <Route path="/train" element={<TrainersPage/>}/>
                        <Route path="/train/games" element={<MiniGamesPage/>}/>
                        <Route path="/play/960" element={<Chess960Page/>}/>
                        <Route path="/play/960/live" element={<Chess960LiveGame/>}/>
                        <Route path="/workout" element={<WorkoutPage/>}/>
                        <Route path="/exam" element={<ExamPage/>}/>
                        <Route path="/programs" element={<ProgramsPage/>}/>
                        <Route path="/programs/:programId" element={<ProgramPage/>}/>
                        <Route path="/repertoire" element={<RepertoireListPage/>}/>
                        <Route path="/repertoire/:repertoireId" element={<RepertoireEditorPage/>}/>
                        <Route path="/repertoire/:repertoireId/drill" element={<RepertoireDrillPage/>}/>
                        <Route path="/train/games/:gameId" element={<MiniGamePage/>}/>
                        <Route path="/train/games/room/:code" element={<MiniGameRoomPage/>}/>
                        <Route path="/train/:trainerId" element={<TrainerPage/>}/>
                        <Route path="/guess" element={<GuessPage/>}/>
                        <Route path="/guess/:positionId" element={<GuessPage/>}/>
                    <Route path="/learn/:lessonId" element={<LessonPage/>}/>
                    <Route path="/tournaments" element={<TournamentsPage/>}/>
                    <Route path="/tournaments/:tournamentId" element={<TournamentView/>}/>
                    <Route path="/time-machine" element={<TimeMachinePage/>}/>
                    <Route path="/masters" element={<MastersPage/>}/>
                    <Route path="/profile/:targetUsername" element={<Profile/>}/>
                    <Route path="/game/:gameId" element={<GameViewer/>}/>
                    <Route path="/import" element={<ImportPage/>}/>
                    <Route path="/import/game/:gameId" element={<GameViewer key="imported" imported/>}/>
                    <Route path="/library" element={<LibraryPage/>}/>
                    <Route path="/library/game/:gameId" element={<GameViewer key="library" library/>}/>
                    <Route path="/champions/:championId" element={<ChampionGames/>}/>
                    <Route path="/about" element={<About/>}/>
                    <Route path="/transparency" element={<TransparencyPage username={username}/>}/>
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
                )}
                </PageErrorBoundary>
            </main>
            <TranslationHelper/>
            {showReport && <ReportProblem onClose={() => setShowReport(false)}/>}

            {showAuthModal && (
                <AuthModal
                    onSuccess={(newToken) => {
                        setToken(newToken);
                        setShowAuthModal(false);
                    }}
                    onClose={() => setShowAuthModal(false)}
                    onFirstGame={(rating) => navigate('/', {state: {firstGame: {rating}}})}
                    onBasics={() => navigate('/learn/basics')}
                    inviteOnly={siteConfig.inviteOnly}
                    inviteCode={inviteCode}
                />
            )}
        </div>
    );
}