// --- FILE: frontend/src/components/tournaments/TournamentsPage.tsx ---
// Турниры (таск 15.3): /tournaments — свои турниры и создание нового; /tournaments/:id — турнир: таблица или сетка,
// партии по турам, «Играть мою партию», диплом призёра. Партии ботов между собой играет сервер — страница
// обновляет состояние, пока они идут.
// Раскладка списка (план владельца 18.11, общие компоненты): шапка, карточки «Арены» и «Машина времени», «Мои
// турниры» с меткой места или статуса, карьера и создание турнира.
// Данные: services/tournaments.ts (listTournaments, createTournament, getTournament, startMyGame, withdrawTournament),
// каталог ботов services/botCatalog.ts и личности игрока services/personalities.ts; имя игрока — GET /api/v1/profile/me.
// Роуты — App.tsx. Соперников для своего турнира выбирает любой игрок — без порогов по силе.

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {Hourglass, Swords, Trophy} from 'lucide-react';
import {Badge, Card, CardGrid, EmptyState, Page, PageHeader, Section} from '../ui';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {HISTORICAL_BOTS_LIST} from '../../config/champions';
import {ALL_TIME_CONTROLS} from '../../config/timeControls';
import {fetchBotCatalog, strengthLabel} from '../../services/botCatalog';
import type {BotStrength, CatalogArchetype} from '../../services/botCatalog';
import {listPersonalities} from '../../services/personalities';
import type {Personality} from '../../services/personalities';
import {
    botGamesRunning, createTournament, gameStart, getFormatSizes, getTournament, listTournaments, myLastGame, myPendingGame, opponentPage,
    participantName,
    startMyGame, totalRounds as roundsTotal, withdrawTournament,
} from '../../services/tournaments';
import {eventTitle} from '../../services/timeMachine';
import {RealResult} from './TimeMachine';
import type {
    ParticipantKind, RandomOpponents, Tournament, TournamentFormat, TournamentGame, TournamentSummary,
} from '../../services/tournaments';
import {ladderOpponentName} from '../../config/players';
import {Diploma} from './Diploma';
import {tournamentRows, tournamentStats, tournamentSummary} from '../../services/tournamentResults';
import {markCelebrated, shouldCelebrate, TournamentCelebration} from './TournamentCelebration';
import {tournamentTitle} from './TournamentGameBar';
import {Career} from './Career';
import {getToken} from '../../services/authToken';
import {accountApi} from '../../services/account';

// Период обновления страницы турнира (мс), пока сервер играет партии ботов.
const POLL_MS = 3000;

// Выбранный соперник: вид участника (бот, архетип, личность игрока) и его id; pickKey — ключ для сравнения.
type Pick = { kind: ParticipantKind; id: string | number };
const pickKey = (p: Pick) => `${p.kind}:${p.id}`;

/** Форма нового турнира: формат, размер, контроль и соперники — выбранные вручную или случайные (режимы my_level/stronger/weaker). */
function CreateTournament() {
    const {t, tp} = useI18n();
    const navigate = useNavigate();
    const [format, setFormat] = useState<TournamentFormat>('round_robin');
    const [size, setSize] = useState(4);
    // Допустимые размеры по форматам — с сервера (GET /tournaments/formats); до ответа в списке только текущий размер.
    const [formatSizes, setFormatSizes] = useState<Record<TournamentFormat, number[]> | null>(null);
    const [picks, setPicks] = useState<Pick[]>([]);
    // Соперники: выбранные вручную или случайные из диапазона силы (таск 15.4).
    const [mode, setMode] = useState<'chosen' | RandomOpponents>('chosen');
    const presets = useMemo(() => ALL_TIME_CONTROLS.filter((o) => !o.isManual), []);
    const [timeControlId, setTimeControlId] = useState(presets.find((o) => o.base === 5)?.id ?? presets[0].id);
    const [archetypes, setArchetypes] = useState<CatalogArchetype[]>([]);
    // Сила исторических ботов из каталога сервера: посев турнира идёт по измеренной силе, её и показываем.
    const [historical, setHistorical] = useState<Record<string, BotStrength>>({});
    const [personalities, setPersonalities] = useState<Personality[]>([]);
    const [error, setError] = useState<UiMessage | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        getFormatSizes().then(setFormatSizes).catch(() => undefined);
        fetchBotCatalog().then((c) => {
            setArchetypes(c.archetypes);
            setHistorical(Object.fromEntries(c.historical.map((h) => [h.id, h])));
        }).catch(() => undefined);
        const token = getToken();
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
                format, size, participants: mode === 'chosen' ? picks : [], ...(mode === 'chosen' ? {} : {random: mode}),
                base_time_ms: control.base * 60000, increment_ms: control.inc * 1000,
            });
            navigate(`/tournaments/${created.id}`);
        } catch (err) {
            setError(errorMessage(err, 'tournaments.createFailed'));
        } finally {
            setBusy(false);
        }
    };

    const chip = (pick: Pick, label: string, rating?: string) => (
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
                                const allowed = formatSizes?.[next];
                                if (allowed?.length && !allowed.includes(size)) setSize(allowed[0]);
                                setPicks([]);
                            }}>
                        {(['round_robin', 'knockout', 'swiss'] as const).map((f) => <option key={f} value={f}>{t(`tournaments.formats.${f}`)}</option>)}
                    </select>
                </label>
                <label className="flex flex-col text-sm gap-1">
                    {t('tournaments.size')}
                    <select value={size} className="bg-black/40 rounded px-2 py-1"
                            onChange={(e) => {
                                setSize(Number(e.target.value));
                                setPicks([]);
                            }}>
                        {(formatSizes?.[format] ?? [size]).map((n) => <option key={n} value={n}>{n}</option>)}
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
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('career.opponents')}>
                {(['chosen', 'my_level', 'stronger', 'weaker'] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                            data-testid={`opponents-mode-${m}`}
                            className={`px-2 py-1 rounded border text-sm ${mode === m ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`}>
                        {t(`career.modes.${m}`)}
                    </button>
                ))}
            </div>
            {mode !== 'chosen' && <p className="text-sm text-amber-300" data-testid="opponents-random">{t('career.randomHint', {count: needed})}</p>}
            {mode === 'chosen' && <p className="text-sm text-amber-300" data-testid="opponents-needed">
                {tp('tournaments.chooseOpponents', needed)} ({picks.length}/{needed})
            </p>}
            {mode === 'chosen' && <div className="flex flex-col gap-2">
                <h3 className="text-sm font-bold">{t('tournaments.historicalBots')}</h3>
                <div className="flex flex-wrap gap-1.5">
                    {HISTORICAL_BOTS_LIST.map((b) => chip({kind: 'bot', id: b.id}, ladderOpponentName('historical', b.id, t),
                        historical[b.id] ? strengthLabel(historical[b.id]) : String(b.rating)))}
                </div>
                {archetypes.length > 0 && <h3 className="text-sm font-bold">{t('tournaments.archetypes')}</h3>}
                <div className="flex flex-wrap gap-1.5">
                    {archetypes.map((a) => chip({kind: 'archetype', id: a.id}, ladderOpponentName('archetype', a.id, t), strengthLabel(a)))}
                </div>
                {personalities.length > 0 && <h3 className="text-sm font-bold">{t('tournaments.myOpponents')}</h3>}
                <div className="flex flex-wrap gap-1.5">
                    {personalities.map((p) => chip({kind: 'personality', id: p.id}, p.name, String(p.config.target_elo)))}
                </div>
            </div>}
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <button type="button" onClick={submit} disabled={busy || (mode === 'chosen' && picks.length !== needed)}
                    className="self-start px-4 py-2 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
                {t('tournaments.create')}
            </button>
        </section>
    );
}

/** Страница списка: ссылки на арены и «Машину времени», мои турниры, карьера и создание. */
export function TournamentsPage() {
    const {t} = useI18n();
    const [items, setItems] = useState<TournamentSummary[]>([]);
    useEffect(() => {
        listTournaments().then(setItems).catch(() => undefined);
    }, []);
    return (
        <Page testId="tournaments-page">
            <PageHeader title={t('tournaments.title')} icon={<Trophy size={24}/>} description={t('tournaments.intro')}/>
            <CardGrid cols={2}>
                <Card to="/arenas" testId="arenas-link" icon={<Swords size={20}/>}
                      title={t('arenas.title')} description={t('arenas.cta')}/>
                <Card to="/time-machine" testId="time-machine-link" icon={<Hourglass size={20}/>}
                      title={t('timeMachine.title')} description={t('timeMachine.teaser')}/>
            </CardGrid>
            <Section title={t('tournaments.myTournaments')} testId="my-tournaments">
                {items.length === 0 ? (
                    <EmptyState icon={<Trophy size={28}/>} title={t('tournaments.none')}/>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {items.map((item) => (
                            <li key={item.id}>
                                <Link to={`/tournaments/${item.id}`}
                                      className="flex items-center justify-between gap-2 bg-acacia rounded-lg border border-amber-900/50 px-4 py-2.5 hover:border-amber-500 transition-colors">
                                    <span className="font-bold text-amber-100">{t(`tournaments.formats.${item.format}`)} · {item.size}</span>
                                    <Badge tone={item.status === 'finished' ? (item.my_place === 1 ? 'success' : 'neutral') : 'accent'}>
                                        {item.status === 'finished' && item.my_place
                                            ? t('tournaments.placeOf', {place: item.my_place, size: item.size})
                                            : t(`tournaments.statuses.${item.status}`)}
                                    </Badge>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
            <Career/>
            <CreateTournament/>
        </Page>
    );
}

/** Итог партии глазами места seat: «1», «½», «0»; пусто, пока партия не сыграна. */
function resultFor(game: TournamentGame, seat: number): string {
    if (!game.result) return '';
    if (game.result === '1/2-1/2') return '½';
    const whiteWon = game.result === '1-0';
    return (game.white_seat === seat) === whiteWon ? '1' : '0';
}

/** Название круга сетки по числу кругов от конца: финал, полуфинал, четвертьфинал или «круг N». */
function knockoutRoundName(t: ReturnType<typeof useI18n>['t'], size: number, round: number): string {
    const fromEnd = Math.max(1, Math.ceil(Math.log2(size))) - round;
    if (fromEnd > 2) return t('tournaments.knockoutRounds.round', {n: round});
    return t(`tournaments.knockoutRounds.${fromEnd === 0 ? 'final' : fromEnd === 1 ? 'semifinal' : 'quarterfinal'}`);
}

/** Страница одного турнира: таблица (круговой, швейцарка) или сетка, расписание по турам, действия игрока, диплом и праздник. */
export function TournamentView() {
    const {t, dateLocale} = useI18n();
    const navigate = useNavigate();
    const id = Number(useParams().tournamentId);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [myName, setMyName] = useState('');
    const [notice, setNotice] = useState<UiMessage | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    // Экран итогов (17.11, таблица — 21.11): при первом взгляде на законченный турнир, где у игрока есть место; повтор — кнопкой.
    const [celebrating, setCelebrating] = useState(false);
    const finishedPlace = tournament?.status === 'finished'
        ? tournament.players.find((p) => p.seat === tournament.my_seat)?.place ?? null : null;
    useEffect(() => {
        if (tournament && finishedPlace !== null && shouldCelebrate(tournament.id)) setCelebrating(true);
    }, [tournament, finishedPlace]);
    const closeCelebration = useCallback(() => {
        markCelebrated(id);
        setCelebrating(false);
    }, [id]);

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
        const token = getToken();
        if (!token) return;
        accountApi.me().then((me) => me.username && setMyName(me.username)).catch(() => undefined);
    }, []);

    if (error) return <p role="alert" className="p-6 text-center text-rose-300">{renderUiMessage(error, t)}</p>;
    if (!tournament) return null;

    const name = (seat: number) => participantName(tournament.players.find((p) => p.seat === seat)!, t);
    const rounds = Array.from(new Set(tournament.games.map((g) => g.round))).sort((a, b) => a - b);
    const totalRounds = roundsTotal(tournament);
    const historic = Boolean(tournament.event_key);
    // Сетка на выбывание: кто в первом круге не играл — прошёл дальше без игры (по порядку посева).
    const firstRoundSeats = new Set(tournament.games.filter((g) => g.round === 1).flatMap((g) => [g.white_seat, g.black_seat]));
    const byes = tournament.format === 'knockout'
        ? tournament.players.filter((p) => !firstRoundSeats.has(p.seat)).sort((a, b) => a.seat - b.seat) : [];
    // В большом турнире расписание длинное: туры свёрнуты, открыт текущий.
    const foldRounds = rounds.length > 8;
    const pending = myPendingGame(tournament);
    const me = tournament.players.find((p) => p.seat === tournament.my_seat);
    const winner = tournament.players.find((p) => p.place === 1);
    const lastMine = myLastGame(tournament);

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
            <nav className="text-sm">
                {historic
                    ? <Link to="/time-machine" className="underline text-amber-300">{t('timeMachine.title')}</Link>
                    : <Link to="/tournaments" className="underline text-amber-300">{t('tournaments.title')}</Link>}
            </nav>
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="text-2xl font-bold text-amber-200" data-testid="tournament-title">
                    {historic && tournament.event_key ? `${eventTitle(tournament.event_key, t)} · ` : ''}
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
            {lastMine && (() => {
                const opponentSeat = lastMine.white_seat === tournament.my_seat ? lastMine.black_seat : lastMine.white_seat;
                const page = opponentPage(tournament.players.find((p) => p.seat === opponentSeat)!);
                return (
                    <div className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark flex flex-wrap items-center gap-3 text-sm"
                         data-testid="my-last-game">
                        <span>{t('tournaments.myLastGame', {
                            round: lastMine.round, opponent: name(opponentSeat), result: resultFor(lastMine, tournament.my_seat!),
                        })}</span>
                        {lastMine.game_id && (
                            <Link to={`/game/${lastMine.game_id}`} className="underline text-amber-300" data-testid="my-last-game-review">
                                {t('tournaments.viewGame')}
                            </Link>
                        )}
                        {page && (
                            <Link to={page} className="underline text-amber-300" data-testid="my-last-game-opponent">
                                {t('tournaments.opponentCard')}
                            </Link>
                        )}
                    </div>
                );
            })()}
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
                                        // В турнире в несколько кругов пара встречается несколько раз: все итоги подряд.
                                        const games = tournament.games.filter((g) => g.result
                                            && ((g.white_seat === row.seat && g.black_seat === col.seat)
                                                || (g.white_seat === col.seat && g.black_seat === row.seat)));
                                        return (
                                            <td key={col.seat} className="px-1 text-center font-mono whitespace-nowrap">
                                                {games.map((g) => resultFor(g, row.seat)).join(' ')}
                                            </td>
                                        );
                                    })}
                                    <td className="px-1 text-center font-bold">{row.points}</td>
                                    <td className="px-1 text-center font-mono text-boxwood/80">{row.sonneborn_berger}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            ) : tournament.format === 'swiss' ? (
                <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark overflow-x-auto">
                    <h2 className="font-bold text-amber-200 mb-2">{t('tournaments.crosstable')}</h2>
                    <table className="w-full text-sm" data-testid="swiss-table">
                        <thead>
                            <tr className="text-boxwood/70">
                                <th className="text-left px-1">#</th>
                                <th className="text-left px-1">{t('tournaments.player')}</th>
                                <th className="px-1">{t('tournaments.points')}</th>
                                <th className="px-1">{t('tournaments.buchholz')}</th>
                                <th className="px-1">{t('tournaments.sonnebornBerger')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tournament.standings.map((row) => (
                                <tr key={row.seat} className={row.seat === tournament.my_seat ? 'bg-amber-900/30' : ''}>
                                    <td className="px-1">{row.place}</td>
                                    <td className="px-1 whitespace-nowrap">{name(row.seat)}</td>
                                    <td className="px-1 text-center font-bold">{row.points}</td>
                                    <td className="px-1 text-center font-mono text-boxwood/80">{row.buchholz ?? 0}</td>
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
                                    {round === 1 && byes.length > 0 && (
                                        // Большая сетка: сильнейшие по посеву проходят первый круг без игры.
                                        <p className="text-xs text-boxwood/70" data-testid="bracket-byes">
                                            {t('tournaments.byes', {names: byes.map((p) => name(p.seat)).join(', ')})}
                                        </p>
                                    )}
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
                    <details key={round} className="mb-2" data-testid={`round-${round}`}
                             open={!foldRounds || round === tournament.current_round}>
                        <summary className={`text-xs text-boxwood/70 ${foldRounds ? 'cursor-pointer' : 'list-none'}`}>
                            {tournament.format !== 'knockout'
                                ? t('tournaments.roundOf', {round, total: totalRounds})
                                : knockoutRoundName(t, tournament.size, round)}
                        </summary>
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
                    </details>
                ))}
            </section>

            {historic && tournament.event_key && (
                <RealResult eventKey={tournament.event_key} finished={tournament.status === 'finished'} myPlace={me?.place ?? null}/>
            )}

            {tournament.status === 'finished' && me?.place != null && me.place <= 3 && (
                <Diploma name={myName || t('tournaments.you')} place={me.place}
                         format={historic && tournament.event_key ? eventTitle(tournament.event_key, t)
                             : t(`tournaments.formats.${tournament.format}`)} size={tournament.size}
                         date={new Date(tournament.finished_at ?? tournament.created_at).toLocaleDateString(dateLocale.code)}/>
            )}
            {tournament.status === 'finished' && me?.place != null && (
                <button type="button" onClick={() => setCelebrating(true)} data-testid="celebrate-again"
                        className="self-center px-4 py-2 rounded-full bg-amber-700 text-white font-bold hover:bg-amber-600 cursor-pointer">
                    {t(me.place <= 3 ? 'celebration.again' : 'celebration.results')}
                </button>
            )}
            {celebrating && me?.place != null && (
                <TournamentCelebration place={me.place} title={tournamentTitle(tournament, t)} size={tournament.size}
                                       rows={tournamentRows(tournament, t, myName || undefined)} stats={tournamentStats(tournament)} summary={tournamentSummary(tournament)}
                                       onClose={closeCelebration}/>
            )}
        </div>
    );
}
