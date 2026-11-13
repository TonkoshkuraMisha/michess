// --- FILE: frontend/src/components/tournaments/TournamentHistory.tsx ---
// История турниров в своём профиле (таск 15.3): список турниров игрока с занятым местом.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {Trophy} from 'lucide-react';
import {API_BASE_URL} from '../../config/api';
import {useI18n} from '../../i18n';
import {listTournaments} from '../../services/tournaments';
import type {TournamentSummary} from '../../services/tournaments';

/** Показывается только в профиле вошедшего игрока: турниры видит лишь их владелец. */
export function TournamentHistory({username}: { username: string }) {
    const {t} = useI18n();
    const [items, setItems] = useState<TournamentSummary[] | null>(null);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;
        let alive = true;
        fetch(`${API_BASE_URL}/api/v1/profile/me`, {headers: {Authorization: `Bearer ${token}`}})
            .then((r) => (r.ok ? r.json() : null))
            .then((me) => (me?.username === username ? listTournaments() : null))
            .then((list) => alive && Array.isArray(list) && setItems(list))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [username]);

    if (!items || items.length === 0) return null;
    return (
        <section className="bg-[#1A120B] border border-amber-900/60 px-3 py-2.5 rounded shadow-inner flex flex-col gap-1.5"
                 data-testid="tournament-history">
            <h3 className="text-boxwood/70 text-xs uppercase tracking-widest flex items-center gap-1">
                <Trophy size={12}/> {t('tournaments.history')}
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
                {items.map((item) => (
                    <li key={item.id}>
                        <Link to={`/tournaments/${item.id}`} className="flex justify-between gap-2 hover:text-amber-300">
                            <span>{t(`tournaments.formats.${item.format}`)} · {item.size}</span>
                            <span className="font-mono">
                                {item.status === 'finished' && item.my_place
                                    ? t('tournaments.placeOf', {place: item.my_place, size: item.size})
                                    : t(`tournaments.statuses.${item.status}`)}
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}
