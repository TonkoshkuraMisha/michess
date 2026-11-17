// «Машина времени» (таск 28.3): лента знаменитых турниров, вход в турнир, имена мастеров прошлого, настоящий итог.

import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setLanguage, t} from '../../../i18n';
import {setToken} from '../../../services/authToken';
import {
    eventTitle, fieldName, fieldShortName, guestAbout, guestName, guestShortName, scoreText,
} from '../../../services/timeMachine';
import type {HistoricEvent} from '../../../services/timeMachine';
import {gameStart, guestIdOf, participantName, totalRounds} from '../../../services/tournaments';
import type {Tournament, TournamentPlayer} from '../../../services/tournaments';
import {PERIOD_STARTS, RealResult, TimeMachinePage, periodLabel, periodOf} from '../TimeMachine';
import {TournamentView} from '../TournamentsPage';

const AVRO: HistoricEvent = {
    key: 'avro_1938', year: 1938, format: 'round_robin', cycles: 2, size: 9, rounds: 18, player_games: 16,
    field: [
        {id: 'keres', kind: 'guest', rating: 2400, place: 1, score: 8.5},
        {id: 'fine', kind: 'guest', rating: 2400, place: 1, score: 8.5},
        {id: 'botvinnik', kind: 'bot', rating: 2400, place: 3, score: 7.5},
        {id: 'euwe', kind: 'guest', rating: 2350, place: 4, score: 7},
        {id: 'reshevsky', kind: 'guest', rating: 2400, place: 4, score: 7},
        {id: 'alekhine', kind: 'bot', rating: 2190, place: 4, score: 7},
        {id: 'capablanca', kind: 'bot', rating: 2163, place: 7, score: 6},
        {id: 'flohr', kind: 'guest', rating: 2350, place: 8, score: 4.5},
    ],
    active_id: null, best_place: null, played: 0,
};
const LONDON: HistoricEvent = {
    key: 'london_1851', year: 1851, format: 'knockout', cycles: 1, size: 17, rounds: 5, player_games: null,
    field: [
        {id: 'anderssen', kind: 'bot', rating: 2100, place: 1, score: null},
        {id: 'wyvill', kind: 'guest', rating: 1900, place: 2, score: null},
        {id: 'kieseritzky', kind: 'guest', rating: 1950, place: null, score: null},
    ],
    active_id: null, best_place: null, played: 0,
};

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | unknown;

function stub(handler: Handler) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const reply = handler(String(url), init);
        const {status = 200, body} = reply && typeof reply === 'object' && 'body' in reply
            ? reply as { status?: number; body: unknown } : {body: reply};
        return {ok: status < 400, status, json: async () => body} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof stub>) =>
    (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).filter(([, init]) => init?.method === 'POST');

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/time-machine']}>
            <Routes>
                <Route path="/time-machine" element={<TimeMachinePage/>}/>
                <Route path="/tournaments/:tournamentId" element={<p data-testid="tournament-opened"/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    setLanguage('ru', {persist: false});
    vi.unstubAllGlobals();
});

describe('имена и числа', () => {
    it('мастер прошлого — на языке игрока, незнакомый id — как есть', () => {
        expect(guestName('keres', t)).toBe('Пауль Керес');
        expect(guestAbout('schlechter', t)).toMatch(/защита/);
        expect(guestName('nobody', t)).toBe('nobody');
        expect(guestAbout('nobody', t)).toBeNull();
        expect(fieldName({id: 'botvinnik', kind: 'bot'}, t)).toBe('Михаил Ботвинник');
        expect(fieldShortName({id: 'botvinnik', kind: 'bot'}, t)).toBe('Ботвинник');
        expect(fieldShortName({id: 'fine', kind: 'guest'}, t)).toBe('Файн');
        expect(guestShortName('lasker_edward', t)).toBe('Эд. Ласкер');
        expect(guestShortName('nobody', t)).toBe('nobody');
        expect(fieldName({id: 'fine', kind: 'guest'}, t)).toBe('Ройбен Файн');
        setLanguage('en', {persist: false});
        expect(guestName('keres', t)).toBe('Paul Keres');
        setLanguage('uk', {persist: false});
        expect(guestName('keres', t)).toBe('Пауль Керес');
        expect(eventTitle('hastings_1895', t)).toBe('Гастінгс 1895');
        expect(eventTitle('unknown_event', t)).toBe('unknown_event');
    });

    it('очки записываются с половинками', () => {
        expect([16.5, 16, 0.5, 0, 3].map(scoreText)).toEqual(['16½', '16', '½', '0', '3']);
    });

    it('участник турнира: мастер прошлого опознаётся по ключу', () => {
        const base = {seat: 1, user_id: null, rating: 2400, place: null, eliminated_round: null, config: null};
        const guest: TournamentPlayer = {...base, kind: 'personality', bot_key: 'guest:keres', personality_name: 'Keres, Paul'};
        const own: TournamentPlayer = {...base, kind: 'personality', bot_key: null, personality_name: 'Мой соперник'};
        expect(guestIdOf(guest)).toBe('keres');
        expect(guestIdOf(own)).toBeNull();
        expect(participantName(guest, t)).toBe('Керес');
        expect(participantName(own, t)).toBe('Мой соперник');
    });
});

describe('лента турниров', () => {
    it('турнир: год, рассказ, формат, число партий игрока, сильнейшие и полный состав', async () => {
        stub(() => ({events: [LONDON, AVRO]}));
        renderPage();
        const avro = await screen.findByTestId('event-avro_1938');
        expect(within(avro).getByText('1938')).toBeInTheDocument();
        expect(within(avro).getByRole('heading', {name: 'АВРО 1938'})).toBeInTheDocument();
        expect(avro).toHaveTextContent('Восемь сильнейших шахматистов мира');
        expect(avro).toHaveTextContent('Круговой · 2 круга');
        expect(avro).toHaveTextContent('8 мастеров');
        expect(within(avro).getByTestId('games-avro_1938')).toHaveTextContent('у вас 16 партий');
        expect(avro).toHaveTextContent('Сильнейшие: Керес, Файн, Ботвинник');
        // Настоящий итог: делёж первого места, очки с половинками.
        const rows = within(avro).getByTestId('real-table').querySelectorAll('li');
        expect(rows).toHaveLength(8);
        expect(rows[0]).toHaveTextContent('1Пауль Керес8½');
        expect(rows[7]).toHaveTextContent('8Сало Флор4½');

        const london = screen.getByTestId('event-london_1851');
        expect(within(london).getByTestId('games-london_1851')).toHaveTextContent('вы играете, пока не проиграете матч');
        expect(london).toHaveTextContent('На выбывание');
        expect(within(london).getByTestId('real-table')).toHaveTextContent('выбыл в 1-м круге');
    });

    it('периоды ленты: год турнира относится к своему периоду, подпись — годы', () => {
        expect([1851, 1880, 1881, 1900, 1901, 1914, 1915, 1938, 1948].map(periodOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3]);
        expect(PERIOD_STARTS.map((_, index) => periodLabel(index, 1938))).toEqual(['1851–1880', '1881–1900', '1901–1914', '1915–1938']);
        // Последний период тянется до последнего турнира ленты.
        expect(periodLabel(3, 1946)).toBe('1915–1946');
    });

    it('выбор периода оставляет в ленте только его турниры; «Все» возвращает остальные', async () => {
        stub(() => ({events: [LONDON, AVRO]}));
        renderPage();
        await screen.findByTestId('event-avro_1938');
        const periods = screen.getByTestId('tm-periods');
        expect(within(periods).getByTestId('period-all')).toHaveTextContent('Все · 2');
        expect(within(periods).getByTestId('period-all')).toHaveAttribute('aria-pressed', 'true');
        // Периоды без турниров не показаны.
        expect(within(periods).getAllByRole('button').map((b) => b.textContent)).toEqual(['Все · 2', '1851–1880 · 1', '1915–1938 · 1']);

        fireEvent.click(within(periods).getByTestId('period-0'));
        expect(screen.getByTestId('event-london_1851')).toBeInTheDocument();
        expect(screen.queryByTestId('event-avro_1938')).toBeNull();
        expect(within(periods).getByTestId('period-0')).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(within(periods).getByTestId('period-3'));
        expect(screen.queryByTestId('event-london_1851')).toBeNull();
        expect(screen.getByTestId('event-avro_1938')).toBeInTheDocument();

        fireEvent.click(within(periods).getByTestId('period-all'));
        expect(screen.getByTestId('event-london_1851')).toBeInTheDocument();
        expect(screen.getByTestId('event-avro_1938')).toBeInTheDocument();
    });

    it('вход в турнир: выбранный контроль уходит на сервер, открывается турнир', async () => {
        const fetchMock = stub((_url, init) => (init?.method === 'POST' ? {status: 201, body: {id: 77}} : {events: [AVRO]}));
        renderPage();
        const start = await screen.findByTestId('start-avro_1938');
        const select = screen.getByTestId('tm-control') as HTMLSelectElement;
        // По умолчанию — десять минут; на кнопке — выбранный контроль.
        expect(select.value).toBe('rapid-10+0');
        expect(start).toHaveTextContent(`Войти в турнир · ${select.selectedOptions[0].textContent}`);
        fireEvent.change(select, {target: {value: 'rapid-15+10'}});
        expect(screen.getByTestId('start-avro_1938')).toHaveTextContent(select.selectedOptions[0].textContent ?? '?');
        await act(async () => fireEvent.click(screen.getByTestId('start-avro_1938')));
        const [[url, init]] = posts(fetchMock);
        expect(url).toMatch(/\/api\/v1\/tournaments\/time-machine\/avro_1938$/);
        expect(JSON.parse(String(init?.body))).toEqual({base_time_ms: 900_000, increment_ms: 10_000});
        expect(await screen.findByTestId('tournament-opened')).toBeInTheDocument();
    });

    it('гость видит ленту, а при входе в турнир получает подсказку войти — без запроса к серверу', async () => {
        setToken(null);
        const fetchMock = stub(() => ({events: [AVRO]}));
        renderPage();
        fireEvent.click(await screen.findByTestId('start-avro_1938'));
        expect(screen.getByRole('alert')).toHaveTextContent('Войдите, чтобы стать участником турнира');
        expect(posts(fetchMock)).toHaveLength(0);
        expect(screen.queryByTestId('tournament-opened')).toBeNull();
    });

    it('пуля и свой контроль не предлагаются', async () => {
        stub(() => ({events: [AVRO]}));
        renderPage();
        const options = Array.from((await screen.findByTestId('tm-control') as HTMLSelectElement).options).map((o) => o.value);
        expect(options).toContain('blitz-3+0');
        expect(options.some((value) => value.startsWith('bullet') || value.endsWith('manual'))).toBe(false);
    });

    it('идущий турнир продолжается, в другой войти нельзя; лучшее место показано', async () => {
        stub(() => ({events: [{...LONDON, best_place: 3, played: 2}, {...AVRO, active_id: 12}]}));
        renderPage();
        expect(await screen.findByTestId('continue-avro_1938')).toHaveAttribute('href', '/tournaments/12');
        expect(screen.queryByTestId('start-avro_1938')).toBeNull();
        expect(screen.getByTestId('start-london_1851')).toBeDisabled();
        expect(screen.getByTestId('tm-active')).toHaveTextContent('Вы играете турнир «АВРО 1938»');
        expect(screen.getByTestId('best-london_1851')).toHaveTextContent('Ваше лучшее место: 3');
        expect(screen.getByTestId('event-london_1851')).toHaveTextContent('сыгран 2 раза');
    });

    it('отказ сервера показан игроку', async () => {
        stub((_url, init) => (init?.method === 'POST'
            ? {status: 409, body: {detail: {code: 'tournament_active_exists', params: {}, message: '…'}}} : {events: [AVRO]}));
        renderPage();
        const start = await screen.findByTestId('start-avro_1938');
        await act(async () => fireEvent.click(start));
        expect(screen.getByRole('alert')).toHaveTextContent('У вас уже есть незавершённый турнир');
    });

    it('чужой ответ сервера не ломает страницу', async () => {
        stub(() => ({stages: []}));
        renderPage();
        expect(await screen.findByTestId('time-machine')).toBeInTheDocument();
        await act(async () => undefined);
        expect(screen.queryByText('Загрузка турниров…')).toBeNull();
        expect(document.querySelectorAll('[data-testid^="event-"]')).toHaveLength(0);
    });
});

describe('настоящий итог рядом с турниром', () => {
    it('после конца турнира — раскрыт, с местом игрока', async () => {
        stub(() => ({events: [AVRO]}));
        render(<RealResult eventKey="avro_1938" finished myPlace={4}/>);
        const block = await screen.findByTestId('real-result');
        expect(block).toHaveAttribute('open');
        expect(block).toHaveTextContent('Первое место разделили Пауль Керес и Ройбен Файн');
        expect(screen.getByTestId('real-compare')).toHaveTextContent('Ваше место в этот раз: 4.');
    });

    it('пока турнир идёт — свёрнут и без сравнения', async () => {
        stub(() => ({events: [AVRO]}));
        render(<RealResult eventKey="avro_1938" finished={false} myPlace={null}/>);
        const block = await screen.findByTestId('real-result');
        expect(block).not.toHaveAttribute('open');
        expect(screen.queryByTestId('real-compare')).toBeNull();
    });
});

// --- турнир в историческом составе --------------------------------------------------------------------------------

const player = (seat: number, over: Partial<TournamentPlayer>): TournamentPlayer => ({
    seat, kind: 'bot', user_id: null, bot_key: null, personality_name: null, rating: 2000, place: null,
    eliminated_round: null, config: null, ...over,
});
const CONFIG = {target_elo: 2400} as unknown as TournamentPlayer['config'];

function doubleRoundRobin(): Tournament {
    // Трое в два круга: игрок (место 3), Керес и Ботвинник; сыграны обе партии Керес — Ботвинник.
    const games = [
        [1, 1, 1, 2, '1-0'], [2, 1, 3, 1, null], [3, 1, 2, 3, null],
        [4, 1, 2, 1, '1/2-1/2'], [5, 1, 1, 3, null], [6, 1, 3, 2, null],
    ] as const;
    return {
        id: 5, format: 'round_robin', size: 3, status: 'active', base_time_ms: 600_000, increment_ms: 0, current_round: 2,
        created_at: '2026-11-17T00:00:00Z', finished_at: null, my_seat: 3, withdrawn: false, event_key: 'avro_1938',
        players: [
            player(1, {kind: 'personality', bot_key: 'guest:keres', personality_name: 'Keres, Paul', config: CONFIG, rating: 2400}),
            player(2, {kind: 'bot', bot_key: 'botvinnik', rating: 2400}),
            player(3, {kind: 'user', user_id: 1, rating: 1500}),
        ],
        games: games.map(([round, board, white, black, result], index) => ({
            id: index + 1, round, board, stage: 'main' as const, white_seat: white, black_seat: black, base_time_ms: 600_000,
            increment_ms: 0, result, game_id: null,
        })),
        standings: [
            {seat: 1, points: 1.5, head_to_head: 0, sonneborn_berger: 0, place: 1},
            {seat: 2, points: 0.5, head_to_head: 0, sonneborn_berger: 0, place: 2},
            {seat: 3, points: 0, head_to_head: 0, sonneborn_berger: 0, place: 3},
        ],
    };
}

describe('турнир в историческом составе', () => {
    it('число туров — по расписанию, а не по размеру', () => {
        const tournament = doubleRoundRobin();
        expect(totalRounds(tournament)).toBe(6);
        expect(totalRounds({...tournament, format: 'knockout', size: 17, games: tournament.games.slice(0, 1)})).toBe(5);
        expect(totalRounds({...tournament, format: 'knockout', size: 8})).toBe(3);
    });

    it('партия с мастером прошлого: на доске — имя на языке игрока, сохраняется под именем из турнира', () => {
        const tournament = doubleRoundRobin();
        const game = tournament.games[1];  // игрок белыми против Кереса
        const start = gameStart(tournament, game, participantName(tournament.players[0], t));
        expect(start.color).toBe('white');
        expect(start.botId).toBeNull();
        expect(start.custom).toEqual({name: 'Керес', savedName: 'Keres, Paul', config: CONFIG});
        // Исторический бот по-прежнему запускается по id, без характера.
        const withBot = gameStart(tournament, tournament.games[2], 'Ботвинник');
        expect(withBot.botId).toBe('botvinnik');
        expect(withBot.custom).toBeNull();
    });

    it('сетка с проходами: кто не играл в первом круге, перечислен; ранний круг назван по номеру', async () => {
        // Лондон 1851 с игроком: пятеро в сетке на восемь — играют только 4-й и 5-й номера.
        const base = doubleRoundRobin();
        const knockout: Tournament = {
            ...base, format: 'knockout', size: 5, event_key: 'london_1851', current_round: 1, standings: [],
            players: [
                player(1, {kind: 'bot', bot_key: 'anderssen', rating: 2100}),
                player(2, {kind: 'personality', bot_key: 'guest:wyvill', personality_name: 'Wyvill, Marmaduke', config: CONFIG}),
                player(3, {kind: 'bot', bot_key: 'staunton'}),
                player(4, {kind: 'personality', bot_key: 'guest:mucklow', personality_name: 'Mucklow, James R.', config: CONFIG}),
                player(5, {kind: 'user', user_id: 1, rating: 1500}),
            ],
            my_seat: 5,
            games: [{id: 1, round: 1, board: 4, stage: 'main', white_seat: 4, black_seat: 5, base_time_ms: 600_000,
                increment_ms: 0, result: null, game_id: null}],
        };
        stub((url) => (url.includes('/time-machine') ? {events: []} : url.includes('/profile/me') ? {username: 'alice'} : knockout));
        render(
            <MemoryRouter initialEntries={['/tournaments/5']}>
                <Routes><Route path="/tournaments/:tournamentId" element={<TournamentView/>}/></Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByTestId('bracket-byes')).toHaveTextContent('Проходят без игры: Андерсен, Уайвилл, Стаунтон');
        // Сетка на пятерых — три круга: первый из них четвертьфинал.
        expect(screen.getByTestId('bracket')).toHaveTextContent('Четвертьфинал');
        expect(screen.getByTestId('bracket')).toHaveTextContent('Маклоу');
    });

    it('страница турнира: название события, обе партии пары в таблице, ссылка на «Машину времени»', async () => {
        stub((url) => (url.includes('/time-machine') ? {events: [AVRO]}
            : url.includes('/profile/me') ? {username: 'alice'} : doubleRoundRobin()));
        render(
            <MemoryRouter initialEntries={['/tournaments/5']}>
                <Routes><Route path="/tournaments/:tournamentId" element={<TournamentView/>}/></Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByTestId('tournament-title')).toHaveTextContent('АВРО 1938 · Круговой · 3');
        expect(screen.getByRole('link', {name: 'Машина времени'})).toHaveAttribute('href', '/time-machine');
        expect(screen.getByTestId('tournament-status')).toHaveTextContent('2');
        expect(screen.getByTestId('tournament-status')).toHaveTextContent('6');
        const rows = screen.getByTestId('crosstable').querySelectorAll('tbody tr');
        // Керес против Ботвинника: победа и ничья — обе в одной клетке.
        expect(rows[0]).toHaveTextContent('Керес');
        expect(rows[0].querySelectorAll('td')[3]).toHaveTextContent('1 ½');
        expect(rows[1].querySelectorAll('td')[2]).toHaveTextContent('0 ½');
        expect(await screen.findByTestId('real-result')).toBeInTheDocument();
    });
});
