// --- FILE: frontend/src/components/social/Civility.tsx ---
// Уважительное общение (таск 30.3): страница «Правила общения», предупреждение фильтра оскорблений с выбором
// «переформулировать / отправить на проверку», жалоба на сообщение, публикацию или комментарий в один шаг.

import {useState} from 'react';
import {Link} from 'react-router-dom';
import {Flag, ShieldCheck} from 'lucide-react';
import {useI18n} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {moderationApi} from '../../services/moderation';
import type {ReportReason} from '../../services/moderation';

const REASONS: ReportReason[] = ['abuse', 'spam', 'other'];
const RULES = ['respect', 'noInsults', 'noSpam', 'fairPlay', 'privacy', 'reports'] as const;

/** Сервер не принял текст фильтром оскорблений — предложить переписать или отправить на проверку. */
export function isTextFlagged(err: unknown): boolean {
    const message = errorMessage(err, 'common.networkError');
    return 'key' in message && message.key === 'serverErrors.text_flagged';
}

export function FlaggedNotice({onRephrase, onSendAnyway}: { onRephrase: () => void; onSendAnyway: () => void }) {
    const {t} = useI18n();
    return (
        <div role="alert" className="rounded-md border border-amber-600/60 bg-amber-950/40 p-2 text-sm flex flex-col gap-1.5" data-testid="flagged-notice">
            <strong className="text-amber-200">{t('civil.flaggedTitle')}</strong>
            <span className="text-boxwood/85">{t('civil.flaggedHint')}</span>
            <span className="flex flex-wrap gap-2">
                <button type="button" onClick={onRephrase} data-testid="flagged-rephrase"
                        className="px-2.5 py-1 rounded bg-amber-700 text-white font-bold">{t('civil.rephrase')}</button>
                <button type="button" onClick={onSendAnyway} data-testid="flagged-send-anyway"
                        className="px-2.5 py-1 rounded border border-amber-800/70 text-boxwood/85 hover:border-amber-500">{t('civil.sendAnyway')}</button>
                <RulesLink/>
            </span>
        </div>
    );
}

export function HeldNote() {
    const {t} = useI18n();
    return <span className="text-[11px] text-amber-300" data-testid="held-note">{t('civil.held')}</span>;
}

export function RulesLink() {
    const {t} = useI18n();
    return (
        <Link to="/rules" className="text-xs text-amber-300 hover:underline self-center flex items-center gap-1" data-testid="rules-link">
            <ShieldCheck size={12}/> {t('civil.rulesLink')}
        </Link>
    );
}

/** Жалоба на текст: флажок → причина одним нажатием → отправлено. subject: «dm:12», «post:5», «comment:7». */
export function TextReportButton({subject}: { subject: string }) {
    const {t} = useI18n();
    const [open, setOpen] = useState(false);
    const [done, setDone] = useState(false);
    const [failed, setFailed] = useState(false);
    if (done) return <span className="text-[11px] text-emerald-300" data-testid="text-report-sent">{t('civil.reportSent')}</span>;
    const send = (reason: ReportReason) => moderationApi.reportText(subject, reason)
        .then(() => setDone(true)).catch(() => setFailed(true));
    return (
        <span className="inline-flex items-center gap-1">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-label={t('civil.report')} title={t('civil.report')}
                    data-testid="text-report" className="text-rose-300/80 hover:text-rose-300">
                <Flag size={11}/>
            </button>
            {open && REASONS.map((reason) => (
                <button key={reason} type="button" onClick={() => void send(reason)} data-testid={`text-report-${reason}`}
                        className="text-[11px] px-1.5 rounded bg-rose-900/60 text-white hover:bg-rose-800">
                    {t(`moderation.reasons.${reason}`)}
                </button>
            ))}
            {failed && <span className="text-[11px] text-rose-300">!</span>}
        </span>
    );
}

export function CommunityRulesPage() {
    const {t} = useI18n();
    return (
        <article className="max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-4" data-testid="rules-page">
            <h1 className="text-2xl font-bold text-amber-200 flex items-center gap-2"><ShieldCheck size={22}/> {t('civil.rulesTitle')}</h1>
            <p className="text-boxwood/85">{t('civil.rulesIntro')}</p>
            <ol className="list-decimal pl-6 flex flex-col gap-2">
                {RULES.map((rule) => <li key={rule}>{t(`civil.rules.${rule}`)}</li>)}
            </ol>
            <h2 className="text-lg font-bold text-amber-200">{t('civil.howItWorks')}</h2>
            <p className="text-boxwood/85">{t('civil.filter')}</p>
            <p className="text-boxwood/85">{t('civil.limits')}</p>
            <p className="text-boxwood/85">{t('civil.decisions')}</p>
        </article>
    );
}
