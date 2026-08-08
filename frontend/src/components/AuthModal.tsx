// --- FILE: frontend/src/components/AuthModal.tsx ---

import { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';

interface AuthModalProps {
  onSuccess: (token: string) => void;
}

export default function AuthModal({ onSuccess }: AuthModalProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        // Логин (OAuth2 form URL encoded)
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch('http://127.0.0.1:8000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData,
        });

        if (!res.ok) throw new Error('Неверное имя пользователя или пароль');
        const data = await res.json();
        localStorage.setItem('token', data.access_token);
        onSuccess(data.access_token);
      } else {
        // Регистрация
        const res = await fetch('http://127.0.0.1:8000/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || 'Ошибка регистрации');
        }

        // Автоматический вход после успешной регистрации
        setIsLogin(true);
        setError('Регистрация успешна! Теперь войдите в систему.');
      }
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#261C14] border-2 border-amber-900/80 rounded-lg p-6 w-full max-w-md shadow-heavy text-boxwood-light font-serif">

        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded bg-boxwood flex items-center justify-center text-acacia-dark font-bold text-2xl shadow-inner border border-amber-600/40">
            ♞
          </div>
        </div>

        <h2 className="text-2xl font-bold text-center text-amber-200 mb-1">
          {isLogin ? 'Вход в michess' : 'Регистрация аккаунта'}
        </h2>
        <p className="text-xs text-center text-boxwood/70 mb-6">
          {isLogin ? 'Введите свои учетные данные для игры' : 'Создайте новый аккаунт для старта'}
        </p>

        {error && (
          <div className={`p-3 mb-4 rounded text-xs text-center border ${error.includes('успешна') ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-200' : 'bg-red-950/80 border-red-800/50 text-red-200'}`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs text-boxwood/80 mb-1">Имя пользователя (Логин)</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-black/40 border border-amber-900/60 rounded text-amber-100 text-sm focus:outline-none focus:border-amber-600"
              placeholder="например, string1"
            />
          </div>

          <div>
            <label className="block text-xs text-boxwood/80 mb-1">Пароль</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-black/40 border border-amber-900/60 rounded text-amber-100 text-sm focus:outline-none focus:border-amber-600"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex items-center justify-center gap-2 py-2.5 bg-boxwood text-acacia-dark font-bold rounded hover:bg-boxwood-light transition shadow border border-amber-600/40 disabled:opacity-50"
          >
            {isLogin ? <LogIn size={18} /> : <UserPlus size={18} />}
            {loading ? 'Загрузка...' : (isLogin ? 'Войти' : 'Зарегистрироваться')}
          </button>
        </form>

        <div className="mt-4 text-center text-xs">
          <button
            type="button"
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            className="text-amber-400 hover:underline"
          >
            {isLogin ? 'Нет аккаунта? Зарегистрируйтесь' : 'Уже есть аккаунт? Войдите'}
          </button>
        </div>

      </div>
    </div>
  );
}