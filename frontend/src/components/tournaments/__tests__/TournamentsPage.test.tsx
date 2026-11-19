// Турниры (таск 15.3): создание, таблица кругового турнира, сетка, «Играть мою партию», диплом, обновление.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setLanguage} from '../../../i18n';
import {resetBotCatalogCache} from '../../../services/botCatalog';
import {DEFAULT_CONFIG} from '../../../services/personalities';
import {TournamentView, TournamentsPage} from '../TournamentsPage';
import type {Tournament} from '../../../services/tournaments';
import {setToken} from '../../../services/authToken';

const players = [
    {seat: 1, kind: 'bot', bot_key: 'morphy', user_id: null, personality_name: null, rating: 2150, place: null, eliminated_round: null, config: null},
    {seat: 2, kind: 'archetype', bot_key: 'archetype:combinator', user_id: null, personality_name: null, rating: 2200, place: null,
        eliminated_round: null, config: {...DEFAULT_CONFIG, target_elo: 2200}},
    {seat: 3, kind: 'bot', bot_key: 'philidor', user_id: null, personality_name: null, rating: 1850, place: null, eliminated_round: null, config: null},
    {seat: 4, kind: 'user', bot_key: null, user_id: 1, personality_name: null, rating: 1200, place: null, eliminated_round: null, config: null},
] as Tournament['players'];

const game = (id: number, round: number, board: number, white: number, black: number, result: string | null = null, extra = {}) => ({
    id, round, board, stage: 'main', white_seat: white, black_seat: black, base_time_ms: 300000, increment_ms: 2000,
    result, game_id: result ? id + 100 : null, ...extra,
});

function roundRobin(overrides: Partial<Tournament> = {}): Tournament {
    return {
        id: 7, format: 'round_robin', size: 4, status: 'active', base_time_ms: 300000, increment_ms: 2000, current_round: 1,
        created_at: '2026-11-13T10:00:00Z', finished_at: null, my_seat: 4, withdrawn: false, players,
        games: [game(1, 1, 1, 1, 4), game(2, 1, 2, 2, 3, '1-0'), game(3, 2, 1, 4, 3), game(4, 2, 2, 1, 2)] as Tournament['games'],
        standings: [
            {seat: 2, points: 1, head_to_head: 0, sonneborn_berger: 0, place: 1},
            {seat: 1, points: 0, head_to_head: 0, sonneborn_berger: 0, place: 2},
            {seat: 4, points: 0, head_to_head: 0, sonneborn_berger: 0, place: 3},
            {seat: 3, points: 0, head_to_head: 0, sonneborn_berger: 0, place: 4},
        ],
        ...overrides,
    };
}

function stub(routes: Record<string, (init?: RequestInit) => unknown>) {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        const key = Object.keys(routes).find((k) => url.endsWith(k));
        return {ok: Boolean(key), status: key ? 200 : 404, json: async () => (key ? routes[key](init) : {})} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function LocationProbe() {
    const location = useLocation();
    return <pre data-testid="location">{JSON.stringify(location.state)}</pre>;
}

function renderView(path = '/tournaments/7') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/tournaments/:tournamentId" element={<TournamentView/>}/>
                <Route path="/" element={<LocationProbe/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    setLanguage('en', {persist: false});
    resetBotCatalogCache();
    setToken('jwt');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('список турниров (раскладка на общих компонентах, план владельца 18.11)', () => {
    it('арены и машина времени — карточки; мои турниры — место или статус; пустой список — пустое состояние', async () => {
        stub({
            '/tournaments': () => [
                {id: 3, format: 'round_robin', size: 6, status: 'finished', my_place: 1},
                {id: 4, format: 'swiss', size: 8, status: 'running', my_place: null},
            ],
            '/bots/catalog': () => ({calibration: null, historical: [], archetypes: []}),
            '/bots/personalities': () => [],
        });
        render(<MemoryRouter><TournamentsPage/></MemoryRouter>);
        expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Tournaments');
        expect(screen.getByTestId('arenas-link')).toHaveAttribute('href', '/arenas');
        expect(screen.getByTestId('arenas-link')).toHaveTextContent('Arenas');
        expect(screen.getByTestId('time-machine-link')).toHaveAttribute('href', '/time-machine');
        const mine = screen.getByTestId('my-tournaments');
        await waitFor(() => expect(mine.querySelectorAll('a')).toHaveLength(2));
        expect(mine.querySelector('a[href="/tournaments/3"]')).toHaveTextContent('1');
    });

    it('без турниров — пустое состояние', async () => {
        stub({'/tournaments': () => [], '/bots/catalog': () => ({calibration: null, historical: [], archetypes: []}), '/bots/personalities': () => []});
        render(<MemoryRouter><TournamentsPage/></MemoryRouter>);
        expect(await screen.findByText('No tournaments yet.')).toBeInTheDocument();
    });
});

describe('создание турнира', () => {
    it('выбор соперников по размеру турнира и отправка', async () => {
        const fetchMock = stub({
            '/tournaments': (init) => (init?.method === 'POST' ? {id: 9} : []),
            '/bots/catalog': () => ({calibration: null, historical: [], archetypes: []}),
            '/bots/personalities': () => [],
        });
        render(<MemoryRouter><Routes><Route path="/" element={<TournamentsPage/>}/><Route path="/tournaments/:tournamentId" element={<p>opened</p>}/></Routes></MemoryRouter>);

        expect(await screen.findByText('No tournaments yet.')).toBeInTheDocument();
        expect(screen.getByTestId('opponents-needed')).toHaveTextContent('Choose 3 opponents (0/3)');
        const create = screen.getByRole('button', {name: 'Create tournament'});
        expect(create).toBeDisabled();
        for (const bot of ['Morphy', 'Philidor', 'Staunton', 'Anderssen']) {
            fireEvent.click(screen.getByRole('button', {name: new RegExp(`^${bot}`)}));
        }
        expect(screen.getByTestId('opponents-needed')).toHaveTextContent('(3/3)');  // четвёртый не добавился
        await act(async () => fireEvent.click(create));

        const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
        const body = JSON.parse(String(post[1]!.body));
        expect(body.format).toBe('round_robin');
        expect(body.participants).toEqual([{kind: 'bot', id: 'morphy'}, {kind: 'bot', id: 'philidor'}, {kind: 'bot', id: 'staunton'}]);
        expect(await screen.findByText('opened')).toBeInTheDocument();
    });

    it('размеры турнира — с сервера: у швейцарки только 6 и 8', async () => {
        stub({
            '/tournaments/formats': () => ({round_robin: [4, 6, 8], knockout: [4, 8], swiss: [6, 8]}),
            '/tournaments': () => [],
            '/bots/catalog': () => ({calibration: null, historical: [], archetypes: []}),
            '/bots/personalities': () => [],
        });
        render(<MemoryRouter><TournamentsPage/></MemoryRouter>);
        expect(await screen.findByText('No tournaments yet.')).toBeInTheDocument();
        const [formatSelect, sizeSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
        await waitFor(() => expect(Array.from(sizeSelect.options, (o) => o.value)).toEqual(['4', '6', '8']));
        fireEvent.change(formatSelect, {target: {value: 'swiss'}});
        expect(Array.from(sizeSelect.options, (o) => o.value)).toEqual(['6', '8']);
        expect(sizeSelect.value).toBe('6');  // 4 у швейцарки нет — размер сменился на первый допустимый
        expect(screen.getByTestId('opponents-needed')).toHaveTextContent('(0/5)');
    });

    it('сила соперников — как в посеве: измеренная с пометкой, без замера — заявленная', async () => {
        stub({
            '/tournaments': () => [],
            '/bots/catalog': () => ({
                calibration: {date: '2026-11-14', games: 400},
                historical: [{id: 'morphy', declared_rating: 2150, rating: 2234, measured: true, games: 80, ci95: 90}],
                archetypes: [],
            }),
            '/bots/personalities': () => [],
        });
        render(<MemoryRouter><TournamentsPage/></MemoryRouter>);

        expect(await screen.findByRole('button', {name: /^Morphy/})).toHaveTextContent('2234 (meas.)');
        expect(screen.getByRole('button', {name: /^Philidor/})).not.toHaveTextContent('meas.');
    });
});

describe('турнир', () => {
    it('таблица кругового турнира и запуск своей партии на главной доске', async () => {
        stub({
            '/tournaments/7': () => roundRobin(), '/profile/me': () => ({username: 'Alice'}),
            '/games/1/start': () => ({forfeited: false, game: game(1, 1, 1, 1, 4)}),
        });
        renderView();

        expect(await screen.findByTestId('crosstable')).toBeInTheDocument();
        expect(screen.getByTestId('tournament-status')).toHaveTextContent('Round 1 of 3');
        expect(screen.getByText('Your game decides the round.')).toBeInTheDocument();
        expect(screen.getAllByRole('link', {name: 'Game'})[0]).toHaveAttribute('href', '/game/102');

        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Play my game'})));
        const state = JSON.parse((await screen.findByTestId('location')).textContent!);
        expect(state.tournamentGame).toMatchObject({
            tournamentId: 7, gameId: 1, color: 'black', baseTimeMs: 300000, incrementMs: 2000, botId: 'morphy', custom: null,
        });
    });

    it('соперник из мастерской передаётся характером и архетипом', async () => {
        const t = roundRobin({games: [game(1, 1, 1, 4, 2), game(2, 1, 2, 1, 3)] as Tournament['games']});
        stub({'/tournaments/7': () => t, '/profile/me': () => ({username: 'Alice'}), '/games/1/start': () => ({forfeited: false})});
        renderView();
        const play = await screen.findByRole('button', {name: 'Play my game'});
        await act(async () => fireEvent.click(play));
        const state = JSON.parse((await screen.findByTestId('location')).textContent!);
        expect(state.tournamentGame.color).toBe('white');
        expect(state.tournamentGame.custom).toMatchObject({archetypeId: 'combinator', config: {target_elo: 2200}});
    });

    it('пока боты играют — страница обновляется сама', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        const running = roundRobin({games: [game(1, 1, 1, 1, 4, '0-1'), game(2, 1, 2, 2, 3)] as Tournament['games']});
        const fetchMock = stub({'/tournaments/7': () => running, '/profile/me': () => ({})});
        renderView();
        expect(await screen.findByText('The other games of the round are being played…')).toBeInTheDocument();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3500);
        });
        const loads = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tournaments/7')).length;
        expect(loads).toBeGreaterThanOrEqual(2);
    });

    it('сетка на выбывание с переигровкой', async () => {
        const knockout = roundRobin({
            format: 'knockout', standings: [],
            games: [
                game(1, 1, 1, 1, 4, '1/2-1/2'), game(5, 1, 1, 4, 1, null, {stage: 'rematch', base_time_ms: 150000, increment_ms: 1000}),
                game(2, 1, 2, 2, 3, '1-0'),
            ] as Tournament['games'],
        });
        stub({'/tournaments/7': () => knockout, '/profile/me': () => ({}), '/games/5/start': () => ({forfeited: false})});
        renderView();
        expect(await screen.findByTestId('bracket')).toBeInTheDocument();
        expect(screen.getAllByText('Semifinal').length).toBeGreaterThan(0);
        expect(screen.getByText('Rematch')).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Play my game'})));
        const state = JSON.parse((await screen.findByTestId('location')).textContent!);
        expect(state.tournamentGame).toMatchObject({gameId: 5, color: 'white', baseTimeMs: 150000, incrementMs: 1000});
    });

    it('призёр получает диплом, победитель назван', async () => {
        const finished = roundRobin({
            status: 'finished', finished_at: '2026-11-13T12:00:00Z',
            players: players.map((p) => ({...p, place: p.seat === 4 ? 2 : p.seat === 2 ? 1 : p.seat === 1 ? 3 : 4})),
        });
        stub({'/tournaments/7': () => finished, '/profile/me': () => ({username: 'Alice'})});
        renderView();
        expect(await screen.findByTestId('tournament-winner')).toHaveTextContent('Winner: Combinator');
        const diploma = screen.getByTestId('diploma');
        await waitFor(() => expect(diploma).toHaveTextContent('Alice'));
        expect(diploma).toHaveTextContent('for 2 place');
        expect(screen.getByRole('button', {name: 'Save as PNG'})).toBeInTheDocument();
    });

    it('ошибка загрузки показывается текстом сервера', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 404,
            json: async () => ({detail: {code: 'tournament_not_found', params: {}, message: 'Tournament not found'}}),
        }) as Response));
        renderView();
        expect(await screen.findByRole('alert')).toHaveTextContent('Tournament not found');
    });

    it('брошенная и начатая заново партия — поражение, на главную доску не переходим', async () => {
        const fetchMock = stub({
            '/tournaments/7': () => roundRobin(), '/profile/me': () => ({}),
            '/games/1/start': () => ({forfeited: true, game: game(1, 1, 1, 1, 4, '1-0')}),
        });
        renderView();
        const button = await screen.findByRole('button', {name: 'Play my game'});
        await act(async () => fireEvent.click(button));
        expect(await screen.findByTestId('tournament-notice')).toHaveTextContent('already started and abandoned');
        expect(screen.queryByTestId('location')).toBeNull();
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tournaments/7')).length).toBeGreaterThanOrEqual(2);
    });

    it('сдать турнир — с подтверждением', async () => {
        vi.stubGlobal('confirm', vi.fn(() => true));
        const fetchMock = stub({
            '/tournaments/7': () => roundRobin(), '/profile/me': () => ({}),
            '/withdraw': () => roundRobin({withdrawn: true}),
        });
        renderView();
        const button = await screen.findByRole('button', {name: 'Withdraw'});
        await act(async () => fireEvent.click(button));
        expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/tournaments/7/withdraw') && init?.method === 'POST')).toBe(true);
        expect(await screen.findByTestId('tournament-notice')).toHaveTextContent('You withdrew');
    });
});

describe('карьера (таск 15.4)', () => {
    const CAREER = {
        stages: [
            {key: 'main-1', number: 1, invitational: false, hidden: false, unlocked: true, best_place: 2, format: 'round_robin', size: 4,
                base_time_ms: 300000, increment_ms: 0, target: 800, opponents: [{kind: 'archetype', id: 'rusher'}]},
            {key: 'main-2', number: 2, invitational: false, hidden: false, unlocked: false, best_place: null, format: 'knockout', size: 4,
                base_time_ms: 600000, increment_ms: 0, target: 900, opponents: []},
            {key: 'invitational-1', number: 1, invitational: true, hidden: true, unlocked: false, best_place: null},
        ],
    };

    function renderPage() {
        return render(<MemoryRouter><Routes><Route path="/" element={<TournamentsPage/>}/><Route path="/tournaments/:tournamentId" element={<p>opened</p>}/></Routes></MemoryRouter>);
    }

    it('лестница: пройденный, закрытый и скрытый этапы; запуск этапа', async () => {
        const fetchMock = stub({
            '/tournaments': () => [],
            '/tournaments/career': () => CAREER,
            '/tournaments/career/main-1': () => ({id: 12}),
            '/bots/catalog': () => ({calibration: null, historical: [], archetypes: []}),
            '/bots/personalities': () => [],
        });
        renderPage();
        expect(await screen.findByTestId('career-progress')).toHaveTextContent('Tournaments completed: 1 of 3');
        expect(screen.getByTestId('career-main-1')).toHaveTextContent('best place: 2');
        expect(screen.queryByTestId('career-start-main-2')).toBeNull();
        expect(screen.getByTestId('career-invitational-1')).toHaveTextContent('???');
        await act(async () => fireEvent.click(screen.getByTestId('career-start-main-1')));
        expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/tournaments/career/main-1') && init?.method === 'POST')).toBe(true);
        expect(await screen.findByText('opened')).toBeInTheDocument();
    });

    it('случайные соперники: выбирать не нужно, на сервер уходит режим', async () => {
        const fetchMock = stub({
            '/tournaments': (init) => (init?.method === 'POST' ? {id: 9} : []),
            '/tournaments/career': () => ({stages: []}),
            '/bots/catalog': () => ({calibration: null, historical: [], archetypes: []}),
            '/bots/personalities': () => [],
        });
        renderPage();
        fireEvent.click(await screen.findByTestId('opponents-mode-stronger'));
        expect(screen.getByTestId('opponents-random')).toHaveTextContent('3 opponents');
        const create = screen.getByRole('button', {name: 'Create tournament'});
        expect(create).toBeEnabled();
        await act(async () => fireEvent.click(create));
        const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
        expect(JSON.parse(String(post[1]!.body))).toMatchObject({random: 'stronger', participants: []});
    });
});

describe('швейцарская система (таск 15.4)', () => {
    it('таблица с Бухгольцем и туры «N из 5»', async () => {
        const swiss = roundRobin({
            format: 'swiss', size: 8, current_round: 2,
            standings: [
                {seat: 2, points: 1, head_to_head: 0, sonneborn_berger: 0, place: 1, buchholz: 1.5},
                {seat: 1, points: 0, head_to_head: 0, sonneborn_berger: 0, place: 2, buchholz: 0.5},
                {seat: 4, points: 0, head_to_head: 0, sonneborn_berger: 0, place: 3, buchholz: 0},
                {seat: 3, points: 0, head_to_head: 0, sonneborn_berger: 0, place: 4, buchholz: 0},
            ],
        });
        stub({'/tournaments/7': () => swiss});
        renderView();
        const table = await screen.findByTestId('swiss-table');
        expect(table).toHaveTextContent('Buchholz');
        expect(table).toHaveTextContent('1.5');
        expect(screen.getByTestId('tournament-status')).toHaveTextContent('2');
        expect(screen.getByTestId('tournament-status')).toHaveTextContent('5');
        expect(screen.queryByTestId('crosstable')).toBeNull();
    });
});
