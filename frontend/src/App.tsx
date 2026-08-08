import Chessboard from './components/Chessboard';
import { Search, Bell, Swords, BookOpen, Eye, Cpu, Wrench } from 'lucide-react';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-room text-paper font-sans select-none">

      {/* Верхняя панель навигации и брендинга в английском стиле */}
      <header className="bg-acacia-dark border-b-2 border-amber-900/60 px-6 py-3 flex items-center justify-between shadow-heavy relative z-30">

        {/* Левая часть: Бренд и основное меню */}
        <div className="flex items-center gap-8">
          {/* Бренд (Логотип и название сайта) */}
          <div className="flex items-center gap-2.5 cursor-pointer group">
            <div className="w-9 h-9 rounded bg-boxwood flex items-center justify-center shadow-inner border border-amber-600/40 text-acacia-dark font-bold text-lg">
              ♞
            </div>
            <span className="text-2xl font-serif font-bold tracking-wider text-boxwood-light group-hover:text-white transition">
              michess
            </span>
          </div>

          {/* Основные пункты меню */}
          <nav className="hidden md:flex items-center gap-6 font-serif text-sm tracking-wide text-boxwood/80">
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><Swords size={16} /> Игра</button>
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><BookOpen size={16} /> Задачи</button>
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><Cpu size={16} /> Обучение</button>
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><Eye size={16} /> Просмотр</button>
            <button className="flex items-center gap-1.5 hover:text-amber-300 transition"><Wrench size={16} /> Инструменты</button>
          </nav>
        </div>

        {/* Правая часть: Быстрый поиск, уведомления и профиль игрока */}
        <div className="flex items-center gap-4 text-boxwood-light">
          <button className="p-2 hover:bg-black/30 rounded transition text-boxwood/80 hover:text-amber-300" title="Поиск партии">
            <Search size={18} />
          </button>
          <button className="p-2 hover:bg-black/30 rounded transition text-boxwood/80 hover:text-amber-300" title="Уведомления">
            <Bell size={18} />
          </button>
          <div className="flex items-center gap-2 pl-3 border-l border-amber-900/50 cursor-pointer hover:opacity-80 transition">
            <div className="w-8 h-8 rounded-full bg-boxwood text-acacia-dark font-bold flex items-center justify-center text-sm shadow">
              M
            </div>
            <span className="font-serif font-semibold text-sm text-amber-200 hidden sm:inline">Mykhaylo_T</span>
          </div>
        </div>

      </header>

      {/* Основное рабочее пространство */}
      <main className="flex-1 flex items-center justify-center p-6">
        <Chessboard />
      </main>

    </div>
  );
}