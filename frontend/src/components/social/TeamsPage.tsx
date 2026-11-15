// --- FILE: frontend/src/components/social/TeamsPage.tsx ---
// Команды и сезонная лига (таск 17.2): таблица лиги текущего месяца, своя команда (состав, очки, выйти), создание
// команды и вход в чужую.

import {useCallback, useEffect, useState} from 'react';
import {Shield} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {teamsApi} from '../../services/teams';
import type {LeagueTable, TeamView} from '../../services/teams';

export function TeamsPage() {
    const {t} = useI18n();
    const [league, setLeague] = useState<LeagueTable | null>(null);
    const [mine, setMine] = useState<TeamView | null>(null);
    const [name, setName] = useState('');
    const [error, setError] = useState<UiMessage | null>(null);
    const loggedIn = Boolean(getToken());

    const load = useCallback(() => {
        teamsApi.league().then(setLeague).catch((err) => setError(errorMessage(err, 'common.networkError')));
        if (loggedIn) teamsApi.mine().then((r) => setMine(r.team)).catch(() => undefined);
    }, [loggedIn]);

    useEffect(load, [load]);

    const act = (action: () => Promise<unknown>) => {
        setError(null);
        action().then(load).catch((err) => setError(errorMessage(err, 'common.networkError')));
    };

    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="teams-page">
            <header className="flex items-center gap-2">
                <Shield className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('teams.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('teams.intro')}</p>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}

            {loggedIn && mine && (
                <section className="bg-acacia p-3 rounded-lg border-2 border-amber-700 flex flex-col gap-2" data-testid="my-team">
                    <div className="flex items-baseline justify-between gap-2">
                        <h2 className="font-bold text-amber-200">{mine.name}</h2>
                        <span className="text-sm">{t('teams.points', {n: mine.points})}</span>
                    </div>
                    <ul className="text-sm">
                        {mine.members.map((m) => (
                            <li key={m.username} className="flex justify-between">
                                <span>{m.username}{m.owner && <span className="text-xs text-amber-300"> · {t('teams.owner')}</span>}</span>
                                <span className="font-mono">{m.points}</span>
                            </li>
                        ))}
                    </ul>
                    <button type="button" onClick={() => act(() => teamsApi.leave())} data-testid="team-leave"
                            className="self-start text-sm text-rose-300 hover:underline">{t('teams.leave')}</button>
                </section>
            )}

            {loggedIn && !mine && (
                <form className="flex flex-wrap gap-2 items-end" data-testid="team-create" onSubmit={(e) => {
                    e.preventDefault();
                    act(() => teamsApi.create(name));
                }}>
                    <label className="flex flex-col text-sm gap-1">{t('teams.newName')}
                        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} data-testid="team-name"
                               className="bg-black/40 rounded px-2 py-1 w-56"/>
                    </label>
                    <button type="submit" className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold">{t('teams.create')}</button>
                </form>
            )}

            {league && (
                <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark">
                    <h2 className="font-bold text-amber-200 mb-2">{t('teams.league', {season: league.season})}</h2>
                    {league.teams.length === 0 ? <p className="text-sm text-boxwood/70">{t('teams.noTeams')}</p> : (
                        <table className="w-full text-sm" data-testid="league-table">
                            <thead>
                                <tr className="text-left text-boxwood/70"><th>#</th><th>{t('teams.team')}</th><th className="text-right">{t('teams.members')}</th><th className="text-right">{t('teams.score')}</th><th/></tr>
                            </thead>
                            <tbody>
                                {league.teams.map((team) => (
                                    <tr key={team.id} className={mine?.id === team.id ? 'bg-amber-900/30' : ''}>
                                        <td>{team.place}</td>
                                        <td>{team.name}</td>
                                        <td className="text-right font-mono">{team.members}</td>
                                        <td className="text-right font-bold">{team.points}</td>
                                        <td className="text-right">
                                            {loggedIn && !mine && (
                                                <button type="button" onClick={() => act(() => teamsApi.join(team.id))} data-testid={`join-${team.id}`}
                                                        className="text-amber-300 hover:underline">{t('teams.join')}</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <p className="text-xs text-boxwood/70 mt-2">{t('teams.rules')}</p>
                </section>
            )}
        </div>
    );
}
