// --- FILE: frontend/src/components/beta/ReportProblem.tsx ---
// «Сообщить о проблеме» (таск 24.4): окно с любой страницы, в том числе без входа. К тексту прикладывается
// контекст — путь страницы, версия приложения, язык и размер окна; что именно уйдёт, показано прямо в форме.
// CommunityLink — ссылка на канал сообщества: видна, только когда она задана в настройках сервера (COMMUNITY_URL).

import {useEffect, useState} from 'react';
import {useLocation} from 'react-router-dom';
import {Bug, Send, X} from 'lucide-react';
import {renderUiMessage, uiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {betaApi, communityPlatform, screenSize, useSiteConfig} from '../../services/beta';

const MESSAGE_MIN = 5;
const MESSAGE_MAX = 2000;

export function CommunityLink({className = ''}: { className?: string }) {
    const {t} = useI18n();
    const {communityUrl} = useSiteConfig();
    if (!communityUrl) return null;
    return (
        <a href={communityUrl} target="_blank" rel="noreferrer" data-testid="community-link"
           className={`inline-flex items-center gap-1.5 text-amber-300 hover:text-amber-200 underline ${className}`}>
            <Send size={15}/> {t(`beta.community.${communityPlatform(communityUrl)}`)}
        </a>
    );
}

export function ReportProblem({onClose}: { onClose: () => void }) {
    const {t, language} = useI18n();
    const location = useLocation();
    const {version} = useSiteConfig();
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);
    // Страница и размер окна — на момент открытия формы: именно там игрок увидел проблему.
    const [context] = useState(() => ({page: location.pathname, screen: screenSize()}));

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const text = message.trim();
    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (text.length < MESSAGE_MIN) {
            setError(uiMessage('beta.report.tooShort'));
            return;
        }
        setError(null);
        setSending(true);
        betaApi.sendFeedback({message: text, page: context.page, language, screen: context.screen})
            .then(() => setSent(true))
            .catch((err) => setError(errorMessage(err, 'common.networkError')))
            .finally(() => setSending(false));
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
             onMouseDown={(e) => {
                 if (e.target === e.currentTarget) onClose();
             }}>
            <div role="dialog" aria-modal="true" aria-labelledby="report-problem-title" data-testid="report-problem"
                 className="relative bg-[#261C14] border-2 border-amber-900/80 rounded-lg p-5 w-full max-w-md shadow-heavy text-boxwood-light flex flex-col gap-3">
                <button type="button" onClick={onClose} title={t('common.closeEsc')} aria-label={t('common.close')}
                        className="absolute top-3 right-3 p-1 rounded text-boxwood/70 hover:text-amber-200 hover:bg-black/30 transition cursor-pointer">
                    <X size={18}/>
                </button>
                <h2 id="report-problem-title" className="text-xl font-bold text-amber-200 flex items-center gap-2 pr-8">
                    <Bug size={20} className="text-amber-400"/> {t('beta.report.title')}
                </h2>
                {sent ? (
                    <>
                        <p role="status" className="text-sm text-emerald-200" data-testid="report-problem-sent">{t('beta.report.sent')}</p>
                        <button type="button" onClick={onClose}
                                className="self-start px-4 py-2 rounded bg-boxwood text-acacia-dark font-bold hover:bg-boxwood-light transition">
                            {t('common.close')}
                        </button>
                    </>
                ) : (
                    <form className="flex flex-col gap-3" onSubmit={submit}>
                        <label htmlFor="report-problem-text" className="text-sm text-boxwood/85">{t('beta.report.hint')}</label>
                        <textarea id="report-problem-text" value={message} onChange={(e) => setMessage(e.target.value)}
                                  maxLength={MESSAGE_MAX} rows={6} autoFocus data-testid="report-problem-text"
                                  placeholder={t('beta.report.placeholder')}
                                  className="w-full px-3 py-2 bg-black/40 border border-amber-900/60 rounded text-amber-100 text-sm focus:outline-none focus:border-amber-600 select-text"/>
                        <p className="text-xs text-boxwood/65" data-testid="report-problem-context">
                            {t('beta.report.attached', {page: context.page, version: version ?? '—', screen: context.screen})}
                        </p>
                        {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
                        <button type="submit" disabled={sending} data-testid="report-problem-send"
                                className="self-start px-4 py-2 rounded bg-boxwood text-acacia-dark font-bold hover:bg-boxwood-light transition disabled:opacity-50">
                            {t(sending ? 'beta.report.sending' : 'beta.report.send')}
                        </button>
                    </form>
                )}
                <CommunityLink className="text-sm self-start"/>
            </div>
        </div>
    );
}
