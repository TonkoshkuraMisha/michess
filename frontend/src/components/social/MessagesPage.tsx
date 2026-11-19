// --- FILE: frontend/src/components/social/MessagesPage.tsx ---
// Личные сообщения (таск 30.1): слева — переписки, справа — переписка с игроком и поле ввода с вложением-карточкой
// (партия, позиция, задача, урок, турнир). Ниже списка — «Кто может мне писать» и чёрный список. Новое сообщение
// приходит событием "direct_message" из сокета (если он открыт) и опросом раз в POLL_MS.
// Другие страницы открывают переписку с готовым вложением: navigate('/messages/<имя>', {state: {attach: {kind, ref}}}).
// Данные: services/messages.ts — messagesApi (/api/v1/messages: переписки, переписка с игроком по 50 сообщений,
// отправка, чтение, скрытие, блокировка, настройка «Кто может мне писать»); текст — до 1000 знаков (BODY_MAX в
// src/services/direct_messages.py). После изменений страница шлёт window-событие regence:dm-changed — по нему
// колокольчик (SocialHeader.tsx) обновляет число непрочитанных. Роут — App.tsx.

import {useCallback, useEffect, useRef, useState} from 'react';
import type {FormEvent, KeyboardEvent} from 'react';
import {Link, useLocation, useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, Ban, EyeOff, MessageSquare, Paperclip, Send, X} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage, serverErrorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {gameSocket} from '../../services/gameSocket';
import {detectAttachment, messagesApi} from '../../services/messages';
import type {AttachmentKind, Conversation, DmPolicy, DmSettings, Thread} from '../../services/messages';
import {AttachmentCard} from './AttachmentCard';
import {FlaggedNotice, HeldNote, isTextFlagged, RulesLink, TextReportButton} from './Civility';

// Период опроса списка переписок и открытой переписки (мс), если событие сокета не пришло.
export const POLL_MS = 15_000;
// Виды вложений, выбираемые вручную; достижение добавляется только кнопкой «поделиться» в профиле.
const KINDS: AttachmentKind[] = ['game', 'position', 'puzzle', 'lesson', 'tournament', 'library'];
// Варианты настройки «кто может писать мне» (совпадают с POLICIES в src/services/direct_messages.py).
const POLICIES: DmPolicy[] = ['all', 'following', 'nobody'];

/** Черновик вложения: вид и ссылка или идентификатор (ref); может прийти из location.state.attach. */
interface Draft {
    kind: AttachmentKind;
    ref: string;
}

/** Список переписок со счётчиком непрочитанных и последней репликой. */
function ConversationList({items, active}: { items: Conversation[]; active?: string }) {
    const {t} = useI18n();
    if (items.length === 0) return <p className="text-sm text-boxwood/70 p-2" data-testid="dm-empty">{t('dm.empty')}</p>;
    return (
        <ul className="flex flex-col gap-1" data-testid="dm-conversations">
            {items.map((c) => (
                <li key={c.username}>
                    <Link to={`/messages/${encodeURIComponent(c.username)}`}
                          className={`flex flex-col px-2 py-1.5 rounded text-sm hover:bg-black/40 ${active?.toLowerCase() === c.username.toLowerCase() ? 'bg-black/40' : ''}`}>
                        <span className="flex items-center justify-between gap-2">
                            <span className={`font-bold truncate ${c.blocked ? 'line-through text-boxwood/60' : ''}`}>{c.username}</span>
                            {c.unread > 0 && (
                                <span className="text-[10px] px-1.5 rounded-full bg-rose-600 text-white shrink-0">
                                    {t('dm.newCount', {count: c.unread})}
                                </span>
                            )}
                        </span>
                        <span className="text-xs text-boxwood/70 truncate">
                            {c.last.body || (c.last.attachment ? t(`dm.kinds.${c.last.attachment.kind}`) : '')}
                        </span>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/** Настройка «Кто может мне писать» и чёрный список с возвратом в список. */
function DmSettingsPanel() {
    const {t} = useI18n();
    const [settings, setSettings] = useState<DmSettings | null>(null);

    useEffect(() => {
        messagesApi.settings().then(setSettings).catch(() => setSettings(null));
    }, []);

    if (!settings) return null;
    return (
        <div className="mt-4 border-t border-amber-900/40 pt-3 text-sm flex flex-col gap-2" data-testid="dm-settings">
            <label className="flex flex-col gap-1">
                <span className="text-boxwood/80">{t('dm.settings')}</span>
                <select value={settings.dm_policy} data-testid="dm-policy" className="bg-black/40 rounded px-2 py-1"
                        onChange={(e) => messagesApi.setPolicy(e.target.value as DmPolicy).then(setSettings).catch(() => undefined)}>
                    {POLICIES.map((p) => <option key={p} value={p}>{t(`dm.policy.${p}`)}</option>)}
                </select>
            </label>
            <div>
                <span className="text-boxwood/80">{t('dm.blockedList')}</span>
                {settings.blocked.length === 0 && <p className="text-xs text-boxwood/60">{t('dm.noneBlocked')}</p>}
                <ul className="flex flex-col gap-1 mt-1">
                    {settings.blocked.map((name) => (
                        <li key={name} className="flex items-center justify-between gap-2">
                            <span className="truncate">{name}</span>
                            <button type="button" className="text-xs text-amber-300 hover:underline shrink-0"
                                    onClick={() => messagesApi.unblock(name).then(setSettings).catch(() => undefined)}>
                                {t('dm.unblock')}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

/** Переписка с одним игроком: подгрузка ранних сообщений, отправка, вложение, скрытие, блокировка и причина отказа сервера. */
function ThreadView({username, initialAttach, onChanged}: {
    username: string;
    initialAttach: Draft | null;
    onChanged: () => void;
}) {
    const {t, dateLocale} = useI18n();
    const [thread, setThread] = useState<Thread | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [body, setBody] = useState('');
    const [draft, setDraft] = useState<Draft | null>(initialAttach);
    const [attachOpen, setAttachOpen] = useState(Boolean(initialAttach));
    const [sending, setSending] = useState(false);
    const [hasEarlier, setHasEarlier] = useState(false);
    const [flagged, setFlagged] = useState(false);
    const navigate = useNavigate();
    const bottom = useRef<HTMLDivElement>(null);
    // Колбэк родителя — через ref: иначе каждая его перерисовка заново запускала бы загрузку переписки.
    const changed = useRef(onChanged);
    useEffect(() => {
        changed.current = onChanged;
    }, [onChanged]);
    const notifyChanged = useCallback(() => changed.current(), []);

    const load = useCallback(() => {
        messagesApi.thread(username).then((next) => {
            setThread((prev) => {
                if (!prev) setHasEarlier(next.messages.length >= 50);
                // Уже подгруженные ранние сообщения не теряются при обновлении.
                const earlier = prev ? prev.messages.filter((m) => next.messages.length > 0 && m.id < next.messages[0].id) : [];
                return {...next, messages: [...earlier, ...next.messages]};
            });
            setError(null);
            if (next.messages.some((m) => !m.mine && !m.read)) {
                messagesApi.markRead(username).then(notifyChanged).catch(() => undefined);
            }
        }).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [username, notifyChanged]);

    useEffect(() => {
        setThread(null);
        load();
        const timer = window.setInterval(load, POLL_MS);
        const onMessage = (data: unknown) => {
            const from = (data as { from?: unknown } | null)?.from;
            if (typeof from === 'string' && from.toLowerCase() === username.toLowerCase()) load();
        };
        gameSocket.on('direct_message', onMessage);
        return () => {
            window.clearInterval(timer);
            gameSocket.off('direct_message', onMessage);
        };
    }, [username, load]);

    const count = thread?.messages.length ?? 0;
    useEffect(() => {
        bottom.current?.scrollIntoView?.({block: 'nearest'});
    }, [count]);

    const loadEarlier = () => {
        const first = thread?.messages[0];
        if (!first) return;
        messagesApi.thread(username, first.id).then((page) => {
            setHasEarlier(page.messages.length >= 50);
            setThread((prev) => prev && {...prev, messages: [...page.messages, ...prev.messages]});
        }).catch(() => undefined);
    };

    const submit = (e?: FormEvent, sendAnyway = false) => {
        e?.preventDefault();
        const attachment = draft && draft.ref.trim() ? {kind: draft.kind, ref: draft.ref.trim()} : null;
        if (sending || (!body.trim() && !attachment)) return;
        setSending(true);
        setFlagged(false);
        messagesApi.send(username, body, attachment, sendAnyway).then((message) => {
            setThread((prev) => prev && {...prev, messages: [...prev.messages, message]});
            setBody('');
            setDraft(null);
            setAttachOpen(false);
            setError(null);
            notifyChanged();
        }).catch((err) => {
            if (isTextFlagged(err)) setFlagged(true);
            else setError(errorMessage(err, 'common.networkError'));
        }).finally(() => setSending(false));
    };

    const hideConversation = () => messagesApi.hide(username).then(() => {
        notifyChanged();
        navigate('/messages');
    }).catch(() => undefined);

    const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit();
    };

    const toggleBlock = () => {
        if (!thread) return;
        if (thread.blocked) {
            messagesApi.unblock(username).then(() => {
                load();
                notifyChanged();
            }).catch(() => undefined);
        } else if (window.confirm(t('dm.blockConfirm', {name: thread.username}))) {
            messagesApi.block(username).then(() => {
                load();
                notifyChanged();
            }).catch(() => undefined);
        }
    };

    const refusal = thread && !thread.can_write && thread.reason ? serverErrorMessage(thread.reason) : null;

    return (
        <section className="flex flex-col min-h-0 h-full" data-testid="dm-thread">
            <header className="flex items-center justify-between gap-2 pb-2 border-b border-amber-900/40">
                <Link to="/messages" className="md:hidden p-1 text-boxwood/80" aria-label={t('dm.back')} title={t('dm.back')}>
                    <ArrowLeft size={18}/>
                </Link>
                <Link to={`/profile/${encodeURIComponent(thread?.username ?? username)}`} className="font-bold truncate hover:underline">
                    {thread?.username ?? username}
                </Link>
                <span className="flex items-center gap-3 shrink-0">
                    <button type="button" onClick={() => void hideConversation()} data-testid="dm-hide"
                            className="text-xs flex items-center gap-1 text-boxwood/80 hover:underline">
                        <EyeOff size={12}/> {t('dm.hide')}
                    </button>
                    <button type="button" onClick={toggleBlock} data-testid="dm-block"
                            className="text-xs flex items-center gap-1 text-rose-300 hover:underline">
                        <Ban size={12}/> {t(thread?.blocked ? 'dm.unblock' : 'dm.block')}
                    </button>
                </span>
            </header>
            <div className="flex-1 overflow-y-auto py-2 flex flex-col gap-2 min-h-[200px]" data-testid="dm-messages">
                {hasEarlier && (
                    <button type="button" onClick={loadEarlier} className="self-center text-xs text-amber-300 hover:underline">
                        {t('dm.earlier')}
                    </button>
                )}
                {thread && thread.messages.length === 0 && <p className="text-sm text-boxwood/60 text-center">{t('dm.noMessages')}</p>}
                {thread?.messages.map((m) => (
                    <div key={m.id} className={`flex flex-col max-w-[85%] ${m.mine ? 'self-end items-end' : 'self-start items-start'}`}
                         data-testid={m.mine ? 'dm-mine' : 'dm-theirs'}>
                        {m.body && (
                            <p className={`whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${m.mine ? 'bg-amber-800/70 text-white' : 'bg-black/40'}`}>
                                {m.body}
                            </p>
                        )}
                        {m.attachment && <AttachmentCard attachment={m.attachment}/>}
                        <span className="flex items-center gap-2 text-[10px] text-boxwood/60 mt-0.5">
                            {m.created_at && new Date(m.created_at).toLocaleString(dateLocale.code, {dateStyle: 'short', timeStyle: 'short'})}
                            {!m.mine && <TextReportButton subject={`dm:${m.id}`}/>}
                        </span>
                        {m.held && <HeldNote/>}
                    </div>
                ))}
                <div ref={bottom}/>
            </div>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {refusal ? (
                <p className="text-sm text-boxwood/70 border-t border-amber-900/40 pt-2" data-testid="dm-refusal">{renderUiMessage(refusal, t)}</p>
            ) : (
                <form onSubmit={(e) => submit(e)} className="border-t border-amber-900/40 pt-2 flex flex-col gap-2" data-testid="dm-composer">
                    {flagged && <FlaggedNotice onRephrase={() => setFlagged(false)} onSendAnyway={() => submit(undefined, true)}/>}
                    {attachOpen && (
                        <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="dm-attach">
                            <select value={draft?.kind ?? 'game'} className="bg-black/40 rounded px-1.5 py-1" data-testid="dm-attach-kind"
                                    onChange={(e) => setDraft({kind: e.target.value as AttachmentKind, ref: draft?.ref ?? ''})}>
                                {KINDS.map((k) => <option key={k} value={k}>{t(`dm.kinds.${k}`)}</option>)}
                            </select>
                            <input value={draft?.ref ?? ''} maxLength={200} placeholder={t('dm.attachHint')} data-testid="dm-attach-ref"
                                   className="flex-1 min-w-0 bg-black/40 rounded px-2 py-1"
                                   onChange={(e) => {
                                       const found = detectAttachment(e.target.value);
                                       setDraft(found ? {kind: found.kind, ref: found.ref} : {kind: draft?.kind ?? 'game', ref: e.target.value});
                                   }}/>
                            <button type="button" onClick={() => {
                                setDraft(null);
                                setAttachOpen(false);
                            }} aria-label={t('dm.removeAttachment')} title={t('dm.removeAttachment')} className="p-1 text-boxwood/70">
                                <X size={14}/>
                            </button>
                        </div>
                    )}
                    <div className="flex items-end gap-2">
                        <button type="button" onClick={() => setAttachOpen((v) => !v)} aria-label={t('dm.attach')} title={t('dm.attach')}
                                data-testid="dm-attach-toggle" className="p-2 rounded hover:bg-black/30 text-boxwood/80">
                            <Paperclip size={18}/>
                        </button>
                        <textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey} rows={2} maxLength={1000}
                                  placeholder={t('dm.placeholder')} data-testid="dm-input"
                                  className="flex-1 min-w-0 bg-black/40 rounded px-2 py-1 text-sm resize-none"/>
                        <button type="submit" disabled={sending} aria-label={t('dm.send')} title={t('dm.send')} data-testid="dm-send"
                                className="p-2 rounded bg-amber-700 text-white disabled:opacity-50">
                            <Send size={18}/>
                        </button>
                    </div>
                </form>
            )}
        </section>
    );
}

/** Двухколоночная страница: слева переписки и настройки, справа выбранная переписка (на узком экране — по очереди); требует входа. */
export function MessagesPage() {
    const {t} = useI18n();
    const {username} = useParams<{ username?: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const [items, setItems] = useState<Conversation[]>([]);
    const initialAttach = (location.state as { attach?: Draft } | null)?.attach ?? null;

    const refresh = useCallback(() => {
        messagesApi.conversations().then((r) => setItems(r.conversations)).catch(() => undefined);
        window.dispatchEvent(new Event('regence:dm-changed'));
    }, []);

    useEffect(() => {
        if (!getToken()) return;
        refresh();
        const timer = window.setInterval(refresh, POLL_MS);
        gameSocket.on('direct_message', refresh);
        return () => {
            window.clearInterval(timer);
            gameSocket.off('direct_message', refresh);
        };
    }, [refresh]);

    if (!getToken()) {
        return <p className="p-6 text-center text-boxwood/80" data-testid="dm-login">{t('dm.loginRequired')}</p>;
    }

    return (
        <div className="max-w-5xl mx-auto w-full px-4 py-4" data-testid="messages-page">
            <div className="flex items-center justify-between gap-2 mb-3">
                <h1 className="text-xl font-bold flex items-center gap-2"><MessageSquare size={20}/> {t('dm.title')}</h1>
                <RulesLink/>
            </div>
            <div className="grid md:grid-cols-[260px_1fr] gap-4 bg-[#1A120B]/80 border border-amber-900/50 rounded-lg p-3 min-h-[60vh]">
                <aside className={username ? 'hidden md:block' : 'block'}>
                    <ConversationList items={items} active={username}/>
                    <DmSettingsPanel/>
                </aside>
                <div className={username ? 'block min-w-0' : 'hidden md:flex items-center justify-center'}>
                    {username ? (
                        <ThreadView key={username} username={username} initialAttach={initialAttach} onChanged={() => {
                            refresh();
                            if (initialAttach) navigate(location.pathname, {replace: true, state: null});
                        }}/>
                    ) : (
                        <p className="text-sm text-boxwood/60">{t('dm.pick')}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
