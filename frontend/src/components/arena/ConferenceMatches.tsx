// --- FILE: frontend/src/components/arena/ConferenceMatches.tsx ---
// Матчи конференций (таск 33.6, схема владельца 18.11): раз в неделю две конференции играют матч — доски по рейтингу,
// на доске партия белыми и партия чёрными, победа 1, ничья ½. Правила и счёт считает сервер
// (src/services/conference_match_rules.py, arena.match_view, conferences.matches); здесь только показ:
// MatchBoards — счёт и доски на странице матча (/arenas/:id), MatchList — матчи сезона и ближайшие на /conferences.

import {Link} from 'react-router-dom';
import {Swords} from 'lucide-react';
import {useI18n} from '../../i18n';
import {conferenceKey} from '../../services/arenas';
import type {MatchDetail} from '../../services/arenas';
import type {MatchRow} from '../../services/conferences';
import {EmptyState, Section} from '../ui';

// Тип функции перевода t из useI18n — для вспомогательных функций вне компонентов.
type T = ReturnType<typeof useI18n>['t'];

/** Название конференции на языке игрока; незнакомый ключ — как есть. */
export function conferenceName(value: string | null | undefined, t: T): string {
    const key = conferenceKey(value);
    return key ? t(`arenas.conferences.${key}`) : value ?? '';
}

/** Счёт «1½» вместо «1.5»: так принято записывать очки матча. */
export function matchScore(value: number): string {
    const whole = Math.floor(value);
    const half = value - whole >= 0.5 ? '½' : '';
    return whole === 0 && half ? half : `${whole}${half}`;
}

/** Счёт матча и доски (по партии белыми и чёрными на каждой) на странице матча /arenas/:id; без досок — подсказка. */
export function MatchBoards({match}: { match: MatchDetail }) {
    const {t} = useI18n();
    return (
        <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark overflow-x-auto flex flex-col gap-2" data-testid="match-boards">
            <div className="flex flex-wrap items-center justify-center gap-3 text-lg font-bold text-amber-200" data-testid="match-score">
                <span>{conferenceName(match.home, t)}</span>
                <span className="font-mono text-2xl">{matchScore(match.home_score)} : {matchScore(match.guest_score)}</span>
                <span>{conferenceName(match.guest, t)}</span>
            </div>
            <p className="text-sm text-boxwood/75 text-center">
                {t('arenas.match.entries', {home: match.home_players, guest: match.guest_players})}
                {match.entry_open ? '' : ` · ${t('arenas.match.lineupSet')}`}
            </p>
            {match.boards.length === 0 ? (
                <p className="text-sm text-boxwood/70">{t('arenas.match.noBoards')}</p>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-boxwood/70 text-left">
                            <th>{t('arenas.match.board')}</th>
                            <th>{conferenceName(match.home, t)}</th>
                            <th className="text-center">{t('arenas.score')}</th>
                            <th className="text-right">{conferenceName(match.guest, t)}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {match.boards.map((row) => (
                            <tr key={row.board} data-testid={`match-board-${row.board}`}>
                                <td>{row.board}</td>
                                <td className="break-all">{row.home.username} <span className="text-xs text-boxwood/60">{row.home.rating}</span></td>
                                <td className="text-center font-mono font-bold">{matchScore(row.home.score)} : {matchScore(row.guest.score)}</td>
                                <td className="text-right break-all"><span className="text-xs text-boxwood/60">{row.guest.rating}</span> {row.guest.username}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

/** Список матчей конференций сезона и ближайших: у ещё не сыгранного — время начала, у идущего и законченного — счёт. */
export function MatchList({matches}: { matches: MatchRow[] }) {
    const {t, language} = useI18n();
    return (
        <Section title={t('conferences.matches')} testId="conference-matches">
            <p className="text-sm text-boxwood/75">{t('conferences.matchesRules')}</p>
            {matches.length === 0 ? (
                <EmptyState icon={<Swords size={26}/>} title={t('conferences.noMatches')}/>
            ) : (
                <ul className="flex flex-col gap-2">
                    {matches.map((m) => (
                        <li key={m.arena_id}>
                            <Link to={`/arenas/${m.arena_id}`} data-testid={`match-${m.arena_id}`}
                                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded border-2 bg-acacia border-acacia-dark hover:border-amber-400">
                                <span className="font-bold">
                                    {conferenceName(m.home, t)} — {conferenceName(m.guest, t)}
                                </span>
                                <span className="text-sm text-boxwood/80">
                                    {m.status === 'scheduled'
                                        ? new Date(m.starts_at).toLocaleString(language, {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})
                                        : `${matchScore(m.home_score)} : ${matchScore(m.guest_score)}`}
                                    {' · '}{t('arenas.players', {n: m.players})}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}
