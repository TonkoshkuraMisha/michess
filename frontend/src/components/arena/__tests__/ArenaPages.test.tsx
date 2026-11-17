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

describe('швейцарка между людьми', () => {
    it('название с турами, «тур N из M», кнопки «Играть» нет — партия откроется сама', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({
            ...RUNNING, format: 'swiss', rounds: 5, current_round: 2, standings: [],
            me: {joined: true, waiting: false, current_game_id: null},
        })} as Response)));
        routes('/arenas/3');
        expect(await screen.findByText('Швейцарка 3+2, 5 туров')).toBeInTheDocument();
        expect(screen.getByTestId('arena-timing')).toHaveTextContent('тур 2 из 5');
        expect(screen.queryByTestId('arena-play')).toBeNull();
        expect(screen.getByTestId('swiss-waiting')).toBeInTheDocument();
    });
});

describe('честный конец арены (33.1)', () => {
    it('до последнего старта — отсчёт; после — доигрывание и без кнопки «Играть»; перформанс в таблице', async () => {
        const lastStart = new Date(Date.now() + 10 * 60_000).toISOString();
        const standings = [{place: 1, username: 'misha', score: 4, games: 2, wins: 2, fire: true, rating: 1500, performance: 1900}];
        let current: Record<string, unknown> = {...RUNNING, last_start_at: lastStart, open_games: 0, standings,
            me: {joined: true, waiting: false, current_game_id: null}};
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => current} as Response)));
        const view = routes('/arenas/3');
        expect(await screen.findByTestId('arena-timing')).toHaveTextContent('последний старт через 10:0');
        expect(screen.getByTestId('arena-play')).toBeInTheDocument();
        expect(screen.getByTestId('arena-perf-misha')).toHaveTextContent('1900');
        view.unmount();

        current = {...current, status: 'closing', open_games: 2};
        routes('/arenas/3');
        expect(await screen.findByTestId('arena-timing')).toHaveTextContent('доигрываются партии: 2');
        expect(screen.getByTestId('arena-closing')).toBeInTheDocument();
        expect(screen.queryByTestId('arena-play')).toBeNull();
    });
});
