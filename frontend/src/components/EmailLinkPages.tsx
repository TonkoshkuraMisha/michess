// --- FILE: frontend/src/components/EmailLinkPages.tsx ---
// Страницы ссылок из писем (таск 17.5): подтверждение e-mail (/verify-email?token=…) и новый пароль
// (/reset-password?token=…). Токен уходит на сервер (POST /account/email/verify и /account/password-reset/confirm,
// src/api/account.py), сам он одноразовый и с истечением. Маршруты — App.tsx.

import {useEffect, useRef, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {KeyRound, MailCheck} from 'lucide-react';
import {accountApi} from '../services/account';
import {errorMessage} from '../services/apiErrors';
import {renderUiMessage, useI18n} from '../i18n';
import type {UiMessage} from '../i18n';
import {clearToken} from '../services/authToken';
import {MIN_PASSWORD_LENGTH} from '../config/passwordRules';

// Общие классы оформления окна и поля ввода обеих страниц.
const boxClass = 'w-full max-w-md bg-acacia-dark border border-amber-900/40 p-6 rounded shadow-heavy text-boxwood-light flex flex-col gap-3';
const inputClass = 'w-full px-3 py-2 rounded bg-black/40 border border-amber-900/60 text-boxwood-light text-sm outline-none focus:border-amber-500';

/** Подтверждение e-mail: при открытии один раз отправляет токен из адреса и показывает итог. */
export function VerifyEmailPage() {
    const {t} = useI18n();
    const [params] = useSearchParams();
    const token = params.get('token') ?? '';
    const [state, setState] = useState<{ email?: string; error?: UiMessage } | null>(null);
    const sent = useRef(false);

    useEffect(() => {
        if (sent.current) return;  // в StrictMode эффект срабатывает дважды, а ссылка одноразовая
        sent.current = true;
        void (async () => {
            try {
                setState({email: (await accountApi.verifyEmail(token)).email});
            } catch (err) {
                setState({error: errorMessage(err, 'serverErrors.email_link_invalid')});
            }
        })();
    }, [token]);

    return (
        <div className={boxClass} data-testid="verify-email-page">
            <h1 className="text-xl font-bold text-amber-200 flex items-center gap-2"><MailCheck size={20}/> {t('emailLinks.verifyTitle')}</h1>
            {!state && <p className="text-sm">{t('emailLinks.verifying')}</p>}
            {state?.email && <p className="text-sm text-emerald-300" role="status">{t('emailLinks.verified', {email: state.email})}</p>}
            {state?.error && <p className="text-sm text-red-300" role="alert">{renderUiMessage(state.error, t)}</p>}
            <Link to="/" className="text-amber-400 hover:underline text-sm">{t('emailLinks.toHome')}</Link>
        </div>
    );
}

/**
 * Новый пароль по ссылке из письма. После успеха локальный токен сбрасывается: сервер отозвал все прежние сессии.
 */
export function ResetPasswordPage() {
    const {t} = useI18n();
    const [params] = useSearchParams();
    const token = params.get('token') ?? '';
    const [password, setPassword] = useState('');
    const [repeat, setRepeat] = useState('');
    const [error, setError] = useState<UiMessage | null>(null);
    const [done, setDone] = useState(false);
    const [saving, setSaving] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError({key: 'settings.passwordTooShort', params: {min: MIN_PASSWORD_LENGTH}});
            return;
        }
        if (password !== repeat) {
            setError({key: 'settings.passwordsDiffer'});
            return;
        }
        setError(null);
        setSaving(true);
        try {
            await accountApi.confirmPasswordReset(token, password);
            clearToken();
            setDone(true);
        } catch (err) {
            setError(errorMessage(err, 'serverErrors.email_link_invalid'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={boxClass} data-testid="reset-password-page">
            <h1 className="text-xl font-bold text-amber-200 flex items-center gap-2"><KeyRound size={20}/> {t('emailLinks.resetTitle')}</h1>
            {done ? (
                <p className="text-sm text-emerald-300" role="status">{t('emailLinks.resetDone')}</p>
            ) : (
                <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
                    <label className="text-xs text-boxwood/80" htmlFor="reset-new">{t('emailLinks.newPassword', {min: MIN_PASSWORD_LENGTH})}</label>
                    <input id="reset-new" type="password" autoComplete="new-password" value={password}
                           onChange={(e) => setPassword(e.target.value)} className={inputClass}/>
                    <label className="text-xs text-boxwood/80" htmlFor="reset-repeat">{t('emailLinks.repeatPassword')}</label>
                    <input id="reset-repeat" type="password" autoComplete="new-password" value={repeat}
                           onChange={(e) => setRepeat(e.target.value)} className={inputClass}/>
                    <button type="submit" disabled={saving || !password}
                            className="mt-1 px-4 py-2 rounded-md bg-amber-800 hover:bg-amber-700 text-white text-sm font-bold disabled:opacity-40 cursor-pointer">
                        {t('emailLinks.save')}
                    </button>
                </form>
            )}
            {error && <p className="text-sm text-red-300" role="alert">{renderUiMessage(error, t)}</p>}
            <Link to="/" className="text-amber-400 hover:underline text-sm">{t('emailLinks.toHome')}</Link>
        </div>
    );
}
