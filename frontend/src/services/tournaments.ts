// --- FILE: frontend/src/services/tournaments.ts ---
// Турниры с историческими мастерами (таски 15.1–15.3): API и подписи участников на языке игрока.
// Все запросы — к /api/v1/tournaments и только с входом (маршруты src/api/tournaments.py). Расписание, места и
// правила матчей — src/services/tournament_rules.py; партии ботов между собой играет сервер в фоне
// (tournament_simulation.py). Результат партии игрока сюда не отправляется: его приносит сохранение сыгранной
// партии (POST /api/v1/bots/save-game с полем tournament_game_id) — прислать итог самому нельзя.

import type {PersonalityConfig} from './personalities';
import {ARCHETYPE_PREFIX, isArchetypeId} from '../config/archetypes';
import type {CustomOpponent} from '../config/archetypes';
import {ladderOpponentName} from '../config/players';
import type {I18n, MessageKey} from '../i18n';
import {apiRequest} from './http';
import {GUEST_PREFIX, guestShortName} from './timeMachine';

export type TournamentFormat = 'round_robin' | 'knockout' | 'swiss';
/** Швейцарская система (таск 15.4): число туров по размеру — как на сервере (tournament_rules.SWISS_ROUNDS). */
export const SWISS_ROUNDS: Record<number, number> = {6: 4, 8: 5};
/** Соперник-бот: исторический бот, архетип мастерской или персоналия (своя либо мастер прошлого). */
export type ParticipantKind = 'bot' | 'archetype' | 'personality';

/** Участник турнира. */
export interface TournamentPlayer {
    /** Номер участника — его посев: 1 — сильнейший по рейтингу на старте. */
    seat: number;
    kind: 'user' | ParticipantKind;
    user_id: number | null;
    /** id исторического бота, «archetype:<id>» или «guest:<id>» мастера прошлого; у игрока — null. */
    bot_key: string | null;
    personality_name: string | null;
    rating: number;
    /** Итоговое место; null — турнир ещё идёт. */
    place: number | null;
    /** На выбывание: тур, в котором участник выбыл. */
    eliminated_round: number | null;
    /** Характер соперника из мастерской — с ним доска начинает партию; у исторического бота и у игрока — null. */
    config: PersonalityConfig | null;
}

/** Партия расписания турнира. */
export interface TournamentGame {
    id: number;
    round: number;
    board: number;
    /**
     * На выбывание: main — основная партия матча, rematch — переигровка после ничьей (цвета меняются, контроль
     * вдвое короче), armageddon — решающая, где чёрным достаточно ничьей.
     */
    stage: 'main' | 'rematch' | 'armageddon';
    white_seat: number;
    black_seat: number;
    base_time_ms: number;
    increment_ms: number;
    /** null — партия ещё не сыграна. */
    result: '1-0' | '0-1' | '1/2-1/2' | null;
    /** Сохранённая партия (таблица games) — для просмотра; null — её нет. */
    game_id: number | null;
}

/**
 * Строка таблицы. Места в круговом турнире: очки, затем личная встреча среди набравших поровну, затем коэффициент
 * Зоннеборна–Бергера, затем посев; buchholz приходит только в швейцарке.
 */
export interface Standing {
    seat: number;
    points: number;
    head_to_head: number;
    sonneborn_berger: number;
    buchholz?: number;
    place: number;
}

/** Турнир целиком (GET /tournaments/{id}): участники, расписание с результатами и таблица. */
export interface Tournament {
    id: number;
    format: TournamentFormat;
    size: number;
    status: 'active' | 'finished';
    base_time_ms: number;
    increment_ms: number;
    current_round: number;
    created_at: string;
    finished_at: string | null;
    /** Номер самого игрока среди участников. */
    my_seat: number | null;
    /** Игрок сдал турнир: боты доигрывают, сам он больше не играет. */
    withdrawn: boolean;
    /** «Машина времени»: ключ знаменитого турнира; у обычного турнира его нет. */
    event_key?: string | null;
    players: TournamentPlayer[];
    games: TournamentGame[];
    standings: Standing[];
}

/** Турнир в списке игрока (GET /tournaments, новые первыми). */
export interface TournamentSummary {
    id: number;
    format: TournamentFormat;
    size: number;
    status: 'active' | 'finished';
    created_at: string;
    my_place: number | null;
    /** Ключ этапа карьеры, если турнир начат из неё. */
    career_stage?: string | null;
    event_key?: string | null;
    /** Текущий тур и готова ли в нём партия игрока («Продолжить турнир» на главной). */
    current_round: number;
    my_game_ready: boolean;
}

/** Тело создания турнира (POST /tournaments). size — число участников вместе с игроком (от 4 до 8). */
export interface TournamentCreate {
    format: TournamentFormat;
    size: number;
    participants: { kind: ParticipantKind; id: string | number }[];
    /** Случайные соперники из диапазона силы (таск 15.4) вместо выбранных. */
    random?: RandomOpponents;
    base_time_ms: number;
    increment_ms: number;
}

/** Партия турнира, которую игрок запускает на главной доске (передаётся через location.state). */
export interface TournamentGameStart {
    tournamentId: number;
    gameId: number;
    color: 'white' | 'black';
    baseTimeMs: number;
    incrementMs: number;
    /** Исторический бот — по id; соперник из мастерской — именем и характером. */
    botId: string | null;
    custom: CustomOpponent | null;
}

const BASE = '/tournaments';

/** Запрос к API турниров (общий apiRequest); отказ без кода сервера — запасное сообщение fallback. */
const call = <T>(path: string, init: RequestInit, fallback: MessageKey) => apiRequest<T>(path, init, fallback);

/** Допустимые размеры турнира по форматам — GET /tournaments/formats (источник правды — сервер). */
export const getFormatSizes = () =>
    call<Record<TournamentFormat, number[]>>(`${BASE}/formats`, {method: 'GET'}, 'tournaments.loadFailed');

export const listTournaments = () => call<TournamentSummary[]>(BASE, {method: 'GET'}, 'tournaments.loadFailed');
export const getTournament = (id: number) => call<Tournament>(`${BASE}/${id}`, {method: 'GET'}, 'tournaments.loadFailed');
/** Начать свою партию (таск A.2): повторный старт уже начатой партии — поражение, forfeited = true. */
export const startMyGame = (tournamentId: number, gameId: number) =>
    call<{ forfeited: boolean; game: TournamentGame }>(
        `${BASE}/${tournamentId}/games/${gameId}/start`, {method: 'POST'}, 'tournaments.loadFailed',
    );

/** Сдать турнир (таск A.3): оставшиеся партии игрока — поражения. */
export const withdrawTournament = (tournamentId: number) =>
    call<Tournament>(`${BASE}/${tournamentId}/withdraw`, {method: 'POST'}, 'tournaments.loadFailed');

/** Случайные соперники: около силы игрока, сильнее или слабее — подбирает сервер. */
export type RandomOpponents = 'my_level' | 'stronger' | 'weaker';

/** Этап карьеры (таск 15.4); у скрытого приглашения подробностей нет. */
export interface CareerStage {
    key: string;
    number: number;
    invitational: boolean;
    hidden: boolean;
    unlocked: boolean;
    best_place: number | null;
    format?: TournamentFormat;
    size?: number;
    base_time_ms?: number;
    increment_ms?: number;
    target?: number;
    opponents?: { kind: ParticipantKind; id: string | number }[];
}

/** Карьера: этапы лестницы готовых турниров (src/services/tournament_career.py). */
export const getCareer = () => call<{ stages: CareerStage[] }>(`${BASE}/career`, {method: 'GET'}, 'tournaments.loadFailed');
/** Начать турнир этапа карьеры; закрытый этап сервер не начнёт (403). */
export const startCareerStage = (key: string) =>
    call<Tournament>(`${BASE}/career/${encodeURIComponent(key)}`, {method: 'POST'}, 'tournaments.createFailed');

/** Создать свой турнир; партии ботов первого тура сервер сразу ставит в очередь симуляции. */
export const createTournament = (body: TournamentCreate) =>
    call<Tournament>(BASE, {method: 'POST', body: JSON.stringify(body)}, 'tournaments.createFailed');

/** id мастера прошлого («Машина времени»), если участник — он; в турнире такой участник — персоналия с ключом. */
export function guestIdOf(player: Pick<TournamentPlayer, 'kind' | 'bot_key'>): string | null {
    return player.kind === 'personality' && player.bot_key?.startsWith(GUEST_PREFIX)
        ? player.bot_key.slice(GUEST_PREFIX.length) : null;
}

/** Страница соперника: мастер прошлого — его карточка в каталоге; у остальных отдельной страницы нет. */
export function opponentPage(player: Pick<TournamentPlayer, 'kind' | 'bot_key'>): string | null {
    const guest = guestIdOf(player);
    return guest ? `/masters?master=${encodeURIComponent(guest)}` : null;
}

/** Последняя сыгранная партия игрока в турнире. */
export function myLastGame(t: Tournament): TournamentGame | null {
    if (t.my_seat == null) return null;
    const mine = t.games.filter((g) => g.result && (g.white_seat === t.my_seat || g.black_seat === t.my_seat));
    return mine.sort((a, b) => b.round - a.round || b.id - a.id)[0] ?? null;
}

/** Имя участника на языке игрока: «Вы», бот, архетип, мастер прошлого или имя персоналии. */
export function participantName(player: TournamentPlayer, t: I18n['t'], myName?: string): string {
    if (player.kind === 'user') return myName || t('tournaments.you');
    const guest = guestIdOf(player);
    if (guest) return guestShortName(guest, t);
    if (player.kind === 'bot' && player.bot_key) return ladderOpponentName('historical', player.bot_key, t);
    if (player.kind === 'archetype' && player.bot_key) {
        return ladderOpponentName('archetype', player.bot_key.slice(ARCHETYPE_PREFIX.length), t);
    }
    return player.personality_name ?? '?';
}

/** Партия игрока, которую можно играть сейчас: текущий круг, без результата. */
export function myPendingGame(t: Tournament): TournamentGame | null {
    if (t.status !== 'active' || t.my_seat == null || t.withdrawn) return null;
    const mine = t.games.filter((g) => g.result === null && g.round === t.current_round
        && (g.white_seat === t.my_seat || g.black_seat === t.my_seat));
    return mine[0] ?? null;
}

/** Что передать главной доске, чтобы начать партию турнира. */
export function gameStart(t: Tournament, game: TournamentGame, name: string): TournamentGameStart {
    const color = game.white_seat === t.my_seat ? 'white' : 'black';
    const opponent = t.players.find((p) => p.seat === (color === 'white' ? game.black_seat : game.white_seat))!;
    const archetypeId = opponent.kind === 'archetype' && opponent.bot_key
        ? opponent.bot_key.slice(ARCHETYPE_PREFIX.length) : null;
    // Мастер прошлого: на доске — имя на языке игрока, сохраняется партия под именем из турнира.
    const guest = guestIdOf(opponent) !== null;
    const custom: CustomOpponent | null = opponent.kind === 'bot' || !opponent.config ? null : {
        name: guest ? name : opponent.personality_name ?? name,
        ...(guest && opponent.personality_name ? {savedName: opponent.personality_name} : {}),
        config: opponent.config,
        ...(isArchetypeId(archetypeId) ? {archetypeId} : {}),
    };
    return {
        tournamentId: t.id, gameId: game.id, color, baseTimeMs: game.base_time_ms, incrementMs: game.increment_ms,
        botId: opponent.kind === 'bot' ? opponent.bot_key : null, custom,
    };
}

/**
 * Сколько всего туров: в швейцарке — по таблице SWISS_ROUNDS, в круговом — по расписанию, на выбывание — число
 * кругов сетки (log2 от размера, вверх). У больших исторических турниров размер и число кругов любые, поэтому
 * там, где можно, число берётся из самих партий расписания.
 */
export function totalRounds(t: Tournament): number {
    if (t.format === 'swiss') return SWISS_ROUNDS[t.size] ?? Math.max(1, ...t.games.map((g) => g.round));
    // Один круг — на тур меньше числа участников (при нечётном числе — столько же); расписание в несколько кругов
    // создаётся целиком, и последний тур виден по партиям.
    if (t.format === 'round_robin') return Math.max(t.size % 2 === 0 ? t.size - 1 : t.size, ...t.games.map((g) => g.round));
    return Math.max(1, Math.ceil(Math.log2(t.size)));
}

/** Есть ли партии ботов, которые сейчас считает сервер (страница обновляет состояние, пока они идут). */
export function botGamesRunning(t: Tournament): boolean {
    if (t.status !== 'active') return false;
    return t.games.some((g) => g.result === null && g.round === t.current_round
        && g.white_seat !== t.my_seat && g.black_seat !== t.my_seat);
}
