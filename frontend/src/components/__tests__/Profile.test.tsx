// Профиль игрока: рейтинги по категориям, статистика партий, таблица истории с результатами
// с точки зрения владельца профиля, переходы и ошибки загрузки.

import {fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation, useParams} from 'react-router-dom';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import Profile from '../Profile';

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

function stubFetch(routes: { profile: Reply; games?: Reply }) {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        const reply = url.includes('/games?') ? (routes.games ?? {ok: true, body: {items: []}}) : routes.profile;
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
        expect(screen.getByText('Недостаточно данных для графика')).toBeInTheDocument();
    });

    it('считает победы, ничьи и поражения с точки зрения владельца профиля', async () => {
        stubFetch({profile: {ok: true, body: PROFILE}, games: {ok: true, body: {items: GAMES}}});
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
        expect(urls[1]).toMatch(/\/api\/v1\/profile\/Alice%20B\/games\?limit=30$/);
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
