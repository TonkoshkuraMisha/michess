import { useState, useRef, useEffect } from 'react';
import Chessboard from './components/Chessboard';
import AuthModal from './components/AuthModal';
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
  LogIn
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
  const [showAuthModal, setShowAuthModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUserProfile(null);
    setIsProfileOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const username = userProfile?.username || 'Гость';
  const userRating = userProfile?.rating || 1200;

  return (
    <div className="min-h-screen flex flex-col bg-room text-paper font-sans select-none">

      {/* Верхняя панель навигации и брендинга */}
      <header className="bg-acacia-dark border-b-2 border-amber-900/60 px-6 py-3 flex items-center justify-between shadow-heavy relative z-30">

        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5 cursor-pointer group">
            <div className="w-9 h-9 rounded bg-boxwood flex items-center justify-center shadow-inner border border-amber-600/40 text-acacia-dark font-bold text-lg">
              ♞
            </div>
            <span className="text-2xl font-serif font-bold tracking-wider text-boxwood-light group-hover:text-white transition">
              michess
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 font-serif text-sm tracking-wide text-boxwood/80">
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><Swords size={16} /> Игра</button>
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
                <div className="w-8 h-8 rounded-full bg-boxwood text-acacia-dark font-bold flex items-center justify-center text-sm shadow">
                  {username.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col items-start hidden sm:flex">
                  <span className="font-serif font-semibold text-sm text-amber-200 leading-tight">{username}</span>
                  <span className="text-[10px] text-amber-400 font-mono">({userRating})</span>
                </div>
                <span className="text-xs text-amber-400 ml-0.5">▼</span>
              </div>

              {isProfileOpen && (
                <div className="absolute right-0 top-12 w-64 bg-[#261C14] border-2 border-amber-900/80 rounded shadow-2xl py-2 z-50 text-boxwood-light font-serif">
                  <div className="px-4 py-2.5 border-b border-amber-900/40 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-boxwood text-acacia-dark font-bold flex items-center justify-center text-base shadow">
                      {username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-amber-200">{username}</div>
                      <div className="text-xs text-amber-400 font-mono">Рейтинг: {userRating}</div>
                      <div className="text-xs text-emerald-400 flex items-center gap-1.5 mt-0.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> В сети
                      </div>
                    </div>
                  </div>

                  <div className="py-1 border-b border-amber-900/40 text-sm">
                    <button onClick={() => setIsProfileOpen(false)} className="w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-black/30 transition text-boxwood/90 hover:text-amber-300">
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
                    <span>ПИНГ 14 ms</span>
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

      {/* Основное рабочее пространство */}
      <main className="flex-1 flex items-center justify-center p-6">
        <Chessboard key={token ? token : 'guest'} />
      </main>

      {/* Модальное окно авторизации */}
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