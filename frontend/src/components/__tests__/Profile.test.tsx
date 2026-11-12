// Профиль игрока: рейтинги по категориям, статистика партий, таблица истории с результатами
// с точки зрения владельца профиля, переходы и ошибки загрузки.

import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation, useParams} from 'react-router-dom';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {cloneElement, type ReactElement} from 'react';
import Profile, {RatingDot, RatingTooltip, formatRatingDelta, toRatingChartPoint} from '../Profile';

// В jsdom у контейнера нулевой размер, и recharts не рисует график. Отдаём графику фиксированный
// размер — тогда точки появляются в DOM и по ним можно кликнуть.
vi.mock('recharts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('recharts')>();
    return {
        ...actual,
        ResponsiveContainer: ({children}: { children: ReactElement }) => (
            <div style={{width: 800, height: 300}}>
                {cloneElement(children as ReactElement<{ width: number; height: number }>, {width: 800, height: 300})}
            </div>
        ),
    };
});

const PROFILE = {
    id: 7,
    username: 'Alice',
    bullet_rating: 1401,
    blitz_rating: 1502,
    rapid_rating: 1603,
    classical_rating: 1704,
    created_at: '2026-03-15T10:00:00Z',
};

const game = (id: number, white: string, black: string, result: string, extra: Record<string, unknown> = {}) => ({
    game_id: id,
    white_username: white,
    white_rating: 1500,
    black_username: black,
    black_rating: 1500,
    status: 'COMPLETED',
    is_rated: true,
    result,
    pgn_date: null,
    site: null,
    eco: null,
    finished_at: '2026-11-01T12:00:00Z',
    ...extra,
});

const GAMES = [
    game(1, 'Alice', 'Bob', '1-0', {eco: 'C20', site: 'Michess', pgn_date: '2026.10.05'}),
    game(2, 'Bob', 'Alice', '1-0'),
    game(3, 'Alice', 'Carol', '1/2-1/2'),
    game(4, 'Dave', 'Alice', '0-1', {pgn_date: '????.??.??'}),
];

type Reply = { ok: boolean; body?: unknown };

const stats = (overrides: Record<string, unknown> = {}) => ({
    total: 0, wins: 0, draws: 0, losses: 0,
    rated_games: {bullet: 0, blitz: 0, rapid: 0, classical: 0},
    ...overrides,
});

const point = (id: number, rating: number, delta: number) => ({
    game_id: id, finished_at: `2026-11-0${id}T12:00:00Z`, rating, delta, color: 'white', result: '1-0',
});

function stubFetch(routes: {
    profile: Reply;
    games?: Reply | ((url: string) => Reply);
    stats?: Reply;
    history?: (url: string) => Reply;
}) {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        let reply: Reply;
        if (url.includes('/games?')) {
            const games = routes.games ?? {ok: true, body: {items: []}};
            reply = typeof games === 'function' ? games(url) : games;
        } else if (url.endsWith('/stats')) {
            reply = routes.stats ?? {ok: false};
        } else if (url.includes('/rating-history')) {
            reply = routes.history ? routes.history(url) : {ok: true, body: {points: []}};
        } else {
            reply = routes.profile;
        }
        return {ok: reply.ok, status: reply.ok ? 200 : 404, json: async () => reply.body} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function GameStub() {
    const {id} = useParams();
    const location = useLocation();
    return <div>Партия {id} ({(location.state as any)?.game?.result})</div>;
}

function renderProfile(path = '/profile/Alice') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/profile/:targetUsername" element={<Profile/>}/>
                <Route path="/game/:id" element={<GameStub/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

beforeAll(() => {
    // recharts измеряет контейнер через ResizeObserver, которого нет в jsdom.
    vi.stubGlobal('ResizeObserver', class {
        observe() {
        }

        unobserve() {
        }

        disconnect() {
        }
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', class {
        observe() {
        }

        unobserve() {
        }

        disconnect() {
        }
    });
});

describe('Profile', () => {
    it('показывает четыре рейтинга и дату регистрации', async () => {
        stubFetch({profile: {ok: true, body: PROFILE}});
        renderProfile();

        expect(await screen.findByText('Alice')).toBeInTheDocument();
        for (const rating of ['1401', '1502', '1603', '1704']) {
            expect(screen.getByText(rating)).toBeInTheDocument();
        }
        expect(screen.getByText(/На сайте с 15 марта 2026/)).toBeInTheDocument();
        expect(screen.getByText('Партий пока нет.')).toBeInTheDocument();
        expect(screen.getByText(/Недостаточно рейтинговых партий в этой категории/)).toBeInTheDocument();
    });

    it('считает победы, ничьи и поражения с точки зрения владельца профиля', async () => {
        stubFetch({
            profile: {ok: true, body: PROFILE},
            games: {ok: true, body: {items: GAMES, total: 4}},
            stats: {ok: true, body: stats({total: 4, wins: 2, draws: 1, losses: 1})},
        });
        renderProfile();

        const rows = await screen.findAllByTitle('Нажмите, чтобы просмотреть партию');
        expect(rows).toHaveLength(4);
        expect(within(rows[0]).getByText(/Победа/)).toBeInTheDocument();     // белыми, 1-0
        expect(within(rows[1]).getByText(/Поражение/)).toBeInTheDocument();  // чёрными, 1-0
        expect(within(rows[2]).getByText(/Ничья/)).toBeInTheDocument();
        expect(within(rows[3]).getByText(/Победа/)).toBeInTheDocument();     // чёрными, 0-1

        // 2 победы из 4 партий.
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(within(rows[0]).getByText('C20')).toBeInTheDocument();
        expect(within(rows[0]).getByText('2026.10.05')).toBeInTheDocument();
        // Неизвестная дата PGN — берётся дата завершения партии.
        expect(within(rows[3]).getByText('1 нояб. 2026')).toBeInTheDocument();
    });

    it('имя соперника открывает его профиль', async () => {
        const fetchMock = stubFetch({profile: {ok: true, body: PROFILE}, games: {ok: true, body: {items: GAMES}}});
        renderProfile();

        const rows = await screen.findAllByTitle('Нажмите, чтобы просмотреть партию');
        fireEvent.click(within(rows[1]).getByText('Bob'));

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/profile\/Bob$/)));
        // Клик по ссылке не должен всплыть до строки и открыть просмотр партии.
        expect(screen.queryByText(/^Партия 2/)).not.toBeInTheDocument();
    });

    it('клик по партии передаёт её в просмотр', async () => {
        stubFetch({profile: {ok: true, body: PROFILE}, games: {ok: true, body: {items: GAMES}}});
        renderProfile();

        const rows = await screen.findAllByTitle('Нажмите, чтобы просмотреть партию');
        fireEvent.click(rows[2]);

        expect(await screen.findByText('Партия 3 (1/2-1/2)')).toBeInTheDocument();
    });

    it('PGN скачивается по ссылке на API', async () => {
        stubFetch({profile: {ok: true, body: PROFILE}, games: {ok: true, body: {items: GAMES}}});
        renderProfile();

        const links = await screen.findAllByTitle('Скачать PGN');
        expect(links[0].getAttribute('href')).toMatch(/\/api\/v1\/profile\/games\/1\/pgn$/);
    });

    it('имя с пробелом экранируется в запросах к API', async () => {
        const fetchMock = stubFetch({profile: {ok: true, body: {...PROFILE, username: 'Alice B'}}});
        renderProfile('/profile/Alice%20B');

        await screen.findByText('Alice B');
        const urls = fetchMock.mock.calls.map(([url]) => url.toString());
        expect(urls[0]).toMatch(/\/api\/v1\/profile\/Alice%20B$/);
        expect(urls).toContainEqual(expect.stringMatching(/\/profile\/Alice%20B\/games\?limit=30&offset=0$/));
        expect(urls).toContainEqual(expect.stringMatching(/\/profile\/Alice%20B\/stats$/));
        expect(urls.every((url) => !url.includes('Alice B'))).toBe(true);
    });

    it('несуществующий игрок — сообщение об ошибке', async () => {
        stubFetch({profile: {ok: false}});
        renderProfile();

        expect(await screen.findByText('Пользователь не найден')).toBeInTheDocument();
    });

    it('сбой загрузки партий не ломает профиль', async () => {
        stubFetch({profile: {ok: true, body: PROFILE}, games: {ok: false}});
        renderProfile();

        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Партий пока нет.')).toBeInTheDocument();
    });
});

describe('Profile: итоги и история рейтинга', () => {
    it('итоги берутся с сервера по всем партиям, а не по загруженной странице', async () => {
        stubFetch({
            profile: {ok: true, body: PROFILE},
            games: {ok: true, body: {items: GAMES, total: 120}},
            stats: {ok: true, body: stats({total: 120, wins: 90, draws: 10, losses: 20})},
        });
        renderProfile();

        await screen.findAllByTitle('Нажмите, чтобы просмотреть партию');
        expect(screen.getByText('120')).toBeInTheDocument();
        expect(screen.getByText('75%')).toBeInTheDocument();
        expect(screen.getByText('90')).toBeInTheDocument();
        expect(screen.getByText('20')).toBeInTheDocument();
    });

    it('первым показывается график категории, в которой сыграно больше всего', async () => {
        const fetchMock = stubFetch({
            profile: {ok: true, body: PROFILE},
            stats: {ok: true, body: stats({rated_games: {bullet: 3, blitz: 5, rapid: 40, classical: 0}})},
            history: () => ({ok: true, body: {points: [point(1, 1610, 10), point(2, 1603, -7)]}}),
        });
        renderProfile();

        expect(await screen.findByText('Динамика рейтинга — рапид')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Рапид'})).toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => {
            const urls = fetchMock.mock.calls.map(([url]) => url.toString());
            expect(urls.some((url) => url.endsWith('/rating-history?category=rapid'))).toBe(true);
        });
        expect(screen.queryByText(/Недостаточно рейтинговых партий/)).not.toBeInTheDocument();
    });

    it('переключение категории запрашивает её историю', async () => {
        const fetchMock = stubFetch({
            profile: {ok: true, body: PROFILE},
            stats: {ok: true, body: stats()},
        });
        renderProfile();
        await screen.findByText('Динамика рейтинга — блиц');

        fireEvent.click(screen.getByRole('button', {name: 'Пуля'}));

        expect(await screen.findByText('Динамика рейтинга — пуля')).toBeInTheDocument();
        await waitFor(() => {
            const urls = fetchMock.mock.calls.map(([url]) => url.toString());
            expect(urls.some((url) => url.endsWith('/rating-history?category=bullet'))).toBe(true);
        });
    });

    it('история партий листается по страницам', async () => {
        const fetchMock = stubFetch({
            profile: {ok: true, body: PROFILE},
            stats: {ok: true, body: stats({total: 65})},
            games: (url) => ({
                ok: true,
                body: {total: 65, items: [game(url.includes('offset=30') ? 31 : 1, 'Alice', 'Bob', '1-0')]},
            }),
        });
        renderProfile();

        expect(await screen.findByText(/Стр\. 1 из 3 · всего 65/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Новее/})).toBeDisabled();

        fireEvent.click(screen.getByRole('button', {name: /Старее/}));

        expect(await screen.findByText(/Стр\. 2 из 3/)).toBeInTheDocument();
        const urls = fetchMock.mock.calls.map(([url]) => url.toString());
        expect(urls.some((url) => url.endsWith('/games?limit=30&offset=30'))).toBe(true);
    });

    it('без итогов с сервера страница остаётся рабочей', async () => {
        stubFetch({profile: {ok: true, body: PROFILE}, games: {ok: true, body: {items: GAMES, total: 4}}});
        renderProfile();

        await screen.findAllByTitle('Нажмите, чтобы просмотреть партию');
        expect(screen.getByText('Динамика рейтинга — блиц')).toBeInTheDocument();
        expect(screen.queryByText(/Стр\./)).not.toBeInTheDocument();
    });
});

describe('Profile: график рейтинга', () => {
    it('точка графика хранит партию, дату и время и изменение рейтинга', () => {
        const point = toRatingChartPoint({
            game_id: 12, finished_at: '2026-11-01T12:30:00Z', rating: 1512, delta: 12,
        });

        expect(point).toMatchObject({game_id: 12, rating: 1512, delta: 12, date: '1 нояб.'});
        expect(point.fullDate).toMatch(/^1 ноября 2026, \d{2}:\d{2}$/);
    });

    it.each([[12, '+12'], [-10, '-10'], [0, '0']])('изменение %d показывается как %s', (delta, text) => {
        expect(formatRatingDelta(delta)).toBe(text);
    });

    it('подсказка показывает дату, рейтинг и изменение за партию', () => {
        const point = {game_id: 3, rating: 1490, delta: -10, date: '2 нояб.', fullDate: '2 ноября 2026, 18:05'};
        render(<RatingTooltip active payload={[{payload: point}]}/>);

        expect(screen.getByText('2 ноября 2026, 18:05')).toBeInTheDocument();
        expect(screen.getByText(/1490/).textContent).toBe('1490 (-10)');
    });

    it('без активной точки подсказки нет', () => {
        const {container} = render(<RatingTooltip active={false} payload={[]}/>);
        expect(container).toBeEmptyDOMElement();
    });

    it('клик по точке сообщает id партии', () => {
        const onSelect = vi.fn();
        const point = {game_id: 42, rating: 1500, delta: 8, date: '1 нояб.', fullDate: '1 ноября 2026, 12:00'};
        render(<svg><RatingDot cx={10} cy={20} payload={point} onSelect={onSelect}/></svg>);

        fireEvent.click(screen.getByRole('link', {name: /рейтинг 1500/}));
        expect(onSelect).toHaveBeenCalledWith(42);
    });

    it('клик по точке на странице профиля открывает разбор этой партии', async () => {
        stubFetch({
            profile: {ok: true, body: PROFILE},
            stats: {ok: true, body: stats({rated_games: {bullet: 0, blitz: 2, rapid: 0, classical: 0}})},
            history: () => ({ok: true, body: {points: [point(1, 1510, 10), point(2, 1502, -8)]}}),
        });
        renderProfile();

        const dots = await screen.findAllByRole('link', {name: /^Партия от /});
        expect(dots).toHaveLength(2);
        expect(dots[1]).toHaveAccessibleName(/рейтинг 1502/);

        fireEvent.click(dots[1]);

        expect(await screen.findByText(/^Партия 2/)).toBeInTheDocument();
    });
});

