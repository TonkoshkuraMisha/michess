// --- FILE: frontend/src/services/tournamentResults.ts ---
// Итоги турнира или арены для экрана окончания (TournamentCelebration): чистые функции без сети и без разметки.
// Из таблицы сервера (Tournament.standings / players, Arena.standings) строят полный список участников — место, имя,
// рейтинг, очки — и сводку игрока (очки, победы/ничьи/поражения, рейтинг). Один источник правды — сервер: здесь
// только раскладка по строкам; имена боты получают из каталогов i18n (participantName).

import type {I18n} from '../i18n';
import type {ArenaStanding} from './arenas';
import {participantName, type Tournament} from './tournaments';

/** Строка итоговой таблицы на экране окончания. */
export interface ResultRow {
    key: string | number;
    place: number;
    name: string;
    rating: number | null;
    /** Очки уже в виде текста («2,5», «×» у выбывшего). */
    score: string;
    /** Строка самого игрока: подсвечивается и прокручивается в видимую область. */
    mine: boolean;
    /** Код аватара (PlayerAvatar); пусто — аватар вычисляется из имени. */
    avatar?: string | null;
    /** Мелкая подпись под именем: победы/ничьи/поражения в турнире, перформанс в арене (как всплывающие итоги chess.com и перформанс lichess). */
    detail?: string;
}

/** Сводка игрока: подписи берёт клиент (ключи celebration.stats.*), здесь только значения. */
export interface ResultStats {
    points: string;
    wins: number;
    draws: number;
    losses: number;
    rating: number | null;
}

/** Сводка турнира целиком над таблицей (как шапка итогов lichess): сколько партий, доля ничьих и побед белых. */
export interface TournamentSummary {
    games: number;
    drawPercent: number;
    whitePercent: number;
}

/** Очки одним числом для людей: 3 → «3», 2.5 → «2,5» (запятая — как принято в шахматных таблицах). */
export function formatPoints(points: number): string {
    return String(points).replace('.', ',');
}

/** Победы, ничьи и поражения участника по сыгранным партиям турнира. */
function seatRecord(tournament: Tournament, seat: number): { wins: number; draws: number; losses: number } {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    for (const g of tournament.games) {
        if (g.result === null || (g.white_seat !== seat && g.black_seat !== seat)) continue;
        if (g.result === '1/2-1/2') draws++;
        else if ((g.result === '1-0') === (g.white_seat === seat)) wins++;
        else losses++;
    }
    return {wins, draws, losses};
}

/** Итоговая таблица турнира: по таблице сервера, а на выбывание (таблицы очков нет) — по итоговым местам участников. */
export function tournamentRows(tournament: Tournament, tr: I18n['t'], myName?: string): ResultRow[] {
    const player = (seat: number) => tournament.players.find((p) => p.seat === seat);
    const row = (seat: number, place: number, score: string): ResultRow | null => {
        const p = player(seat);
        if (!p) return null;
        const record = seatRecord(tournament, seat);
        return {
            key: seat, place, name: participantName(p, tr, myName), rating: p.rating, score,
            mine: seat === tournament.my_seat,
            detail: record.wins + record.draws + record.losses > 0 ? `${record.wins}/${record.draws}/${record.losses}` : undefined,
        };
    };
    const rows = tournament.standings.length > 0
        ? tournament.standings.map((s) => row(s.seat, s.place, formatPoints(s.points)))
        : tournament.players.map((p) => row(p.seat, p.place ?? p.seat, p.eliminated_round ? '×' : ''));
    return rows.filter((r): r is ResultRow => r !== null).sort((a, b) => a.place - b.place || Number(b.mine) - Number(a.mine));
}

/** Сводка игрока по сыгранным партиям турнира; null — игрок в турнире не участвовал. */
export function tournamentStats(tournament: Tournament): ResultStats | null {
    const seat = tournament.my_seat;
    if (seat == null) return null;
    const {wins, draws, losses} = seatRecord(tournament, seat);
    const mine = tournament.standings.find((s) => s.seat === seat);
    const points = mine ? mine.points : wins + draws / 2;
    return {
        points: formatPoints(points), wins, draws, losses,
        rating: tournament.players.find((p) => p.seat === seat)?.rating ?? null,
    };
}

/** Сводка турнира: сыгранные партии, доля ничьих и побед белых; null — партий ещё нет. */
export function tournamentSummary(tournament: Tournament): TournamentSummary | null {
    const played = tournament.games.filter((g) => g.result !== null);
    if (played.length === 0) return null;
    const share = (count: number) => Math.round((100 * count) / played.length);
    return {
        games: played.length,
        drawPercent: share(played.filter((g) => g.result === '1/2-1/2').length),
        whitePercent: share(played.filter((g) => g.result === '1-0').length),
    };
}

/** Итоговая таблица арены: очки арены, рейтинг игрока на входе; свою строку определяет имя игрока. */
export function arenaRows(standings: ArenaStanding[], myName: string | null | undefined): ResultRow[] {
    return standings.filter((s) => s.games > 0).map((s) => ({
        key: s.username, place: s.place, name: s.username, rating: s.rating, score: String(s.score),
        mine: myName != null && s.username === myName,
        detail: s.performance != null ? `${s.performance}` : undefined,
    }));
}

/** Таблица итогов в CSV для скачивания (chess.com отдаёт результаты файлом): место, участник, рейтинг, очки; значения в кавычках. */
export function resultsCsv(rows: ResultRow[]): string {
    const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.place, r.name, r.rating ?? '', r.score].map(quote).join(','));
    return ['place,name,rating,score', ...lines].join('\r\n');
}
