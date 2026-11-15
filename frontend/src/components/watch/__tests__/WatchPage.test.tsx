// «Просмотр» (таск 16.3): партия дня, идущие партии и переход в режим зрителя, архив с фильтрами, подборки.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {WatchPage} from '../WatchPage';

const GAME = {id: 5, white: 'Tal, Mikhail', black: 'Botvinnik, Mikhail', year: '1960', site: 'Moscow', result: '1-0', eco: 'B12'};

function stub(live: unknown[] = []) {
    const fetchMock = vi.fn(async (url: string) => {
        const u = String(url);
        const body = u.includes('/games/live') ? live
            : u.includes('game-of-the-day') ? {date: '2026-11-15', game: GAME}
                : u.includes('/watch/archive') ? {total: 25, items: [GAME]}
                    : u.includes('/watch/collections') ? {collections: {shortest: [{...GAME, value: 11}], checks: [], capture_streak: [],
                        peaceful: [], promotions: [], pawn_wars: [], stalemates: []}} : {};
        return {ok: true, status: 200, json: async () => body} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function Probe() {
    const location = useLocation();
    return <pre data-testid="probe">{JSON.stringify(location.state)}</pre>;
}

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/watch']}>
            <Routes>
                <Route path="/watch" element={<WatchPage/>}/>
                <Route path="/" element={<Probe/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => vi.unstubAllGlobals());

describe('Просмотр', () => {
    it('партия дня и пустой список идущих партий', async () => {
        stub();
        renderPage();
        expect(await screen.findByTestId('watch-daily')).toHaveAttribute('href', '/game/5');
        expect(await screen.findByTestId('watch-live-empty')).toBeInTheDocument();
    });

    it('«Смотреть» открывает партию в режиме зрителя на главной доске', async () => {
        stub([{game_id: 9, white_username: 'a', white_rating: 1500, black_username: 'b', black_rating: 1490,
            base_time_ms: 180000, increment_ms: 2000, spectators_count: 3}]);
        renderPage();
        fireEvent.click(await screen.findByRole('button', {name: 'Смотреть'}));
        expect(screen.getByTestId('probe')).toHaveTextContent('{"spectate":9}');
    });

    it('архив: фильтры уходят в запрос, листание страниц', async () => {
        const fetchMock = stub();
        renderPage();
        fireEvent.click(screen.getByTestId('watch-tab-archive'));
        expect(await screen.findByTestId('watch-total')).toHaveTextContent('25');
        fireEvent.change(screen.getByTestId('filter-player'), {target: {value: 'tal'}});
        fireEvent.change(screen.getByTestId('filter-year-from'), {target: {value: '1960'}});
        fireEvent.change(screen.getByTestId('filter-eco'), {target: {value: 'B1'}});
        await act(async () => fireEvent.submit(screen.getByTestId('watch-filters')));
        const last = () => String(fetchMock.mock.calls.filter(([u]) => String(u).includes('/watch/archive')).at(-1)![0]);
        expect(last()).toMatch(/player=tal/);
        expect(last()).toMatch(/year_from=1960/);
        expect(last()).toMatch(/eco=B1/);
        await act(async () => fireEvent.click(screen.getByTestId('watch-next')));
        expect(last()).toMatch(/offset=20/);
    });

    it('подборки: показываются только непустые', async () => {
        stub();
        renderPage();
        fireEvent.click(screen.getByTestId('watch-tab-collections'));
        expect(await screen.findByTestId('collection-shortest')).toHaveTextContent('11 пх');
        expect(screen.queryByTestId('collection-checks')).toBeNull();
    });
});
