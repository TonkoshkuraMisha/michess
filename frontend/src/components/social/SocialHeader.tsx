// --- FILE: frontend/src/components/social/SocialHeader.tsx ---
// Шапка (таск 17.1): поиск игрока и центр уведомлений (колокольчик). Колокольчик спрашивает сервер раз в
// POLL_MS и сразу — по событию "notification" из сокета (он открыт на главной доске).

import {useCallback, useEffect, useRef, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {Bell, Search} from 'lucide-react';
import {useI18n} from '../../i18n';
import {gameSocket} from '../../services/gameSocket';
import {notificationLink, socialApi} from '../../services/social';
import type {AppNotification, Inbox, PlayerCard} from '../../services/social';

export const POLL_MS = 30_000;

function minutes(ms: unknown): string {
    return typeof ms === 'number' ? String(Math.round(ms / 60000)) : '?';
}

export function notificationText(n: AppNotification, t: ReturnType<typeof useI18n>['t']): string {
    const p = n.payload;
    if (n.kind === 'challenge') {
        return t('social.notify.challenge', {from: String(p.from), base: minutes(p.base_time_ms),
            inc: typeof p.increment_ms === 'number' ? Math.round(p.increment_ms / 1000) : 0});
    }
    if (n.kind === 'rematch') return t('social.notify.rematch', {from: String(p.from)});
    if (n.kind === 'tournament_round') return t('social.notify.tournamentRound', {round: Number(p.round)});
    return t('social.notify.reportAnswer');
}

export function PlayerSearch() {
    const {t} = useI18n();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [players, setPlayers] = useState<PlayerCard[]>([]);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setPlayers([]);
            return;
        }
        const timer = window.setTimeout(() => {
            socialApi.search(q).then((r) => setPlayers(r.players)).catch(() => setPlayers([]));
        }, 250);
        return () => window.clearTimeout(timer);
    }, [query]);

    return (
        <div className="relative">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-label={t('social.search')} title={t('social.search')}
                    data-testid="player-search-toggle"
                    className="p-2 hover:bg-black/30 rounded-md transition text-boxwood/85 hover:text-amber-300">
                <Search size={19}/>
            </button>
            {open && (
                <div className="absolute right-0 top-11 w-64 bg-[#1A120B] border border-amber-900/60 rounded-md shadow-xl p-2 z-50">
                    <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('social.searchPlaceholder')}
                           data-testid="player-search-input" maxLength={30}
                           className="w-full bg-black/40 rounded px-2 py-1 text-sm"/>
                    <ul className="mt-1 flex flex-col">
                        {players.map((p) => (
                            <li key={p.username}>
                                <Link to={`/profile/${encodeURIComponent(p.username)}`} onClick={() => setOpen(false)}
                                      className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-black/40 text-sm">
                                    <span className="flex items-center gap-1.5">
                                        <span className={`w-2 h-2 rounded-full ${p.online ? 'bg-emerald-400' : 'bg-stone-600'}`}
                                              aria-label={t(p.online ? 'social.online' : 'social.offline')}/>
                                        {p.username}
                                    </span>
                                    <span className="font-mono text-xs text-boxwood/70">{p.blitz_rating}</span>
                                </Link>
                            </li>
                        ))}
                        {query.trim().length >= 2 && players.length === 0 && (
                            <li className="px-2 py-1 text-xs text-boxwood/60">{t('social.nobody')}</li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

export function NotificationBell() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [inbox, setInbox] = useState<Inbox>({unread: 0, items: []});
    const [open, setOpen] = useState(false);
    const alive = useRef(true);

    const refresh = useCallback(() => {
        socialApi.notifications().then((r) => alive.current && setInbox(r)).catch(() => undefined);
    }, []);

    useEffect(() => {
        alive.current = true;
        refresh();
        const timer = window.setInterval(refresh, POLL_MS);
        const onNotification = () => refresh();
        gameSocket.on('notification', onNotification);
        return () => {
            alive.current = false;
            window.clearInterval(timer);
            gameSocket.off('notification', onNotification);
        };
    }, [refresh]);

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && inbox.unread > 0) {
            socialApi.markRead().then((r) => alive.current && setInbox(r)).catch(() => undefined);
        }
    };

    return (
        <div className="relative">
            <button type="button" onClick={toggle} aria-label={t('social.notifications')} title={t('social.notifications')}
                    data-testid="notification-bell"
                    className="relative p-2 hover:bg-black/30 rounded-md transition text-boxwood/85 hover:text-amber-300">
                <Bell size={19}/>
                {inbox.unread > 0 && (
                    <span data-testid="notification-badge"
                          className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] leading-4 text-center">
                        {inbox.unread > 9 ? '9+' : inbox.unread}
                    </span>
                )}
            </button>
            {open && (
                <div className="absolute right-0 top-11 w-72 max-h-96 overflow-y-auto bg-[#1A120B] border border-amber-900/60 rounded-md shadow-xl p-2 z-50"
                     data-testid="notification-list">
                    {inbox.items.length === 0 && <p className="text-sm text-boxwood/70 px-2 py-1">{t('social.noNotifications')}</p>}
                    {inbox.items.map((n) => (
                        <button key={n.id} type="button" onClick={() => {
                            setOpen(false);
                            navigate(notificationLink(n));
                        }} className={`w-full text-left px-2 py-1.5 rounded hover:bg-black/40 text-sm ${n.read ? 'text-boxwood/70' : 'text-amber-100'}`}>
                            {notificationText(n, t)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
