// --- FILE: frontend/src/components/tournaments/TournamentGameBar.tsx ---
// Навигация турнирной партии: плашка над партией «турнир · тур N из M · соперник» с таблицей поверх доски (уйти с
// доски посреди партии нельзя — брошенная партия засчитывается поражением), а после партии — «Следующая партия»,
// «Таблица турнира» и ожидание, пока боты доигрывают тур. ContinueTournaments — на главной: турниры, где ждут
// партию игрока, чтобы вернуться в них и после перезагрузки страницы.
// Данные: services/tournaments.ts — getTournament (опрос раз в BAR_POLL_MS, пока ждём итог партии и боты доигрывают
// тур), startMyGame (сервер сам начинает партию и засчитывает брошенную поражением), listTournaments (для
// ContinueTournaments). Рисуется в Chessboard.tsx; праздник призёра — TournamentCelebration.tsx.

import {useCallback, useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {ListOrdered, Play, Trophy, X} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {I18n, UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {
    botGamesRunning, gameStart, getTournament, listTournaments, myPendingGame, opponentPage, participantName, startMyGame,
    totalRounds,
} from '../../services/tournaments';
import type {Tournament, TournamentSummary} from '../../services/tournaments';
import {eventTitle} from '../../services/timeMachine';
import {tournamentRows, tournamentStats} from '../../services/tournamentResults';
import {markCelebrated, shouldCelebrate, TournamentCelebration} from './TournamentCelebration';

// Период опроса сервера (мс), пока после партии ждём запись итога и доигрывание тура ботами.
export const BAR_POLL_MS = 3000;

/** Название турнира для плашки и праздника: историческое — по ключу события, обычное — «формат · размер». */
export function tournamentTitle(t: Pick<Tournament, 'event_key' | 'format' | 'size'>, tr: I18n['t']): string {
    return t.event_key ? eventTitle(t.event_key, tr) : `${tr(`tournaments.formats.${t.format}`)} · ${t.size}`;
}

/** Таблица поверх доски: очки и места (круговой, швейцарка) либо участники и выбывшие (сетка на выбывание). */
function StandingsOverlay({tournament, onClose}: { tournament: Tournament; onClose: () => void }) {
    const {t} = useI18n();
    const name = (seat: number) => participantName(tournament.players.find((p) => p.seat === seat)!, t);
    const rows = tournament.standings.length > 0
        ? tournament.standings.map((s) => ({seat: s.seat, place: s.place, points: String(s.points)}))
        // Сетка на выбывание: таблицы очков нет — участники и кто выбыл.
        : tournament.players.map((p) => ({seat: p.seat, place: p.place ?? p.seat, points: p.eliminated_round ? '×' : ''}));
    return (
        <div role="dialog" aria-label={t('tournaments.crosstable')} data-testid="tournament-standings-overlay"
             className="absolute inset-x-0 top-full mt-1 z-40 max-h-[60vh] overflow-y-auto rounded-md border border-amber-700/60 bg-[#1A120B] p-2 shadow-xl">
            <div className="flex items-center justify-between mb-1">
                <strong className="text-amber-200 text-sm">{t('tournaments.crosstable')}</strong>
                <button type="button" onClick={onClose} aria-label={t('tournaments.closeTable')} title={t('tournaments.closeTable')}
                        className="p-1 text-boxwood/80 hover:text-amber-200"><X size={14}/></button>
            </div>
            <table className="w-full text-xs">
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.seat} className={r.seat === tournament.my_seat ? 'bg-amber-900/40 font-bold' : ''}>
                            <td className="px-1 w-6 text-boxwood/70">{r.place}</td>
                            <td className="px-1 truncate">{name(r.seat)}</td>
                            <td className="px-1 text-right font-mono">{r.points}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <Link to={`/tournaments/${tournament.id}`} target="_blank" rel="noopener"
                  className="block mt-1 text-xs text-amber-300 underline">{t('tournaments.openFullTable')}</Link>
        </div>
    );
}

/**
 * tournamentGameId — партия турнира, которую игрок играет (или только что сыграл); gameOver — партия закончилась.
 */
export function TournamentGameBar({tournamentId, tournamentGameId, gameOver}: {
    tournamentId: number;
    tournamentGameId: number | null;
    gameOver: boolean;
}) {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [showTable, setShowTable] = useState(false);
    const [notice, setNotice] = useState<UiMessage | null>(null);

    const load = useCallback(() => getTournament(tournamentId).then(setTournament).catch(() => undefined), [tournamentId]);
    useEffect(() => {
        void load();
    }, [load, gameOver]);

    const current = tournament?.games.find((g) => g.id === tournamentGameId) ?? null;
    const next = tournament && gameOver ? myPendingGame(tournament) : null;
    const nextReady = next !== null && next.id !== tournamentGameId;
    // После партии ждём, пока сервер запишет её итог и боты доиграют тур.
    const waiting = Boolean(gameOver && tournament && tournament.status === 'active' && !nextReady
        && (current?.result == null || botGamesRunning(tournament)));
    useEffect(() => {
        if (!waiting) return;
        const timer = window.setTimeout(() => void load(), BAR_POLL_MS);
        return () => window.clearTimeout(timer);
    }, [waiting, tournament, load]);

    // Последняя партия сыграна, турнир закончен — экран итогов прямо у доски (один раз на турнир).
    const myPlace = tournament?.players.find((p) => p.seat === tournament.my_seat)?.place ?? null;
    const [celebrating, setCelebrating] = useState(false);
    useEffect(() => {
        if (gameOver && tournament?.status === 'finished' && myPlace !== null && shouldCelebrate(tournament.id)) {
            setCelebrating(true);
        }
    }, [gameOver, tournament, myPlace]);
    const closeCelebration = useCallback(() => {
        if (tournament) markCelebrated(tournament.id);
        setCelebrating(false);
    }, [tournament]);

    if (!tournament) return null;
    const opponentSeat = current ? (current.white_seat === tournament.my_seat ? current.black_seat : current.white_seat) : null;
    const opponent = opponentSeat !== null ? tournament.players.find((p) => p.seat === opponentSeat) : undefined;
    const name = (seat: number) => participantName(tournament.players.find((p) => p.seat === seat)!, t);

    const playNext = async () => {
        if (!next) return;
        try {
            const started = await startMyGame(tournament.id, next.id);
            if (started.forfeited) {
                setNotice({key: 'tournaments.forfeitedAbandoned'});
                void load();
                return;
            }
        } catch (err) {
            setNotice(errorMessage(err, 'tournaments.loadFailed'));
            return;
        }
        const nextOpponent = next.white_seat === tournament.my_seat ? next.black_seat : next.white_seat;
        navigate('/', {state: {tournamentGame: gameStart(tournament, next, name(nextOpponent))}});
    };

    return (
        <div className="relative shrink-0 rounded-md border border-amber-600/60 bg-amber-950/70 px-2.5 py-1.5 text-xs text-amber-100 flex flex-col gap-1.5"
             data-testid="tournament-bar">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Trophy size={14} className="text-amber-400 shrink-0"/>
                <strong className="truncate" data-testid="tournament-bar-title">{tournamentTitle(tournament, t)}</strong>
                <span className="text-amber-300">
                    {t('tournaments.roundOf', {round: current?.round ?? tournament.current_round, total: totalRounds(tournament)})}
                </span>
                {opponent && <span className="text-boxwood/85" data-testid="tournament-bar-opponent">
                    {t('tournaments.barVs', {name: participantName(opponent, t)})}
                </span>}
                <button type="button" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} data-testid="tournament-bar-table"
                        className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-amber-700/60 hover:bg-black/30">
                    <ListOrdered size={13}/> {t('tournaments.table')}
                </button>
            </div>
            {gameOver && (
                <div className="flex flex-wrap items-center gap-2" data-testid="tournament-bar-after">
                    {nextReady && (
                        <button type="button" onClick={() => void playNext()} data-testid="tournament-next-game"
                                className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-700 text-white font-bold hover:bg-amber-600">
                            <Play size={13}/> {t('tournaments.nextGame')}
                        </button>
                    )}
                    {waiting && <span className="animate-pulse" data-testid="tournament-bar-waiting">{t('tournaments.roundInProgress')}</span>}
                    {tournament.status === 'finished' && <span data-testid="tournament-bar-finished">{t('tournaments.tournamentOver')}</span>}
                    <Link to={`/tournaments/${tournament.id}`} data-testid="back-to-tournament"
                          className="px-3 py-1.5 rounded border border-amber-500/60 bg-black/30 font-bold hover:bg-black/50">
                        {t('tournaments.backToTournament')}
                    </Link>
                    {opponent && opponentPage(opponent) && (
                        <Link to={opponentPage(opponent)!} data-testid="tournament-bar-opponent-card" className="underline text-amber-300">
                            {t('tournaments.opponentCard')}
                        </Link>
                    )}
                </div>
            )}
            {notice && <p role="status" className="text-amber-200">{renderUiMessage(notice, t)}</p>}
            {showTable && <StandingsOverlay tournament={tournament} onClose={() => setShowTable(false)}/>}
            {celebrating && myPlace !== null && (
                <TournamentCelebration place={myPlace} title={tournamentTitle(tournament, t)} size={tournament.size}
                                       rows={tournamentRows(tournament, t)} stats={tournamentStats(tournament)}
                                       onClose={closeCelebration}/>
            )}
        </div>
    );
}

/** Главная: турниры, где ждут партию игрока (и после перезагрузки страницы). */
export function ContinueTournaments() {
    const {t} = useI18n();
    const [ready, setReady] = useState<TournamentSummary[]>([]);
    useEffect(() => {
        if (!getToken()) return;
        listTournaments().then((list) => setReady(list.filter((s) => s.status === 'active' && s.my_game_ready)))
            .catch(() => undefined);
    }, []);
    if (ready.length === 0) return null;
    return (
        <div className="shrink-0 flex flex-col gap-1" data-testid="continue-tournaments">
            {ready.slice(0, 3).map((s) => (
                <Link key={s.id} to={`/tournaments/${s.id}`} data-testid={`continue-tournament-${s.id}`}
                      className="flex items-center gap-2 rounded-md border border-amber-500/60 bg-amber-900/60 px-2.5 py-1.5 text-xs text-amber-100 hover:bg-amber-800/70">
                    <Trophy size={14} className="text-amber-300 shrink-0"/>
                    <span className="truncate font-bold">{tournamentTitle(s, t)}</span>
                    <span className="ml-auto shrink-0">{t('tournaments.continueReady', {round: s.current_round})}</span>
                </Link>
            ))}
        </div>
    );
}
