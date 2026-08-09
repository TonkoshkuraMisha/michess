// --- FILE: frontend/src/App.tsx ---

import { useState, useRef, useEffect } from 'react';
import { Routes, Route, useNavigate, Link } from 'react-router-dom';
import Chessboard from './components/Chessboard';
import AuthModal from './components/AuthModal';
import Profile from './components/Profile';
import GameViewer from './components/GameViewer';
import ChampionGames from './components/ChampionGames';
import { CHAMPIONS_LIST } from './config/champions';

import {
  Search,
  Bell,
  Swords,
  BookOpen,
  Eye,
  Cpu,
  Wrench,
  LogOut,
  User,
  Mail,
  Settings,
  LogIn,
  Crown,
  ChevronDown
} from 'lucide-react';

interface UserProfile {
  id: number;
  username: string;
  rating: number;
  is_cheater: boolean;
  trust_factor: number;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isChampionsMenuOpen, setIsChampionsMenuOpen] = useState(false);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [serverPing, setServerPing] = useState<number | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const championsMenuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setUserProfile(null);
      return;
    }

    fetch('http://127.0.0.1:8000/api/v1/profile/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'accept': 'application/json'
      }
    })
      .then(res => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then(data => setUserProfile(data))
      .catch(() => {
        localStorage.removeItem('token');
        setToken(null);
        setUserProfile(null);
      });
  }, [token]);

  useEffect(() => {
    if (!isProfileOpen) return;
    const measurePing = async () => {
      const start = Date.now();
      try {
        await fetch('http://127.0.0.1:8000/health');
        setServerPing(Date.now() - start);
      } catch (e) {
        setServerPing(-1);
      }
    };
    measurePing();
    const interval = setInterval(measurePing, 3000);
    return () => clearInterval(interval);
  }, [isProfileOpen]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUserProfile(null);
    setIsProfileOpen(false);
    navigate('/');
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

  const username = userProfile?.username || 'Гость';
  const userRating = userProfile?.rating || 1200;

  return (
    <div className="min-h-screen flex flex-col bg-room text-paper font-sans select-none">

      <header className="bg-acacia-dark border-b-2 border-amber-900/60 px-6 py-3 flex items-center justify-between shadow-heavy relative z-30">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5 cursor-pointer group outline-none">
            <div className="w-9 h-9 rounded bg-boxwood flex items-center justify-center shadow-inner border border-amber-600/40 text-acacia-dark font-bold text-lg">
              ♞
            </div>
            <span className="text-2xl font-serif font-bold tracking-wider text-boxwood-light group-hover:text-white transition">
              michess
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-5 font-serif text-sm tracking-wide text-boxwood/80">
            <Link to="/" className="flex items-center gap-1.5 hover:text-amber-300 transition"><Swords size={16} /> Игра</Link>

            {/* Выпадающее меню легенд */}
            <div className="relative" ref={championsMenuRef}>
              <button
                onClick={() => setIsChampionsMenuOpen(!isChampionsMenuOpen)}
                className={`flex items-center gap-1.5 transition outline-none ${isChampionsMenuOpen ? 'text-amber-300' : 'hover:text-amber-300'}`}
              >
                <Crown size={16} /> Легенды шахмат <ChevronDown size={14} className={`transition-transform ${isChampionsMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isChampionsMenuOpen && (
                <div className="absolute top-full left-0 mt-4 w-72 bg-[#261C14] border-2 border-amber-900/80 rounded shadow-2xl z-50 max-h-[32rem] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                  {CHAMPIONS_LIST.map(champ => (
                    <Link
                      key={champ.id}
                      to={`/champions/${encodeURIComponent(champ.id)}`}
                      onClick={() => setIsChampionsMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/40 transition border-b border-amber-900/30 last:border-b-0 group outline-none"
                    >
                      <img
                        src={champ.img}
                        alt={champ.name}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 object-cover rounded shadow border border-amber-900/50 group-hover:border-amber-500/50 transition"
                      />
                      <div className="flex flex-col">
                        <span className="font-bold text-amber-200 text-sm group-hover:text-white transition">{champ.name}</span>
                        <span className="text-[10px] text-boxwood/60 font-mono group-hover:text-amber-400/80 transition">{champ.years}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><BookOpen size={16} /> Задачи</button>
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><Cpu size={16} /> Обучение</button>
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><Eye size={16} /> Просмотр</button>
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><Wrench size={16} /> Инструменты</button>
          </nav>
        </div>

        <div className="flex items-center gap-4 text-boxwood-light relative" ref={dropdownRef}>
          <button className="p-2 hover:bg-black/30 rounded transition text-boxwood/80 hover:text-amber-300" title="Поиск партии">
            <Search size={18} />
          </button>
          <button className="p-2 hover:bg-black/30 rounded transition text-boxwood/80 hover:text-amber-300" title="Уведомления">
            <Bell size={18} />
          </button>

          {token && userProfile ? (
            <>
              <div
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2 pl-3 border-l border-amber-900/50 cursor-pointer hover:opacity-80 transition select-none py-1 px-2 rounded hover:bg-black/20"
              >
                <img
                  src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${username}&backgroundColor=D0A972`}
                  alt="Avatar"
                  className="w-8 h-8 rounded bg-black/40 border border-amber-900/50 shadow"
                />
                <div className="flex flex-col items-start hidden sm:flex">
                  <span className="font-serif font-semibold text-sm text-amber-200 leading-tight">{username}</span>
                  <span className="text-[10px] text-amber-400 font-mono">({userRating})</span>
                </div>
                <span className="text-xs text-amber-400 ml-0.5">▼</span>
              </div>

              {isProfileOpen && (
                <div className="absolute right-0 top-12 w-64 bg-[#261C14] border-2 border-amber-900/80 rounded shadow-2xl py-2 z-50 text-boxwood-light font-serif">
                  <div className="px-4 py-2.5 border-b border-amber-900/40 flex items-center gap-3">
                    <img
                      src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${username}&backgroundColor=D0A972`}
                      alt="Avatar"
                      className="w-10 h-10 rounded bg-black/40 border border-amber-900/50 shadow"
                    />
                    <div>
                      <div className="font-bold text-amber-200">{username}</div>
                      <div className="text-xs text-amber-400 font-mono">Рейтинг: {userRating}</div>
                      <div className="text-xs text-emerald-400 flex items-center gap-1.5 mt-0.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> В сети
                      </div>
                    </div>
                  </div>

                  <div className="py-1 border-b border-amber-900/40 text-sm">
                    <button
                      onClick={() => { setIsProfileOpen(false); navigate(`/profile/${username}`); }}
                      className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300"
                    >
                      <User size={16} className="text-amber-500" /> Профиль
                    </button>
                    <button onClick={() => setIsProfileOpen(false)} className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300">
                      <Mail size={16} className="text-amber-500" /> Входящие
                    </button>
                    <button onClick={() => setIsProfileOpen(false)} className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300">
                      <Settings size={16} className="text-amber-500" /> Настройки
                    </button>
                    <button onClick={handleLogout} className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-red-950/40 transition text-red-300 hover:text-red-200">
                      <LogOut size={16} className="text-red-400" /> Выйти
                    </button>
                  </div>

                  <div className="px-4 py-2 text-[11px] font-mono text-boxwood/60 flex justify-between items-center bg-black/20">
                    <span>ПИНГ {serverPing !== null ? (serverPing === -1 ? 'ОШИБКА' : `${serverPing} ms`) : '...'}</span>
                    <span className="text-emerald-400 font-bold">● СЕРВЕР</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-boxwood text-acacia-dark font-bold text-sm rounded hover:bg-boxwood-light transition shadow border border-amber-600/40"
            >
              <LogIn size={16} /> Войти
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <Routes>
          <Route path="/" element={<Chessboard key={token ? token : 'guest'} />} />
          <Route path="/profile/:targetUsername" element={<Profile />} />
          <Route path="/game/:gameId" element={<GameViewer />} />
          <Route path="/champions/:championId" element={<ChampionGames />} />
        </Routes>
      </main>

      {showAuthModal && (
        <AuthModal
          onSuccess={(newToken) => {
            setToken(newToken);
            setShowAuthModal(false);
          }}
        />
      )}
    </div>
  );
}