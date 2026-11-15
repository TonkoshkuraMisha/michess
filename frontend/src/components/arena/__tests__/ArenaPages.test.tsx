// Арены (таск 17.2): список, вход, поиск пары с повтором и переход на доску, таблица с «огнём», анонс в лобби.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {clock, controlLabel, secondsUntil} from '../../../services/arenas';
import {ArenaBanner, ArenaPage, ArenasPage, WAIT_POLL_MS} from '../ArenaPages';

const SOON = new Date(Date.now() + 40 * 60_000).toISOString();
const RUNNING = {id: 3, schedule_key: 'blitz-3+2', base_time_ms: 180000, increment_ms: 2000, starts_at: new Date().toISOString(),
    ends_at: SOON, status: 'running'};

function Probe() {
    const location = useLocation();
    return <pre data-testid="probe">{location.pathname}</pre>;
}

function routes(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/arenas" element={<ArenasPage/>}/>
                <Route path="/arenas/:arenaId" element={<ArenaPage/>}/>
                <Route path="/" element={<Probe/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    setToken('jwt');
    vi.useFakeTimers({shouldAdvanceTime: true});
});
afterEach(() => {
    setToken(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('арены', () => {
    it('время и контроль', () => {
        expect(controlLabel({base_time_ms: 180000, increment_ms: 2000})).toBe('3+2');
        expect(clock(125)).toBe('2:05');
        expect(clock(3725)).toBe('1:02:05');
        expect(secondsUntil(new Date(1000).toISOString(), 5000)).toBe(0);
    });

    it('список арен', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({arenas: [{...RUNNING, players: 12}]})} as Response)));
        routes('/arenas');
        expect(await screen.findByTestId('arena-3')).toHaveTextContent('Арена 3+2');
        expect(screen.getByTestId('arena-3')).toHaveTextContent('игроков: 12');
    });

    it('вход, поиск с повтором и переход на доску, когда партия создана', async () => {
        let joined = false;
        let readyCalls = 0;
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            let body: unknown;
            if (u.endsWith('/join')) {
                joined = true;
                body = {joined: true};
            } else if (u.endsWith('/ready')) {
                readyCalls += 1;
                body = readyCalls < 2 ? {waiting: true} : {game_id: 77};
            } else {
                body = {...RUNNING, standings: [{place: 1, username: 'magnus', score: 6, games: 3, wins: 3, fire: true, rating: 2800}],
                    me: {joined, waiting: false, current_game_id: null}};
            }
            return {ok: true, status: 200, json: async () => body, method: init?.method} as unknown as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        routes('/arenas/3');
        expect(await screen.findByTestId('arena-standings')).toHaveTextContent('magnus');
        expect(screen.getByLabelText('Огонь: очки удваиваются')).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByTestId('arena-join')));
        fireEvent.click(await screen.findByTestId('arena-play'));
        expect(await screen.findByTestId('arena-searching')).toBeInTheDocument();
        await act(async () => {
            vi.advanceTimersByTime(WAIT_POLL_MS + 100);
        });
        expect(await screen.findByTestId('probe')).toHaveTextContent('/');
        expect(readyCalls).toBeGreaterThanOrEqual(2);
    });

    it('анонс в лобби', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({arena: RUNNING})} as Response)));
        render(<MemoryRouter><ArenaBanner/></MemoryRouter>);
        expect(await screen.findByTestId('arena-banner')).toHaveAttribute('href', '/arenas/3');
    });
});
