// --- FILE: frontend/src/services/teams.ts ---
// Команды и сезонная лига (таск 17.2).
// Все запросы — к /api/v1/teams (маршруты src/api/teams.py, правила очков — src/services/league.py). Сезон —
// календарный месяц (UTC). Очки нигде не хранятся: сервер считает их при запросе по законченным рейтинговым
// партиям сезона между игроками разных команд. Игрок состоит не больше чем в одной команде.

import {apiRequest} from './http';

/** Строка таблицы лиги: команда, число участников, очки за сезон и место. */
export interface LeagueRow {
    id: number;
    name: string;
    members: number;
    points: number;
    place: number;
}

/** Таблица лиги за сезон («ГГГГ-ММ»). */
export interface LeagueTable {
    season: string;
    teams: LeagueRow[];
}

/** Команда: очки за сезон и вклад каждого участника; owner — создатель команды. */
export interface TeamView {
    id: number;
    name: string;
    season: string;
    points: number;
    members: { username: string; points: number; owner: boolean }[];
}

/** Запрос к /api/v1/teams через общую обёртку http.ts (токен, JSON, ошибки). */
const call = <T>(path: string, init: RequestInit = {}) => apiRequest<T>(`/teams${path}`, init);

/** Эндпоинты команд. Таблица лиги открыта без входа; своя команда, создание, вступление и выход — с входом. */
export const teamsApi = {
    /** Таблица текущего сезона (сервер умеет и прошлые — параметром season, клиент его не передаёт). */
    league: () => call<LeagueTable>('/league'),
    /** Команда игрока; team = null — он ни в одной не состоит. */
    mine: () => call<{ team: TeamView | null }>('/mine'),
    create: (name: string) => call<TeamView>('', {method: 'POST', body: JSON.stringify({name})}),
    join: (id: number) => call<TeamView>(`/${id}/join`, {method: 'POST'}),
    leave: () => call<{ team: null }>('/leave', {method: 'POST'}),
};
