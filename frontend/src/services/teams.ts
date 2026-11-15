// --- FILE: frontend/src/services/teams.ts ---
// Команды и сезонная лига (таск 17.2).

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export interface LeagueRow {
    id: number;
    name: string;
    members: number;
    points: number;
    place: number;
}

export interface LeagueTable {
    season: string;
    teams: LeagueRow[];
}

export interface TeamView {
    id: number;
    name: string;
    season: string;
    points: number;
    members: { username: string; points: number; owner: boolean }[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/teams${path}`, {
            ...init,
            headers: {
                ...(init.body ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

export const teamsApi = {
    league: () => call<LeagueTable>('/league'),
    mine: () => call<{ team: TeamView | null }>('/mine'),
    create: (name: string) => call<TeamView>('', {method: 'POST', body: JSON.stringify({name})}),
    join: (id: number) => call<TeamView>(`/${id}/join`, {method: 'POST'}),
    leave: () => call<{ team: null }>('/leave', {method: 'POST'}),
};
