// --- FILE: frontend/src/services/tournaments.ts ---
// Турниры с историческими мастерами (таски 15.1–15.3): API и подписи участников на языке игрока.

import {API_BASE_URL} from '../config/api';
import {UiError, readApiErrorOr} from './apiErrors';
import type {PersonalityConfig} from './personalities';
import {ARCHETYPE_PREFIX, isArchetypeId} from '../config/archetypes';
import type {CustomOpponent} from '../config/archetypes';
import {ladderOpponentName} from '../config/players';
import type {I18n, MessageKey} from '../i18n';

export type TournamentFormat = 'round_robin' | 'knockout';
export type ParticipantKind = 'bot' | 'archetype' | 'personality';

export interface TournamentPlayer {
    seat: number;
    kind: 'user' | ParticipantKind;
    user_id: number | null;
    bot_key: string | null;
    personality_name: string | null;
    rating: number;
    place: number | null;
    eliminated_round: number | null;
    config: PersonalityConfig | null;
}

export interface TournamentGame {
    id: number;
    round: number;
    board: number;
    stage: 'main' | 'rematch' | 'armageddon';
    white_seat: number;
    black_seat: number;
    base_time_ms: number;
    increment_ms: number;
    result: '1-0' | '0-1' | '1/2-1/2' | null;
    game_id: number | null;
}

export interface Standing {
    seat: number;
    points: number;
    head_to_head: number;
    sonneborn_berger: number;
    place: number;
}

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
    my_seat: number | null;
    /** Игрок сдал турнир: боты доигрывают, сам он больше не играет. */
    withdrawn: boolean;
    players: TournamentPlayer[];
    games: TournamentGame[];
    standings: Standing[];
}

export interface TournamentSummary {
    id: number;
    format: TournamentFormat;
    size: number;
    status: 'active' | 'finished';
    created_at: string;
    my_place: number | null;
}

export interface TournamentCreate {
    format: TournamentFormat;
    size: number;
    participants: { kind: ParticipantKind; id: string | number }[];
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

const BASE = `${API_BASE_URL}/api/v1/tournaments`;

async function call<T>(url: string, init: RequestInit, fallback: MessageKey): Promise<T> {
    const token = localStorage.getItem('token');
    const res = await fetch(url, {
        ...init,
        headers: {
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
            ...(init.body ? {'Content-Type': 'application/json'} : {}),
        },
    });
    if (!res.ok) throw new UiError(await readApiErrorOr(res, fallback));
    return res.json() as Promise<T>;
}

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

export const createTournament = (body: TournamentCreate) =>
    call<Tournament>(BASE, {method: 'POST', body: JSON.stringify(body)}, 'tournaments.createFailed');

/** Имя участника на языке игрока: «Вы», бот, архетип или имя персоналии. */
export function participantName(player: TournamentPlayer, t: I18n['t'], myName?: string): string {
    if (player.kind === 'user') return myName || t('tournaments.you');
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
    const custom: CustomOpponent | null = opponent.kind === 'bot' || !opponent.config ? null : {
        name: opponent.personality_name ?? name,
        config: opponent.config,
        ...(isArchetypeId(archetypeId) ? {archetypeId} : {}),
    };
    return {
        tournamentId: t.id, gameId: game.id, color, baseTimeMs: game.base_time_ms, incrementMs: game.increment_ms,
        botId: opponent.kind === 'bot' ? opponent.bot_key : null, custom,
    };
}

/** Есть ли партии ботов, которые сейчас считает сервер (страница обновляет состояние, пока они идут). */
export function botGamesRunning(t: Tournament): boolean {
    if (t.status !== 'active') return false;
    return t.games.some((g) => g.result === null && g.round === t.current_round
        && g.white_seat !== t.my_seat && g.black_seat !== t.my_seat);
}
