// --- FILE: frontend/src/components/AuthModal.tsx ---
// Окно входа и регистрации. Регистрация: имя и пароль (правила имени проверяет сервер, src/schemas/user.py), два
// необязательных вопроса о стаже и силе — по ним сервер ставит стартовый рейтинг, код-приглашение, если регистрация
// закрыта (программа беты). Отказы сервера приходят кодами и показываются текстом из каталога serverErrors. После
// входа access-токен хранится только в памяти страницы (services/authToken.ts).

import {useEffect, useState} from 'react';
import {LogIn, UserPlus, X} from 'lucide-react';
import {accountApi} from '../services/account';
import {errorMessage, serverErrorMessage} from '../services/apiErrors';
import {offerGuestPersonalityTransfer} from '../services/personalities';
import {EXPERIENCES, PROVISIONAL_GAMES, STRENGTH_BANDS} from '../services/onboarding';
import type {Experience, StrengthBand} from '../services/onboarding';
import {useI18n} from '../i18n';
import {renderUiMessage, uiMessage} from '../i18n';
import type {UiMessage} from '../i18n';
import {setToken} from '../services/authToken';
import {betaApi} from '../services/beta';

/** Сообщение под заголовком: ошибка (ответ сервера по коду или своя) или успех регистрации. */
type Feedback = { tone: 'error' | 'success'; message: UiMessage };

interface AuthModalProps {
    onSuccess: (token: string) => void;
    /** Закрытие без входа: крестик, клик по затемнению или Esc. */
    onClose?: () => void;
    /** «Сыграть первую партию» после регистрации (таск 17.8): стартовый рейтинг игрока. */
    onFirstGame?: (rating: number) => void;
    /** Новичку («только начинаю») — переход в азбуку (14.5). */
    onBasics?: () => void;
    /** Закрытая регистрация (таск 24.4): без кода-приглашения аккаунт не создать. */
    inviteOnly?: boolean;
    /** Код из ссылки-приглашения: окно открывается сразу на регистрации, код уже вписан. */
    inviteCode?: string;
}

/**
 * Окно входа и регистрации. Вход — POST /auth/login (форма OAuth2), регистрация — POST /auth/register, сброс
 * пароля — POST /account/password-reset; после регистрации показывается приветствие, а вход выполняется сразу.
 */
export default function AuthModal({onSuccess, onClose: onCloseProp, onFirstGame, onBasics, inviteOnly = false, inviteCode}: AuthModalProps) {
    const {t, tp, language} = useI18n();
    const [isLogin, setIsLogin] = useState(!inviteCode);
    const [invite, setInvite] = useState(inviteCode ?? '');
    // Согласие с правилами и конфиденциальностью (таск 23.1): без отметки регистрация не отправляется.
    const [acceptTerms, setAcceptTerms] = useState(false);
    // Код из ссылки проверяется сразу: о недействительном приглашении лучше узнать до заполнения формы.
    const [inviteValid, setInviteValid] = useState<boolean | null>(null);
    useEffect(() => {
        if (!inviteCode) return;
        let cancelled = false;
        betaApi.checkInvite(inviteCode).then((valid) => {
            if (!cancelled) setInviteValid(valid);
        }).catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [inviteCode]);
    const showInvite = inviteOnly || Boolean(inviteCode);
    const [experience, setExperience] = useState<Experience | ''>('');
    const [strength, setStrength] = useState<StrengthBand | ''>('');
    // После регистрации игрок уже вошёл: окно приветствия, закрытие окна — тоже вход.
    const [welcome, setWelcome] = useState<{ token: string; rating: number } | null>(null);
    const onClose = welcome ? () => onSuccess(welcome.token) : onCloseProp;
    // «Забыли пароль?» (таск 17.5): письмо со ссылкой на привязанный e-mail.
    const [forgot, setForgot] = useState(false);
    const [email, setEmail] = useState('');
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

    const requestReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setFeedback(null);
        setLoading(true);
        try {
            await accountApi.requestPasswordReset(email, language);
            setFeedback({tone: 'success', message: uiMessage('auth.resetSent')});
        } catch (err) {
            setFeedback({tone: 'error', message: errorMessage(err, 'common.noConnection')});
        } finally {
            setLoading(false);
        }
    };

    /** Вход по имени и паролю из формы: токен сохраняется, гостевые соперники предлагаются к переносу. */
    const signIn = async (): Promise<string> => {
        // Форма OAuth2 и refresh-cookie долгого входа (таск 17.5); 429 — сколько ждать, а не «неверный пароль».
        const accessToken = await accountApi.login(username, password);
        setToken(accessToken);
        // Соперники, собранные гостем в этом браузере, — предложить перенести в профиль.
        offerGuestPersonalityTransfer(accessToken)
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
        return accessToken;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFeedback(null);
        setLoading(true);

        try {
            if (isLogin) {
                onSuccess(await signIn());
            } else {
                // Регистрация; ответы о силе необязательны (таск 17.8) — по ним сервер ставит стартовый рейтинг.
                const created = await accountApi.register({
                    username, password, accept_terms: acceptTerms,
                    ...(experience ? {experience} : {}),
                    ...(strength && experience !== 'new' ? {strength} : {}),
                    ...(showInvite && invite.trim() ? {invite_code: invite.trim()} : {}),
                });
                // Сразу вход и приветствие с предложением первой партии.
                try {
                    setWelcome({token: await signIn(), rating: created.blitz_rating});
                } catch {
                    setIsLogin(true);
                    setFeedback({tone: 'success', message: uiMessage('auth.registered')});
                }
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
                    {welcome ? t('auth.welcomeTitle', {name: username})
                        : t(forgot ? 'auth.forgotTitle' : isLogin ? 'auth.loginTitle' : 'auth.registerTitle')}
                </h2>
                {!welcome && (
                    <p className="text-xs text-center text-boxwood/70 mb-6">
                        {t(forgot ? 'auth.forgotNote' : isLogin ? 'auth.loginSubtitle' : 'auth.registerSubtitle')}
                    </p>
                )}

                {feedback && (
                    <div
                        role={feedback.tone === 'error' ? 'alert' : 'status'}
                        className={`p-3 mb-4 rounded text-xs text-center border ${feedback.tone === 'success' ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-200' : 'bg-red-950/80 border-red-800/50 text-red-200'}`}>
                        {renderUiMessage(feedback.message, t)}
                    </div>
                )}

                {welcome ? (
                    <div className="flex flex-col gap-4 mt-4" data-testid="auth-welcome">
                        <p className="text-sm text-center text-boxwood-light">
                            {tp('auth.welcomeRating', PROVISIONAL_GAMES, {rating: welcome.rating})}
                        </p>
                        {experience === 'new' && onBasics && (
                            // Только узнал правила (17.8): сначала азбука 14.5, партия — по желанию следом.
                            <>
                                <p className="text-sm text-center text-boxwood/85">{t('auth.basicsHint')}</p>
                                <button type="button" data-testid="auth-start-basics"
                                        onClick={() => {
                                            onSuccess(welcome.token);
                                            onBasics();
                                        }}
                                        className="py-2.5 bg-amber-700 text-white font-bold rounded hover:bg-amber-600 transition shadow">
                                    {t('auth.startBasics')}
                                </button>
                            </>
                        )}
                        <button type="button" data-testid="auth-first-game"
                                onClick={() => {
                                    onSuccess(welcome.token);
                                    onFirstGame?.(welcome.rating);
                                }}
                                className="py-2.5 bg-boxwood text-acacia-dark font-bold rounded hover:bg-boxwood-light transition shadow border border-amber-600/40">
                            {t('auth.playFirstGame')}
                        </button>
                        <button type="button" onClick={() => onSuccess(welcome.token)}
                                className="text-xs text-amber-400 hover:underline">
                            {t('auth.later')}
                        </button>
                    </div>
                ) : forgot ? (
                    <form onSubmit={(e) => void requestReset(e)} className="flex flex-col gap-4" data-testid="forgot-form">
                        <div>
                            <label htmlFor="auth-email" className="block text-xs text-boxwood/80 mb-1">{t('auth.email')}</label>
                            <input id="auth-email" type="email" autoComplete="email" required value={email}
                                   onChange={(e) => setEmail(e.target.value)}
                                   className="w-full px-3 py-2 bg-black/40 border border-amber-900/60 rounded text-amber-100 text-sm focus:outline-none focus:border-amber-600"/>
                        </div>
                        <button type="submit" disabled={loading}
                                className="mt-2 py-2.5 bg-boxwood text-acacia-dark font-bold rounded hover:bg-boxwood-light transition shadow border border-amber-600/40 disabled:opacity-50">
                            {loading ? t('auth.loading') : t('auth.sendResetLink')}
                        </button>
                    </form>
                ) : (
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

                    {!isLogin && showInvite && (
                        <div>
                            <label htmlFor="auth-invite" className="block text-xs text-boxwood/80 mb-1">{t('auth.inviteCode')}</label>
                            <input id="auth-invite" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                                   required={inviteOnly} maxLength={32} value={invite} data-testid="auth-invite"
                                   onChange={(e) => {
                                       setInvite(e.target.value);
                                       setInviteValid(null);
                                   }}
                                   className="w-full px-3 py-2 bg-black/40 border border-amber-900/60 rounded text-amber-100 text-sm font-mono uppercase focus:outline-none focus:border-amber-600"/>
                            {inviteValid !== null && (
                                <p className={`text-xs mt-1 ${inviteValid ? 'text-emerald-300' : 'text-rose-300'}`} data-testid="auth-invite-status">
                                    {t(inviteValid ? 'auth.inviteValid' : 'auth.inviteNotValid')}
                                </p>
                            )}
                            {inviteOnly && <p className="text-xs text-boxwood/65 mt-1" data-testid="auth-invite-only">{t('auth.inviteOnlyNote')}</p>}
                        </div>
                    )}

                    {!isLogin && (
                        <>
                            <div>
                                <label htmlFor="auth-experience" className="block text-xs text-boxwood/80 mb-1">{t('auth.experienceLabel')}</label>
                                <select id="auth-experience" value={experience}
                                        onChange={(e) => setExperience(e.target.value as Experience | '')}
                                        className="w-full px-3 py-2 bg-black/40 border border-amber-900/60 rounded text-amber-100 text-sm focus:outline-none focus:border-amber-600">
                                    <option value="">{t('auth.notAnswered')}</option>
                                    {EXPERIENCES.map((value) => <option key={value} value={value}>{t(`auth.experience.${value}`)}</option>)}
                                </select>
                            </div>
                            {experience !== 'new' && (
                                <div>
                                    <label htmlFor="auth-strength" className="block text-xs text-boxwood/80 mb-1">{t('auth.strengthLabel')}</label>
                                    <select id="auth-strength" value={strength}
                                            onChange={(e) => setStrength(e.target.value as StrengthBand | '')}
                                            className="w-full px-3 py-2 bg-black/40 border border-amber-900/60 rounded text-amber-100 text-sm focus:outline-none focus:border-amber-600">
                                        <option value="">{t('auth.notAnswered')}</option>
                                        {STRENGTH_BANDS.map((value) => <option key={value} value={value}>{t(`auth.strength.${value}`)}</option>)}
                                    </select>
                                </div>
                            )}
                            <label className="flex items-start gap-2 text-xs text-boxwood/85" htmlFor="auth-terms">
                                <input id="auth-terms" type="checkbox" required checked={acceptTerms} data-testid="auth-terms"
                                       onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5"/>
                                <span>
                                    {t('auth.acceptTermsLead')}{' '}
                                    <a href="/rules" target="_blank" rel="noreferrer" className="underline">{t('auth.termsRulesLink')}</a>{' '}
                                    {t('auth.termsAnd')}{' '}
                                    <a href="/privacy" target="_blank" rel="noreferrer" className="underline">{t('auth.termsPrivacyLink')}</a>
                                </span>
                            </label>
                        </>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="mt-2 flex items-center justify-center gap-2 py-2.5 bg-boxwood text-acacia-dark font-bold rounded hover:bg-boxwood-light transition shadow border border-amber-600/40 disabled:opacity-50"
                    >
                        {isLogin ? <LogIn size={18}/> : <UserPlus size={18}/>}
                        {loading ? t('auth.loading') : t(isLogin ? 'auth.submitLogin' : 'auth.submitRegister')}
                    </button>
                </form>
                )}

                {!welcome && <div className="mt-4 text-center text-xs flex flex-col gap-2">
                    {isLogin && (
                        <button type="button" data-testid="auth-forgot"
                                onClick={() => {
                                    setForgot(!forgot);
                                    setFeedback(null);
                                }}
                                className="text-amber-400 hover:underline">
                            {t(forgot ? 'auth.backToLogin' : 'auth.forgotPassword')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            setIsLogin(!isLogin);
                            setForgot(false);
                            setFeedback(null);
                        }}
                        className="text-amber-400 hover:underline"
                    >
                        {t(isLogin ? 'auth.toRegister' : 'auth.toLogin')}
                    </button>
                </div>}

            </div>
        </div>
    );
}