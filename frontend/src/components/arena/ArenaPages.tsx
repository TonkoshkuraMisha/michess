// --- FILE: frontend/src/components/arena/ArenaPages.tsx ---
// Арены (таск 17.2): /arenas — идущие и ближайшие арены; /arenas/:id — таблица, вход и «Играть». Пока игрок ждёт
// пару, страница повторяет «Играть» раз в WAIT_POLL_MS; как только партия создана — переход на главную доску (она
// сама подхватывает идущую партию). ArenaBanner — анонс в лобби главной доски. Арены идут по расписанию конференций
// (33.4): в названии — конференция; у ещё не начавшейся арены — «напомнить перед началом». Зачёт конференций
// (33.6): у игрока в таблице — его конференция, под таблицей — очки конференций в этой арене. Под списком арен —
// месячная лига арен (33.5, ArenaLeague.tsx). Призёру арены (место из наград сервера, me.podium_place) страница один
// раз показывает праздник призёра — тот же, что после турниров (TournamentCelebration). Матч конференций (format
// 'match', ConferenceMatches.tsx): вместо таблицы — счёт и доски; «Играть» нет — партии туров начинаются сами.
// Данные: services/arenas.ts — arenasApi (GET /api/v1/arenas, /arenas/current, /arenas/{id}; POST join, ready, remind,
// leave-waiting); состояние арены целиком считает сервер (src/services/arena.py), клиент только показывает и опрашивает.
// Роуты — App.tsx; ArenaBanner рисует LobbyPanel.tsx. Вход открыт любому зарегистрированному игроку, без порогов по силе.

import {useCallback, useEffect, useRef, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {Bell, Flame, Swords, Trophy} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {arenasApi, clock, conferenceKey, controlLabel, secondsUntil} from '../../services/arenas';
import type {ArenaDetail, ArenaInfo} from '../../services/arenas';
import {ArenaLeague} from './ArenaLeague';
import {conferenceName, MatchBoards} from './ConferenceMatches';
import {arenaRows} from '../../services/tournamentResults';
import {markCelebrated, shouldCelebrate, TournamentCelebration} from '../tournaments/TournamentCelebration';

// Период опроса «есть ли партия» (мс), пока игрок нажал «Играть» и ждёт пару.
export const WAIT_POLL_MS = 2000;
// Период обновления страницы арены (мс): таблица, часы и статус.
const REFRESH_MS = 5000;

/** Текущее время в мс, обновляется раз в intervalMs — для обратных отсчётов. */
function useNow(intervalMs = 1000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(id);
    }, [intervalMs]);
    return now;
}

/** Название арены; withConference: false — короткое, для узкого анонса в лобби. */
function arenaName(a: ArenaInfo, t: ReturnType<typeof useI18n>['t'], withConference = true): string {
    if (a.format === 'match') {
        return t('arenas.matchName', {home: conferenceName(a.conference, t), guest: conferenceName(a.opponent_conference, t)});
    }
    const base = a.format === 'swiss'
        ? t('arenas.swissName', {control: controlLabel(a), rounds: a.rounds ?? 0})
        : t(a.evening ? 'arenas.eveningName' : 'arenas.name', {control: controlLabel(a)});
    // Конференция, по расписанию которой идёт арена (33.4).
    const key = withConference ? conferenceKey(a.conference) : null;
    const conference = key ? ` · ${t(`arenas.conferences.${key}`)}` : '';
    // Деление переполненной арены (33.2).
    const division = (a.division ?? 1) > 1 ? ` · ${t('arenas.division', {n: a.division ?? 1})}` : '';
    return `${base}${conference}${division}`;
}

/** Строка про время арены по статусу: старт, раунд, последний старт и конец, доигрывание партий. */
function timing(a: ArenaInfo, now: number, t: ReturnType<typeof useI18n>['t']): string {
    if (a.status === 'scheduled') return t('arenas.startsIn', {time: clock(secondsUntil(a.starts_at, now))});
    if (a.status === 'running' && (a.format === 'swiss' || a.format === 'match')) return t('arenas.round', {round: a.current_round ?? 0, total: a.rounds ?? 0});
    if (a.status === 'running' && a.last_start_at) {
        return t('arenas.lastStartIn', {time: clock(secondsUntil(a.last_start_at, now)), end: clock(secondsUntil(a.ends_at, now))});
    }
    if (a.status === 'running') return t('arenas.endsIn', {time: clock(secondsUntil(a.ends_at, now))});
    // Честный конец (33.1): после последнего старта — доигрывание; итоги окончательные, когда все партии сыграны.
    if (a.status === 'closing' && (a.open_games ?? 0) > 0) return t('arenas.closingGames', {n: a.open_games ?? 0});
    if (a.status === 'closing') return t('arenas.closingTime', {time: clock(secondsUntil(a.ends_at, now))});
    return t('arenas.finished');
}

/** Список идущих и ближайших арен и под ним месячная лига. */
export function ArenasPage() {
    const {t} = useI18n();
    const now = useNow();
    const [arenas, setArenas] = useState<ArenaInfo[]>([]);
    useEffect(() => {
        arenasApi.list().then((r) => setArenas(r.arenas)).catch(() => undefined);
    }, []);
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="arenas-page">
            <header className="flex items-center gap-2">
                <Swords className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('arenas.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('arenas.intro')}</p>
            <p className="text-sm text-boxwood/75" data-testid="arenas-conference-note">{t('arenas.conferenceNote')}</p>
            <Link to="/conferences" data-testid="conferences-link" className="self-start text-amber-300 hover:underline">{t('conferences.cta')}</Link>
            <ul className="flex flex-col gap-2">
                {arenas.map((a) => (
                    <li key={a.id}>
                        <Link to={`/arenas/${a.id}`} data-testid={`arena-${a.id}`}
                              className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded border-2 ${a.status === 'running'
                                  ? 'bg-amber-900/30 border-amber-600' : 'bg-acacia border-acacia-dark'} hover:border-amber-400`}>
                            <span className="font-bold">{arenaName(a, t)}</span>
                            <span className="text-sm text-boxwood/80">{timing(a, now, t)} · {t('arenas.players', {n: a.players ?? 0})}</span>
                        </Link>
                    </li>
                ))}
            </ul>
            <ArenaLeague/>
        </div>
    );
}

/** Страница одной арены: вход, «Играть» (поиск пары опросом), напоминание, таблица или матч, зачёт конференций, праздник призёру. */
export function ArenaPage() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const now = useNow();
    const {arenaId = ''} = useParams<{ arenaId: string }>();
    const id = Number(arenaId);
    const [arena, setArena] = useState<ArenaDetail | null>(null);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);
    const searchingRef = useRef(false);
    const [celebrating, setCelebrating] = useState(false);
    const celebrationKey = `arena-${id}`;

    const load = useCallback(() => {
        arenasApi.get(id).then((data) => {
            // Игрок в другом делении этой арены (33.2) — его таблица и кнопка «Играть» там.
            if (data.me?.division_arena_id) {
                navigate(`/arenas/${data.me.division_arena_id}`, {replace: true});
                return;
            }
            setArena(data);
            // Партия уже идёт (началась в другой вкладке или пока страница ждала) — на доску.
            if (data.me?.current_game_id) navigate('/');
        }).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [id, navigate]);

    useEffect(() => {
        load();
        const timer = window.setInterval(load, REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [load]);

    useEffect(() => {
        if (!searching) return;
        searchingRef.current = true;
        const tick = () => arenasApi.ready(id).then((r) => {
            if (r.game_id && searchingRef.current) navigate('/');
        }).catch((err) => {
            setSearching(false);
            setError(errorMessage(err, 'common.networkError'));
        });
        void tick();
        const timer = window.setInterval(tick, WAIT_POLL_MS);
        return () => {
            searchingRef.current = false;
            window.clearInterval(timer);
        };
    }, [searching, id, navigate]);

    // Экран итогов (33.5, таблица — 21.11): итоги окончательные и игрок сыграл хотя бы партию — один раз на арену.
    // Место призёра — из наград сервера; остальным — строка их имени в таблице итогов.
    const myName = arena?.me?.username;
    const myRow = arena?.standings.find((s) => s.username === myName && s.games > 0);
    const podium = arena?.status === 'finished' ? arena.me?.podium_place ?? myRow?.place ?? null : null;
    useEffect(() => {
        if (podium !== null && shouldCelebrate(celebrationKey)) setCelebrating(true);
    }, [podium, celebrationKey]);
    const closeCelebration = useCallback(() => {
        markCelebrated(celebrationKey);
        setCelebrating(false);
    }, [celebrationKey]);

    if (!arena) return error ? <p role="alert" className="p-4 text-rose-300">{renderUiMessage(error, t)}</p> : null;

    const join = () => arenasApi.join(id).then((r) => {
        if (r.arena_id && r.arena_id !== id) navigate(`/arenas/${r.arena_id}`);
        else load();
    }).catch((err) => setError(errorMessage(err, 'common.networkError')));
    const stop = () => {
        setSearching(false);
        arenasApi.leaveWaiting(id).catch(() => undefined);
    };
    const remind = (on: boolean) => (on ? arenasApi.remind(id) : arenasApi.forgetReminder(id))
        .then(load).catch((err) => setError(errorMessage(err, 'common.networkError')));

    // Арена «по времени» (формат не указан — тоже она): «Играть» и доигрывание; швейцарка и матч идут турами.
    const byTime = (arena.format ?? 'arena') === 'arena';

    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="arena-page">
            <Link to="/arenas" className="text-sm text-amber-400 hover:underline">{t('arenas.title')}</Link>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="text-2xl font-bold text-amber-200">{arenaName(arena, t)}</h1>
                <span className="font-mono text-amber-300" data-testid="arena-timing">{timing(arena, now, t)}</span>
            </div>
            <p className="text-sm text-boxwood/80">{t(arena.format === 'match' ? 'arenas.matchRules' : arena.format === 'swiss' ? 'arenas.swissRules' : 'arenas.rules')}</p>
            {arena.berserk && <p className="text-sm text-boxwood/80" data-testid="arena-berserk-rule">{t('arenas.berserkRule')}</p>}
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {getToken() && arena.status !== 'finished' && (
                <div className="flex flex-wrap items-center gap-3">
                    {!arena.me?.joined && (arena.format !== 'match' || arena.match?.entry_open) && (
                        <button type="button" onClick={() => void join()} data-testid="arena-join"
                                className="px-4 py-2 rounded bg-amber-700 text-white font-bold">{t('arenas.join')}</button>
                    )}
                    {arena.me?.joined && arena.status === 'running' && byTime && !searching && (
                        <button type="button" onClick={() => {
                            setError(null);
                            setSearching(true);
                        }} data-testid="arena-play" className="px-4 py-2 rounded bg-amber-700 text-white font-bold">{t('arenas.play')}</button>
                    )}
                    {searching && (
                        <>
                            <span className="animate-pulse" data-testid="arena-searching">{t('arenas.searching')}</span>
                            <button type="button" onClick={stop} className="text-sm text-amber-400 hover:underline">{t('arenas.stop')}</button>
                        </>
                    )}
                    {arena.me?.joined && arena.status === 'scheduled' && <span className="text-sm">{t('arenas.joinedWait')}</span>}
                    {arena.status === 'scheduled' && !arena.me?.reminder && (
                        <button type="button" onClick={() => void remind(true)} data-testid="arena-remind"
                                className="flex items-center gap-1.5 px-3 py-2 rounded border border-amber-600 text-sm text-amber-200 hover:border-amber-400">
                            <Bell size={14}/> {t('arenas.remind')}
                        </button>
                    )}
                    {arena.status === 'scheduled' && arena.me?.reminder && (
                        <span className="flex flex-wrap items-center gap-2 text-sm" data-testid="arena-reminder-on">
                            <Bell size={14} className="text-amber-400"/> {t('arenas.reminderOn')}
                            <button type="button" onClick={() => void remind(false)} data-testid="arena-reminder-off"
                                    className="text-amber-400 hover:underline">{t('arenas.reminderOff')}</button>
                        </span>
                    )}
                    {arena.status === 'closing' && byTime && (
                        <span className="text-sm" data-testid="arena-closing">{t('arenas.pairingClosed')}</span>
                    )}
                    {arena.me?.joined && arena.status === 'running' && !byTime && <span className="text-sm" data-testid="swiss-waiting">{t('arenas.swissWaiting')}</span>}
                </div>
            )}
            {arena.match && <MatchBoards match={arena.match}/>}
            {!arena.match && <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark overflow-x-auto">
                <h2 className="font-bold text-amber-200 mb-2 flex items-center gap-1.5"><Trophy size={16}/> {t('arenas.standings')}</h2>
                {arena.standings.length === 0 ? <p className="text-sm text-boxwood/70">{t('arenas.empty')}</p> : (
                    <table className="w-full text-sm" data-testid="arena-standings">
                        <thead>
                            <tr className="text-boxwood/70 text-left">
                                <th>#</th><th>{t('arenas.player')}</th><th className="text-right">{t('arenas.score')}</th>
                                <th className="text-right">{t('arenas.games')}</th>
                                <th className="text-right">{t('arenas.performance')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {arena.standings.map((s) => (
                                <tr key={s.username}>
                                    <td>{s.place}</td>
                                    <td className="flex items-center gap-1">
                                        {s.username} <span className="text-xs text-boxwood/60">{s.rating}</span>
                                        {conferenceKey(s.conference) && (
                                            <span className="text-xs text-amber-300/80" data-testid={`arena-conf-${s.username}`}
                                                  title={t(`arenas.conferences.${conferenceKey(s.conference)!}`)}>
                                                {t(`arenas.conferenceShort.${conferenceKey(s.conference)!}`)}
                                            </span>
                                        )}
                                        {s.fire && <Flame size={14} className="text-orange-400" aria-label={t('arenas.fire')}/>}
                                    </td>
                                    <td className="text-right font-bold">{s.score}</td>
                                    <td className="text-right font-mono text-boxwood/80">{s.games}</td>
                                    <td className="text-right font-mono text-boxwood/70" data-testid={`arena-perf-${s.username}`}>
                                        {s.performance ?? '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>}
            {!arena.match && (arena.conferences ?? []).length > 0 && (
                <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark overflow-x-auto">
                    <h2 className="font-bold text-amber-200 mb-2 flex flex-wrap items-baseline justify-between gap-2">
                        <span>{t('arenas.conferenceStandings')}</span>
                        <Link to="/conferences" className="text-sm font-normal text-amber-400 hover:underline">{t('conferences.title')}</Link>
                    </h2>
                    <table className="w-full text-sm" data-testid="arena-conferences">
                        <thead>
                            <tr className="text-boxwood/70 text-left">
                                <th>#</th><th>{t('conferences.conference')}</th>
                                <th className="text-right">{t('arenas.score')}</th>
                                <th className="text-right">{t('arenas.conferenceCounted')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(arena.conferences ?? []).map((row, index) => (
                                <tr key={row.conference}>
                                    <td>{index + 1}</td>
                                    <td>{conferenceKey(row.conference) ? t(`arenas.conferences.${conferenceKey(row.conference)!}`) : row.conference}</td>
                                    <td className="text-right font-bold">{row.score}</td>
                                    <td className="text-right font-mono text-boxwood/80">{row.counted}/{row.players}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
            {celebrating && podium !== null && (
                <TournamentCelebration place={podium} title={arenaName(arena, t)}
                                       size={arena.standings.filter((s) => s.games > 0).length} onClose={closeCelebration}
                                       rows={arenaRows(arena.standings, myName)} detailLabel={t('celebration.perfShort')}/>
            )}
        </div>
    );
}

/** Анонс в лобби: идущая (или ближайшая) арена. */
export function ArenaBanner() {
    const {t} = useI18n();
    const now = useNow();
    const [arena, setArena] = useState<ArenaInfo | null>(null);
    useEffect(() => {
        arenasApi.current().then((r) => setArena(r.arena)).catch(() => undefined);
    }, []);
    if (!arena) return null;
    return (
        <Link to={`/arenas/${arena.id}`} data-testid="arena-banner"
              className="flex items-center justify-between gap-2 px-2 py-1.5 mb-2 rounded bg-amber-900/40 border border-amber-700/60 text-xs hover:border-amber-400">
            <span className="flex items-center gap-1 font-bold text-amber-200"><Swords size={13}/> {arenaName(arena, t, false)}</span>
            <span className="text-boxwood/80">{timing(arena, now, t)}</span>
        </Link>
    );
}
