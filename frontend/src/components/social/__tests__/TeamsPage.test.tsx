// Команды и лига (таск 17.2): таблица, создание команды, своя команда и выход.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {TeamsPage} from '../TeamsPage';

const LEAGUE = {season: '2026-11', teams: [{id: 1, name: 'Pawn Storm', members: 3, points: 9, place: 1}]};
const MINE = {id: 2, name: 'Kings of Rook', season: '2026-11', points: 6,
    members: [{username: 'player1', points: 6, owner: true}]};

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('команды', () => {
    it('без команды: таблица с «Вступить» и создание команды', async () => {
        let team: unknown = null;
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (init?.method === 'POST') team = MINE;
            const body = u.endsWith('/league') ? LEAGUE : u.endsWith('/mine') ? {team} : MINE;
            return {ok: true, status: 200, json: async () => body} as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        render(<MemoryRouter><TeamsPage/></MemoryRouter>);
        expect(await screen.findByTestId('league-table')).toHaveTextContent('Pawn Storm');
        expect(screen.getByText('Лига, сезон 2026-11')).toBeInTheDocument();
        expect(screen.getByTestId('join-1')).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('team-name'), {target: {value: 'Kings of Rook'}});
        await act(async () => fireEvent.submit(screen.getByTestId('team-create')));
        const post = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([, i]) => i?.method === 'POST')!;
        expect(JSON.parse(String(post[1].body))).toEqual({name: 'Kings of Rook'});
        expect(await screen.findByTestId('my-team')).toHaveTextContent('капитан');
        expect(screen.queryByTestId('join-1')).toBeNull();
    });
});
