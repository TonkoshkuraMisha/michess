// Навигация турнира: плашка над партией, «Следующая партия» и ожидание тура, «Продолжить турнир» на главной,
// «Ваша последняя партия» на странице турнира, карточка соперника — мастера прошлого.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {ContinueTournaments, TournamentGameBar} from '../TournamentGameBar';
import {TournamentView} from '../TournamentsPage';

const player = (seat: number, kind: string, extra: Record<string, unknown> = {}) => ({
    seat, kind, user_id: kind === 'user' ? 1 : null, bot_key: null, personality_name: null, rating: 1500, place: null,
    eliminated_round: null, config: null, ...extra,
});
const game = (id: number, round: number, white: number, black: number, result: string | null, gameId: number | null = null) => ({
    id, round, board: 1, stage: 'main', white_seat: white, black_seat: black, base_time_ms: 300000, increment_ms: 0, result,
    game_id: gameId,
});

function tournament(games: ReturnType<typeof game>[], currentRound: number, extra: Record<string, unknown> = {}) {
    return {
        id: 7, format: 'round_robin', size: 4, status: 'active', base_time_ms: 300000, increment_ms: 0,
        current_round: currentRound, created_at: '2026-11-17T10:00:00Z', finished_at: null, my_seat: 1, withdrawn: false,
        event_key: 'kyiv_1903',
        players: [player(1, 'user'), player(2, 'personality', {bot_key: 'guest:bernstein', personality_name: 'Bernstein',
            config: {}}), player(3, 'bot', {bot_key: 'morphy'}), player(4, 'bot', {bot_key: 'philidor'})],
        games,
        standings: [1, 2, 3, 4].map((seat) => ({seat, points: seat === 2 ? 1 : 0, head_to_head: 0, sonneborn_berger: 0, place: seat})),
        ...extra,
    };
}

function Probe() {
    const location = useLocation();
    return <pre data-testid="probe">{location.pathname}{location.search}{JSON.stringify(location.state)}</pre>;
}

function stub(routes: Record<string, () => unknown>) {
    const fetchMock = vi.fn(async (url: string) => {
        const key = Object.keys(routes).find((part) => String(url).includes(part));
        return {ok: Boolean(key), status: key ? 200 : 404, json: async () => (key ? routes[key]() : {})} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('плашка турнирной партии', () => {
    it('во время партии: турнир, тур, соперник и таблица поверх доски', async () => {
        stub({'/tournaments/7': () => tournament([game(31, 1, 1, 2, null)], 1)});
        render(<MemoryRouter><TournamentGameBar tournamentId={7} tournamentGameId={31} gameOver={false}/></MemoryRouter>);
        const bar = await screen.findByTestId('tournament-bar');
        expect(bar).toHaveTextContent('Тур 1 из 3');
        expect(screen.getByTestId('tournament-bar-opponent')).toHaveTextContent('против');
        expect(screen.queryByTestId('tournament-bar-after')).toBeNull();
        fireEvent.click(screen.getByTestId('tournament-bar-table'));
        expect(screen.getByTestId('tournament-standings-overlay').querySelectorAll('tr')).toHaveLength(4);
    });

    it('после партии: ждёт тур, затем «Следующая партия» запускает её на доске', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        let round = 1;
        const fetchMock = stub({
            '/games/41/start': () => ({forfeited: false, game: game(41, 2, 3, 1, null)}),
            '/tournaments/7': () => (round === 1
                ? tournament([game(31, 1, 1, 2, '1-0'), game(32, 1, 3, 4, null)], 1)
                : tournament([game(31, 1, 1, 2, '1-0'), game(32, 1, 3, 4, '1/2-1/2'), game(41, 2, 3, 1, null)], 2)),
        });
        render(<MemoryRouter initialEntries={['/x']}><Routes>
            <Route path="/x" element={<TournamentGameBar tournamentId={7} tournamentGameId={31} gameOver/>}/>
            <Route path="*" element={<Probe/>}/>
        </Routes></MemoryRouter>);
        expect(await screen.findByTestId('tournament-bar-waiting')).toBeInTheDocument();
        expect(screen.getByTestId('back-to-tournament')).toHaveAttribute('href', '/tournaments/7');
        expect(screen.getByTestId('tournament-bar-opponent-card')).toHaveAttribute('href', '/masters?master=bernstein');

        round = 2;
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3100);
        });
        const next = await screen.findByTestId('tournament-next-game');
        await act(async () => fireEvent.click(next));
        expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/tournaments/7/games/41/start'))).toBe(true);
        const probe = screen.getByTestId('probe').textContent ?? '';
        expect(probe.startsWith('/')).toBe(true);
        expect(probe).toContain('"tournamentGame"');
        expect(probe).toContain('"gameId":41');
        expect(probe).toContain('"color":"black"');
    });
});

describe('путь назад в турнир', () => {
    it('главная: турниры, где ждут партию игрока', async () => {
        stub({'/tournaments': () => [
            {id: 7, format: 'round_robin', size: 12, status: 'active', created_at: '', my_place: null, event_key: 'kyiv_1903',
                current_round: 4, my_game_ready: true},
            {id: 8, format: 'swiss', size: 8, status: 'active', created_at: '', my_place: null, current_round: 2,
                my_game_ready: false},
            {id: 9, format: 'knockout', size: 8, status: 'finished', created_at: '', my_place: 1, current_round: 3,
                my_game_ready: false},
        ]});
        render(<MemoryRouter><ContinueTournaments/></MemoryRouter>);
        const card = await screen.findByTestId('continue-tournament-7');
        expect(card).toHaveAttribute('href', '/tournaments/7');
        expect(card).toHaveTextContent('тур 4: ваша партия готова');
        expect(screen.queryByTestId('continue-tournament-8')).toBeNull();
    });

    it('страница турнира: последняя партия — разбор и карточка соперника', async () => {
        stub({
            '/profile/me': () => ({username: 'misha'}),
            '/tournaments/7': () => tournament([game(31, 1, 1, 2, '0-1', 555), game(32, 1, 3, 4, '1-0')], 2),
        });
        render(<MemoryRouter initialEntries={['/tournaments/7']}><Routes>
            <Route path="/tournaments/:tournamentId" element={<TournamentView/>}/>
        </Routes></MemoryRouter>);
        const card = await screen.findByTestId('my-last-game');
        expect(card).toHaveTextContent('тур 1');
        expect(card).toHaveTextContent(': 0');
        expect(screen.getByTestId('my-last-game-review')).toHaveAttribute('href', '/game/555');
        await waitFor(() => expect(screen.getByTestId('my-last-game-opponent')).toHaveAttribute('href', '/masters?master=bernstein'));
    });
});
