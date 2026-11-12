// --- FILE: frontend/src/components/AuthModal.tsx ---

import {useEffect, useState} from 'react';
import {LogIn, UserPlus, X} from 'lucide-react';
import {API_BASE_URL} from '../config/api';
import {UiError, errorMessage, readApiErrorOr, serverErrorMessage} from '../services/apiErrors';
import {offerGuestPersonalityTransfer} from '../services/personalities';
import {useI18n} from '../i18n';
import {renderUiMessage, uiMessage} from '../i18n';
import type {UiMessage} from '../i18n';

/** Сообщение под заголовком: ошибка (ответ сервера по коду или своя) или успех регистрации. */
type Feedback = { tone: 'error' | 'success'; message: UiMessage };

interface AuthModalProps {
    onSuccess: (token: string) => void;
    /** Закрытие без входа: крестик, клик по затемнению или Esc. */
    onClose?: () => void;
}

export default function AuthModal({onSuccess, onClose}: AuthModalProps) {
    const {t} = useI18n();
    const [isLogin, setIsLogin] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!onClose) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFeedback(null);
        setLoading(true);

        try {
            if (isLogin) {
                // Логин (OAuth2 form URL encoded)
                const formData = new URLSearchParams();
                formData.append('username', username);
                formData.append('password', password);

                const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: formData,
                });

                if (!res.ok) {
                    // 429 — превышен лимит попыток: показываем, сколько ждать, а не «неверный пароль».
                    throw new UiError(await readApiErrorOr(
                        res, res.status === 429 ? 'auth.tooManyAttempts' : 'auth.wrongCredentials',
                    ));
                }
                const data = await res.json();
                localStorage.setItem('token', data.access_token);
                onSuccess(data.access_token);
                // Соперники, собранные гостем в этом браузере, — предложить перенести в профиль.
                offerGuestPersonalityTransfer(data.access_token)
                    .then((result) => {
                        if (result?.skipped.length) {
                            const list = result.skipped
                                .map((s) => t('auth.importSkippedItem', {
                                    name: s.name,
                                    reason: renderUiMessage(
                                        serverErrorMessage(s.reason, s.params) ?? {text: s.reason}, t,
                                    ),
                                }))
                                .join('; ');
                            window.alert(t('auth.importSkipped', {list}));
                        }
                    })
                    .catch((err) => window.alert(renderUiMessage(errorMessage(err, 'workshop.importFailed'), t)));
            } else {
                // Регистрация
                const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({username, password}),
                });

                if (!res.ok) {
                    throw new UiError(await readApiErrorOr(res, 'auth.registrationFailed'));
                }

                // Автоматический вход после успешной регистрации
                setIsLogin(true);
                setFeedback({tone: 'success', message: uiMessage('auth.registered')});
            }
        } catch (err) {
            setFeedback({tone: 'error', message: errorMessage(err, 'common.noConnection')});
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onMouseDown={(e) => {
                // Только клик по самому затемнению: выделение текста в поле, законченное за
                // пределами окна, закрывать его не должно.
                if (e.target === e.currentTarget) onClose?.();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="auth-modal-title"
                className="relative bg-[#261C14] border-2 border-amber-900/80 rounded-lg p-6 w-full max-w-md shadow-heavy text-boxwood-light font-serif">

                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        title={t('common.closeEsc')}
                        aria-label={t('common.close')}
                        className="absolute top-3 right-3 p-1 rounded text-boxwood/70 hover:text-amber-200 hover:bg-black/30 transition cursor-pointer"
                    >
                        <X size={18}/>
                    </button>
                )}

                <div className="flex justify-center mb-4">
                    <div
                        className="w-12 h-12 rounded bg-boxwood flex items-center justify-center text-acacia-dark font-bold text-2xl shadow-inner border border-amber-600/40">
                        ♞
                    </div>
                </div>

                <h2 id="auth-modal-title" className="text-2xl font-bold text-center text-amber-200 mb-1">
                    {t(isLogin ? 'auth.loginTitle' : 'auth.registerTitle')}
                </h2>
                <p className="text-xs text-center text-boxwood/70 mb-6">
                    {t(isLogin ? 'auth.loginSubtitle' : 'auth.registerSubtitle')}
                </p>

                {feedback && (
                    <div
                        role={feedback.tone === 'error' ? 'alert' : 'status'}
                        className={`p-3 mb-4 rounded text-xs text-center border ${feedback.tone === 'success' ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-200' : 'bg-red-950/80 border-red-800/50 text-red-200'}`}>
                        {renderUiMessage(feedback.message, t)}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                        <label htmlFor="auth-username" className="block text-xs text-boxwood/80 mb-1">{t('auth.username')}</label>
                        <input
                            id="auth-username"
                            autoComplete="username"
                            type="text"
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full px-3 py-2 bg-black/40 border border-amber-900/60 rounded text-amber-100 text-sm focus:outline-none focus:border-amber-600"
                            placeholder={t('auth.usernamePlaceholder')}
                        />
                    </div>

                    <div>
                        <label htmlFor="auth-password" className="block text-xs text-boxwood/80 mb-1">{t('auth.password')}</label>
                        <input
                            id="auth-password"
                            autoComplete={isLogin ? 'current-password' : 'new-password'}
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
                        {isLogin ? <LogIn size={18}/> : <UserPlus size={18}/>}
                        {loading ? t('auth.loading') : t(isLogin ? 'auth.submitLogin' : 'auth.submitRegister')}
                    </button>
                </form>

                <div className="mt-4 text-center text-xs">
                    <button
                        type="button"
                        onClick={() => {
                            setIsLogin(!isLogin);
                            setFeedback(null);
                        }}
                        className="text-amber-400 hover:underline"
                    >
                        {t(isLogin ? 'auth.toRegister' : 'auth.toLogin')}
                    </button>
                </div>

            </div>
        </div>
    );
}