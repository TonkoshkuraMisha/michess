// --- FILE: frontend/src/components/social/ModerationPage.tsx ---
// Модерация (таск 17.4): модератору — очередь (жалобы, проверка флага нечестной игры, апелляции) и решения; игроку с
// флагом — апелляция; ReportButton — «Пожаловаться» на игрока (в профиле).
// Данные: services/moderation.ts — moderationApi (/api/v1/moderation: статус me, очередь, решения resolve, апелляция,
// жалобы); решает и видит очередь только модератор (проверка на сервере, src/api/moderation.py). Панели обратной связи и
// приглашений беты — beta/BetaAdmin.tsx. Роут — App.tsx; ReportButton рисуют профиль и ProfileSocial.tsx.

import {useCallback, useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {Flag, Gavel} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {moderationApi} from '../../services/moderation';
import {FeedbackPanel, InvitesPanel} from '../beta/BetaAdmin';
import type {ModerationAction, ModerationMe, QueueItem, ReportReason} from '../../services/moderation';
import {MODERATION_TEXT_MAX} from '../../config/textLimits';

// Причины жалобы на игрока.
const REASONS: ReportReason[] = ['cheating', 'abuse', 'spam', 'other'];
// Решения модератора по виду записи очереди; набор должен совпадать с обработчиками на сервере (src/services/moderation.py).
const ACTIONS: Record<QueueItem['kind'], ModerationAction[]> = {
    player: ['dismiss', 'warn', 'chat_ban', 'mark_cheater'],
    message: ['dismiss', 'warn', 'chat_ban'],
    cheat_review: ['mark_cheater', 'clear_cheater'],
    appeal: ['mark_cheater', 'clear_cheater'],
    translation: ['accept', 'dismiss'],
    // Таск 30.3: жалоба на текст и придержанное фильтром; warn и chat_ban по тексту тоже убирают его.
    content: ['dismiss', 'hide', 'warn', 'chat_ban'],
    held: ['release', 'hide', 'chat_ban'],
};

/** «Пожаловаться» на игрока; с messageText — на его сообщение (личное сообщение, таск 30.1). */
export function ReportButton({username, messageText}: { username: string; messageText?: string }) {
    const {t} = useI18n();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState<ReportReason>('abuse');
    const [comment, setComment] = useState('');
    const [done, setDone] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);
    if (done) return <span className="text-xs text-emerald-300" data-testid="report-sent">{t('moderation.reportSent')}</span>;
    return (
        <span className="flex flex-col gap-1 items-center">
            <button type="button" onClick={() => setOpen((v) => !v)} data-testid="report-open"
                    className="text-xs text-rose-300 hover:underline flex items-center gap-1"><Flag size={12}/> {t('moderation.report')}</button>
            {open && (
                <form className="flex flex-wrap gap-1.5 items-center text-xs" data-testid="report-form" onSubmit={(e) => {
                    e.preventDefault();
                    moderationApi.report(messageText === undefined
                        ? {target: username, kind: 'player', reason, comment}
                        : {target: username, kind: 'message', reason, comment, message_text: messageText.slice(0, MODERATION_TEXT_MAX)}).then(() => setDone(true))
                        .catch((err) => setError(errorMessage(err, 'common.networkError')));
                }}>
                    <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className="bg-black/40 rounded px-1 py-0.5"
                            data-testid="report-reason">
                        {REASONS.map((r) => <option key={r} value={r}>{t(`moderation.reasons.${r}`)}</option>)}
                    </select>
                    <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={MODERATION_TEXT_MAX} placeholder={t('moderation.comment')}
                           className="bg-black/40 rounded px-1 py-0.5"/>
                    <button type="submit" className="px-2 py-0.5 rounded bg-rose-800 text-white">{t('moderation.send')}</button>
                    {error && <span role="alert" className="text-rose-300">{renderUiMessage(error, t)}</span>}
                </form>
            )}
        </span>
    );
}

/** Страница модерации: апелляция для помеченного игрока и очередь с решениями для модератора. */
export function ModerationPage() {
    const {t} = useI18n();
    const [me, setMe] = useState<ModerationMe | null>(null);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [appealText, setAppealText] = useState('');
    const [error, setError] = useState<UiMessage | null>(null);

    const load = useCallback(() => {
        moderationApi.me().then((status) => {
            setMe(status);
            if (status.is_moderator) moderationApi.queue().then((r) => setQueue(r.reports)).catch(() => undefined);
        }).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, []);
    useEffect(load, [load]);

    const act = (action: Promise<unknown>) => action.then(load).catch((err) => setError(errorMessage(err, 'common.networkError')));

    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="moderation-page">
            <header className="flex items-center gap-2">
                <Gavel className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('moderation.title')}</h1>
            </header>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {me?.chat_banned_until && <p className="text-sm text-amber-300">{t('moderation.chatBanned')}</p>}
            {me?.is_cheater && (
                <section className="bg-acacia p-3 rounded-lg border-2 border-rose-700 flex flex-col gap-2" data-testid="appeal">
                    <p>{t('moderation.flagged')}</p>
                    {me.open_appeal ? <p className="text-sm text-amber-300">{t('moderation.appealPending')}</p> : (
                        <form className="flex flex-col gap-2" onSubmit={(e) => {
                            e.preventDefault();
                            void act(moderationApi.appeal(appealText));
                        }}>
                            <textarea value={appealText} onChange={(e) => setAppealText(e.target.value)} maxLength={MODERATION_TEXT_MAX} rows={3}
                                      placeholder={t('moderation.appealHint')} className="bg-black/40 rounded px-2 py-1" data-testid="appeal-text"/>
                            <button type="submit" className="self-start px-3 py-1.5 rounded bg-amber-700 text-white font-bold">{t('moderation.appeal')}</button>
                        </form>
                    )}
                </section>
            )}
            {me?.is_moderator && (
                <section className="flex flex-col gap-2" data-testid="mod-queue">
                    <h2 className="font-bold text-amber-200">{t('moderation.queue', {n: queue.length})}</h2>
                    {queue.length === 0 && <p className="text-sm text-boxwood/70">{t('moderation.queueEmpty')}</p>}
                    {queue.map((item) => (
                        <article key={item.id} className="bg-black/30 rounded p-3 flex flex-col gap-1.5 text-sm" data-testid={`mod-item-${item.id}`}>
                            <div className="flex flex-wrap gap-2 items-baseline">
                                <span className="font-bold">{t(`moderation.kinds.${item.kind}`)}</span>
                                {item.target && <Link to={`/profile/${encodeURIComponent(item.target)}`} className="text-amber-300 underline">{item.target}</Link>}
                                {item.reporter && <span className="text-boxwood/70">{t('moderation.from', {name: item.reporter})}</span>}
                                <span className="text-xs text-boxwood/60">{t('moderation.targetStats', {n: item.reports_on_target, trust: item.target_trust ?? 0})}</span>
                            </div>
                            {item.subject && (
                                <span className="font-mono text-xs text-amber-200" data-testid={`mod-subject-${item.id}`}>
                                    {item.subject}{item.context ? ` · ${item.context}` : ''}
                                </span>
                            )}
                            {item.reason !== 'auto' && item.kind !== 'translation' && <span>{t(`moderation.reasons.${item.reason as ReportReason}`)}</span>}
                            {item.message_text && <blockquote className="border-l-2 border-rose-600 pl-2 italic">{item.message_text}</blockquote>}
                            {item.comment && <p className="text-boxwood/85">{item.comment}</p>}
                            {item.game_id && <Link to={`/game/${item.game_id}`} className="text-amber-300 underline self-start">{t('moderation.openGame')}</Link>}
                            <div className="flex flex-wrap gap-1.5">
                                {ACTIONS[item.kind].map((action) => (
                                    <button key={action} type="button" onClick={() => void act(moderationApi.resolve(item.id, action))}
                                            data-testid={`act-${item.id}-${action}`}
                                            className="px-2 py-1 rounded bg-black/40 border border-amber-800/60 hover:border-amber-500">
                                        {t(`moderation.actions.${action}`)}
                                    </button>
                                ))}
                            </div>
                        </article>
                    ))}
                </section>
            )}
            {me?.is_moderator && <FeedbackPanel/>}
            {me?.is_moderator && <InvitesPanel/>}
            {me && !me.is_moderator && !me.is_cheater &&<p className="text-sm text-boxwood/70">{t('moderation.nothing')}</p>}
        </div>
    );
}
