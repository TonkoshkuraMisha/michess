// --- FILE: frontend/src/components/EmailLinkPages.tsx ---
// Страницы ссылок из писем (таск 17.5): подтверждение e-mail (/verify-email?token=…) и новый пароль
// (/reset-password?token=…). Токен уходит на сервер, сам он одноразовый и с истечением.

import {useEffect, useRef, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {KeyRound, MailCheck} from 'lucide-react';
import {API_BASE_URL} from '../config/api';
import {readApiErrorOr} from '../services/apiErrors';
import {renderUiMessage, useI18n} from '../i18n';
import type {UiMessage} from '../i18n';

const MIN_PASSWORD_LENGTH = 8;
const boxClass = 'w-full max-w-md bg-acacia-dark border border-amber-900/40 p-6 rounded shadow-heavy text-boxwood-light flex flex-col gap-3';
const inputClass = 'w-full px-3 py-2 rounded bg-black/40 border border-amber-900/60 text-boxwood-light text-sm outline-none focus:border-amber-500';

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
                const res = await fetch(`${API_BASE_URL}/api/v1/account/email/verify`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token}),
                });
                if (!res.ok) {
                    setState({error: await readApiErrorOr(res, 'serverErrors.email_link_invalid')});
                    return;
                }
                setState({email: (await res.json()).email});
            } catch {
                setState({error: {key: 'common.noConnection'}});
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
            const res = await fetch(`${API_BASE_URL}/api/v1/account/password-reset/confirm`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({token, new_password: password}),
            });
            if (!res.ok) {
                setError(await readApiErrorOr(res, 'serverErrors.email_link_invalid'));
                return;
            }
            localStorage.removeItem('token');
            setDone(true);
        } catch {
            setError({key: 'common.noConnection'});
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
