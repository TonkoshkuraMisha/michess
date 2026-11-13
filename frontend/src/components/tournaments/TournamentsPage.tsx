// --- FILE: frontend/src/components/tournaments/TournamentsPage.tsx ---
// Турниры (таск 15.3): /tournaments — свои турниры и создание нового; /tournaments/:id — турнир: таблица или сетка,
// партии по турам, «Играть мою партию», диплом призёра. Партии ботов между собой играет сервер — страница
// обновляет состояние, пока они идут.

import {useEffect, useMemo, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {Trophy} from 'lucide-react';
import {API_BASE_URL} from '../../config/api';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {HISTORICAL_BOTS_LIST} from '../../config/champions';
import {ALL_TIME_CONTROLS} from '../../config/timeControls';
import {fetchBotCatalog} from '../../services/botCatalog';
import type {CatalogArchetype} from '../../services/botCatalog';
import {listPersonalities} from '../../services/personalities';
import type {Personality} from '../../services/personalities';
import {
    botGamesRunning, createTournament, gameStart, getTournament, listTournaments, myPendingGame, participantName,
    startMyGame, withdrawTournament,
} from '../../services/tournaments';
import type {
    ParticipantKind, Tournament, TournamentFormat, TournamentGame, TournamentSummary,
} from '../../services/tournaments';
import {ladderOpponentName} from '../../config/players';
import {Diploma} from './Diploma';

const SIZES: Record<TournamentFormat, number[]> = {round_robin: [4, 6, 8], knockout: [4, 8]};
const POLL_MS = 3000;

type Pick = { kind: ParticipantKind; id: string | number };
const pickKey = (p: Pick) => `${p.kind}:${p.id}`;

function CreateTournament() {
    const {t, tp} = useI18n();
    const navigate = useNavigate();
    const [format, setFormat] = useState<TournamentFormat>('round_robin');
    const [size, setSize] = useState(4);
    const [picks, setPicks] = useState<Pick[]>([]);
    const presets = useMemo(() => ALL_TIME_CONTROLS.filter((o) => !o.isManual), []);
    const [timeControlId, setTimeControlId] = useState(presets.find((o) => o.base === 5)?.id ?? presets[0].id);
    const [archetypes, setArchetypes] = useState<CatalogArchetype[]>([]);
    const [personalities, setPersonalities] = useState<Personality[]>([]);
    const [error, setError] = useState<UiMessage | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetchBotCatalog().then((c) => setArchetypes(c.archetypes)).catch(() => undefined);
        const token = localStorage.getItem('token');
        if (token) listPersonalities(token).then(setPersonalities).catch(() => undefined);
    }, []);

    const needed = size - 1;
    const toggle = (pick: Pick) => setPicks((current) => current.some((p) => pickKey(p) === pickKey(pick))
        ? current.filter((p) => pickKey(p) !== pickKey(pick))
        : current.length < needed ? [...current, pick] : current);
    const chosen = (pick: Pick) => picks.some((p) => pickKey(p) === pickKey(pick));

    const submit = async () => {
        const control = presets.find((o) => o.id === timeControlId)!;
        setBusy(true);
        setError(null);
        try {
            const created = await createTournament({
                format, size, participants: picks, base_time_ms: control.base * 60000, increment_ms: control.inc * 1000,
            });
            navigate(`/tournaments/${created.id}`);
        } catch (err) {
            setError(errorMessage(err, 'tournaments.createFailed'));
        } finally {
            setBusy(false);
        }
    };

    const chip = (pick: Pick, label: string, rating?: number) => (
        <button key={pickKey(pick)} type="button" onClick={() => toggle(pick)} aria-pressed={chosen(pick)}
                className={`px-2 py-1 rounded border text-sm cursor-pointer ${chosen(pick)
                    ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`}>
            {label}{rating ? <span className="ml-1 font-mono text-amber-300/80">{rating}</span> : null}
        </button>
    );

    return (
        <section className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark flex flex-col gap-3" data-testid="create-tournament">
            <h2 className="text-lg font-bold text-amber-200">{t('tournaments.newTournament')}</h2>
            <div className="flex flex-wrap gap-4">
                <label className="flex flex-col text-sm gap-1">
                    {t('tournaments.format')}
                    <select value={format} className="bg-black/40 rounded px-2 py-1"
                            onChange={(e) => {
                                const next = e.target.value as TournamentFormat;
                                setFormat(next);
                                if (!SIZES[next].includes(size)) setSize(4);
                                setPicks([]);
                            }}>
                        {(['round_robin', 'knockout'] as const).map((f) => <option key={f} value={f}>{t(`tournaments.formats.${f}`)}</option>)}
                    </select>
                </label>
                <label className="flex flex-col text-sm gap-1">
                    {t('tournaments.size')}
                    <select value={size} className="bg-black/40 rounded px-2 py-1"
                            onChange={(e) => {
                                setSize(Number(e.target.value));
                                setPicks([]);
                            }}>
                        {SIZES[format].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
                <label className="flex flex-col text-sm gap-1">
                    {t('tournaments.timeControl')}
                    <select value={timeControlId} className="bg-black/40 rounded px-2 py-1"
                            onChange={(e) => setTimeControlId(e.target.value as typeof timeControlId)}>
                        {presets.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                </label>
            </div>
            <p className="text-sm text-amber-300" data-testid="opponents-needed">
                {tp('tournaments.chooseOpponents', needed)} ({picks.length}/{needed})
            </p>
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-bold">{t('tournaments.historicalBots')}</h3>
                <div className="flex flex-wrap gap-1.5">
                    {HISTORICAL_BOTS_LIST.map((b) => chip({kind: 'bot', id: b.id}, ladderOpponentName('historical', b.id, t), b.rating))}
                </div>
                {archetypes.length > 0 && <h3 className="text-sm font-bold">{t('tournaments.archetypes')}</h3>}
                <div className="flex flex-wrap gap-1.5">
                    {archetypes.map((a) => chip({kind: 'archetype', id: a.id}, ladderOpponentName('archetype', a.id, t), a.rating))}
                </div>
                {personalities.length > 0 && <h3 className="text-sm font-bold">{t('tournaments.myOpponents')}</h3>}
                <div className="flex flex-wrap gap-1.5">
                    {personalities.map((p) => chip({kind: 'personality', id: p.id}, p.name, p.config.target_elo))}
                </div>
            </div>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <button type="button" onClick={submit} disabled={busy || picks.length !== needed}
                    className="self-start px-4 py-2 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
                {t('tournaments.create')}
            </button>
        </section>
    );
}

export function TournamentsPage() {
    const {t} = useI18n();
    const [items, setItems] = useState<TournamentSummary[]>([]);
    useEffect(() => {
        listTournaments().then(setItems).catch(() => undefined);
    }, []);
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="tournaments-page">
            <header className="flex items-center gap-2">
                <Trophy className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('tournaments.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('tournaments.intro')}</p>
            <section className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark flex flex-col gap-2">
                <h2 className="text-lg font-bold text-amber-200">{t('tournaments.myTournaments')}</h2>
                {items.length === 0 ? <p className="text-sm text-boxwood/70">{t('tournaments.none')}</p> : (
                    <ul className="flex flex-col gap-1">
                        {items.map((item) => (
                            <li key={item.id}>
                                <Link to={`/tournaments/${item.id}`} className="flex justify-between gap-2 bg-black/30 rounded px-3 py-2 hover:bg-black/50">
                                    <span>{t(`tournaments.formats.${item.format}`)} · {item.size}</span>
                                    <span className="text-sm text-amber-300">
                                        {item.status === 'finished' && item.my_place
                                            ? t('tournaments.placeOf', {place: item.my_place, size: item.size})
                                            : t(`tournaments.statuses.${item.status}`)}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <CreateTournament/>
        </div>
    );
}

function resultFor(game: TournamentGame, seat: number): string {
    if (!game.result) return '';
    if (game.result === '1/2-1/2') return '½';
    const whiteWon = game.result === '1-0';
    return (game.white_seat === seat) === whiteWon ? '1' : '0';
}

function knockoutRoundName(t: ReturnType<typeof useI18n>['t'], size: number, round: number): string {
    const fromEnd = (size === 4 ? 2 : 3) - round;
    return t(`tournaments.knockoutRounds.${fromEnd === 0 ? 'final' : fromEnd === 1 ? 'semifinal' : 'quarterfinal'}`);
}

export function TournamentView() {
    const {t, dateLocale} = useI18n();
    const navigate = useNavigate();
    const id = Number(useParams().tournamentId);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [myName, setMyName] = useState('');
    const [notice, setNotice] = useState<UiMessage | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const load = () => getTournament(id)
            .then((data) => {
                if (!alive) return;
                setTournament(data);
                // Пока сервер играет партии ботов — обновляем состояние.
                if (botGamesRunning(data)) timer = setTimeout(load, POLL_MS);
            })
            .catch((err) => alive && setError(errorMessage(err, 'tournaments.loadFailed')));
        load();
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
    }, [id, reloadKey]);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;
        fetch(`${API_BASE_URL}/api/v1/profile/me`, {headers: {Authorization: `Bearer ${token}`}})
            .then((r) => (r.ok ? r.json() : null)).then((me) => me?.username && setMyName(me.username)).catch(() => undefined);
    }, []);

    if (error) return <p role="alert" className="p-6 text-center text-rose-300">{renderUiMessage(error, t)}</p>;
    if (!tournament) return null;

    const name = (seat: number) => participantName(tournament.players.find((p) => p.seat === seat)!, t);
    const rounds = Array.from(new Set(tournament.games.map((g) => g.round))).sort((a, b) => a - b);
    const totalRounds = tournament.format === 'round_robin' ? tournament.size - 1 : (tournament.size === 4 ? 2 : 3);
    const pending = myPendingGame(tournament);
    const me = tournament.players.find((p) => p.seat === tournament.my_seat);
    const winner = tournament.players.find((p) => p.place === 1);

    const play = async () => {
        if (!pending) return;
        try {
            // Партию начинает сервер (таск A.2): брошенная и начатая заново партия засчитывается поражением.
            const started = await startMyGame(tournament.id, pending.id);
            if (started.forfeited) {
                setNotice({key: 'tournaments.forfeitedAbandoned'});
                setReloadKey((k) => k + 1);
                return;
            }
        } catch (err) {
            setNotice(errorMessage(err, 'tournaments.loadFailed'));
            return;
        }
        const opponentSeat = pending.white_seat === tournament.my_seat ? pending.black_seat : pending.white_seat;
        navigate('/', {state: {tournamentGame: gameStart(tournament, pending, name(opponentSeat))}});
    };

    const withdraw = async () => {
        if (!window.confirm(t('tournaments.withdrawConfirm'))) return;
        try {
            setTournament(await withdrawTournament(tournament.id));
            setNotice({key: 'tournaments.withdrawn'});
            setReloadKey((k) => k + 1);
        } catch (err) {
            setNotice(errorMessage(err, 'tournaments.loadFailed'));
        }
    };

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="tournament-view">
            <nav className="text-sm"><Link to="/tournaments" className="underline text-amber-300">{t('tournaments.title')}</Link></nav>
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="text-2xl font-bold text-amber-200">
                    {t(`tournaments.formats.${tournament.format}`)} · {tournament.size}
                </h1>
                <span className="text-sm text-amber-300" data-testid="tournament-status">
                    {tournament.status === 'finished'
                        ? t('tournaments.statuses.finished')
                        : t('tournaments.roundOf', {round: tournament.current_round, total: totalRounds})}
                </span>
            </header>

            {notice && <p role="status" className="text-sm text-amber-200" data-testid="tournament-notice">{renderUiMessage(notice, t)}</p>}
            {tournament.status === 'active' && (
                <div className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark flex flex-wrap items-center gap-3">
                    {pending ? (
                        <>
                            <span>{t('tournaments.waitingForYou')}</span>
                            <button type="button" onClick={play}
                                    className="px-4 py-2 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600 cursor-pointer">
                                {t('tournaments.playMyGame')}
                            </button>
                        </>
                    ) : botGamesRunning(tournament) && <span className="animate-pulse">{t('tournaments.botsPlaying')}</span>}
                    {!tournament.withdrawn && (
                        <button type="button" onClick={withdraw}
                                className="ml-auto px-3 py-1.5 rounded-md bg-black/40 border border-rose-700/60 text-rose-200 hover:bg-black/60 cursor-pointer">
                            {t('tournaments.withdraw')}
                        </button>
                    )}
                </div>
            )}
            {tournament.status === 'finished' && winner && (
                <p className="text-lg text-amber-200" data-testid="tournament-winner">{t('tournaments.winner', {name: name(winner.seat)})}</p>
            )}

            {tournament.format === 'round_robin' ? (
                <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark overflow-x-auto">
                    <h2 className="font-bold text-amber-200 mb-2">{t('tournaments.crosstable')}</h2>
                    <table className="w-full text-sm" data-testid="crosstable">
                        <thead>
                            <tr className="text-boxwood/70">
                                <th className="text-left px-1">#</th>
                                <th className="text-left px-1">{t('tournaments.player')}</th>
                                {tournament.standings.map((s) => <th key={s.seat} className="px-1">{s.place}</th>)}
                                <th className="px-1">{t('tournaments.points')}</th>
                                <th className="px-1">{t('tournaments.sonnebornBerger')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tournament.standings.map((row) => (
                                <tr key={row.seat} className={row.seat === tournament.my_seat ? 'bg-amber-900/30' : ''}>
                                    <td className="px-1">{row.place}</td>
                                    <td className="px-1 whitespace-nowrap">{name(row.seat)}</td>
                                    {tournament.standings.map((col) => {
                                        if (col.seat === row.seat) return <td key={col.seat} className="px-1 bg-black/40"/>;
                                        const game = tournament.games.find((g) => g.result
                                            && ((g.white_seat === row.seat && g.black_seat === col.seat)
                                                || (g.white_seat === col.seat && g.black_seat === row.seat)));
                                        return <td key={col.seat} className="px-1 text-center font-mono">{game ? resultFor(game, row.seat) : ''}</td>;
                                    })}
                                    <td className="px-1 text-center font-bold">{row.points}</td>
                                    <td className="px-1 text-center font-mono text-boxwood/80">{row.sonneborn_berger}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            ) : (
                <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark overflow-x-auto" data-testid="bracket">
                    <h2 className="font-bold text-amber-200 mb-2">{t('tournaments.bracket')}</h2>
                    <div className="flex gap-4">
                        {rounds.map((round) => {
                            const boards = Array.from(new Set(tournament.games.filter((g) => g.round === round).map((g) => g.board)));
                            return (
                                <div key={round} className="flex flex-col gap-3 justify-around min-w-[180px]">
                                    <h3 className="text-xs text-boxwood/70">{knockoutRoundName(t, tournament.size, round)}</h3>
                                    {boards.map((board) => {
                                        const match = tournament.games.filter((g) => g.round === round && g.board === board);
                                        const main = match.find((g) => g.stage === 'main')!;
                                        return (
                                            <div key={board} className="bg-black/30 rounded p-2 text-sm">
                                                {[main.white_seat, main.black_seat].map((seat) => {
                                                    const out = tournament.players.find((p) => p.seat === seat)?.eliminated_round === round;
                                                    return <div key={seat} className={out ? 'text-boxwood/50 line-through' : 'font-bold'}>{name(seat)}</div>;
                                                })}
                                                <div className="text-xs text-boxwood/70 font-mono">{match.map((g) => g.result ?? '…').join(' · ')}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark">
                <h2 className="font-bold text-amber-200 mb-2">{t('tournaments.schedule')}</h2>
                {rounds.map((round) => (
                    <div key={round} className="mb-2">
                        <h3 className="text-xs text-boxwood/70">
                            {tournament.format === 'round_robin'
                                ? t('tournaments.roundOf', {round, total: totalRounds})
                                : knockoutRoundName(t, tournament.size, round)}
                        </h3>
                        <ul className="text-sm">
                            {tournament.games.filter((g) => g.round === round).map((g) => (
                                <li key={g.id} className="flex flex-wrap gap-2 items-baseline" data-testid={`tgame-${g.id}`}>
                                    {g.stage !== 'main' && <span className="text-xs text-amber-300">{t(`tournaments.stages.${g.stage}`)}</span>}
                                    <span>{name(g.white_seat)} — {name(g.black_seat)}</span>
                                    <span className="font-mono">{g.result ?? '…'}</span>
                                    {g.game_id && <Link to={`/game/${g.game_id}`} className="underline text-amber-300">{t('tournaments.viewGame')}</Link>}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </section>

            {tournament.status === 'finished' && me?.place != null && me.place <= 3 && (
                <Diploma name={myName || t('tournaments.you')} place={me.place}
                         format={t(`tournaments.formats.${tournament.format}`)} size={tournament.size}
                         date={new Date(tournament.finished_at ?? tournament.created_at).toLocaleDateString(dateLocale.code)}/>
            )}
        </div>
    );
}
