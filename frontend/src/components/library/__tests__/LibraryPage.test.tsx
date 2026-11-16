// Библиотека партий (таск 27.1): дерево коллекций, партии коллекции со ссылками на просмотр, листание, поиск.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {LibraryPage} from '../LibraryPage';
import {childrenOf, searchQuery, totalGames} from '../../../services/library';
import type {LibraryCollection} from '../../../services/library';

const COLLECTIONS: LibraryCollection[] = [
    {id: 1, parent_id: null, name: 'Пешечные структуры', visibility: 'public', games: 0},
    {id: 2, parent_id: 1, name: 'Изолированная пешка', visibility: 'public', games: 10},
    {id: 3, parent_id: 1, name: 'Ёж', visibility: 'public', games: 16},
    {id: 4, parent_id: null, name: 'Личные', visibility: 'owner', games: 3},
];

const row = (id: number) => ({id, white: `W${id}`, black: `B${id}`, event: 'Hastings', site: '', date: '', year: 1934,
    result: '1-0', eco: 'D42', opening: '', plies: 40});

function stub() {
    const mock = vi.fn(async (url: string) => {
        const u = String(url);
        let body: unknown = {collections: COLLECTIONS};
        if (u.includes('/collections/2/games')) {
            const offset = Number(new URL(u, 'http://x').searchParams.get('offset'));
            body = {id: 2, name: 'Изолированная пешка', total: 60, games: [row(offset + 1)]};
        } else if (u.includes('/games?')) body = {total: 1, games: [row(99)]};
        return {ok: true, json: async () => body} as Response;
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('библиотека партий', () => {
    it('дерево: дети, сумма партий со вложенными, параметры поиска', () => {
        expect(childrenOf(COLLECTIONS, null).map((c) => c.id)).toEqual([1, 4]);
        expect(totalGames(COLLECTIONS, 1)).toBe(26);
        expect(searchQuery({player: 'Tal', eco: '', year_from: 1950})).toBe('player=Tal&year_from=1950&limit=50');
    });

    it('коллекция раскрывается, партии ведут в просмотр, листание', async () => {
        const mock = stub();
        await act(async () => render(<MemoryRouter><LibraryPage/></MemoryRouter>));
        expect(screen.getByTestId('library-tree')).toHaveTextContent('Пешечные структуры');
        expect(screen.queryByTestId('library-collection-2')).toBeNull();
        await act(async () => fireEvent.click(screen.getByTestId('library-collection-1')));
        await act(async () => fireEvent.click(screen.getByTestId('library-collection-2')));
        expect(screen.getByTestId('library-game-1')).toHaveAttribute('href', '/library/game/1');
        expect(screen.getByTestId('library-games')).toHaveTextContent('Изолированная пешка');
        await act(async () => fireEvent.click(screen.getByTestId('library-next')));
        expect(screen.getByTestId('library-game-51')).toBeInTheDocument();
        expect(mock.mock.calls.some(([u]) => String(u).includes('/collections/2/games?offset=50'))).toBe(true);
    });

    it('поиск по игроку', async () => {
        const mock = stub();
        await act(async () => render(<MemoryRouter><LibraryPage/></MemoryRouter>));
        fireEvent.change(screen.getByTestId('library-player'), {target: {value: 'Botvinnik'}});
        fireEvent.change(screen.getByTestId('library-structure'), {target: {value: 'isolated_pawn'}});
        await act(async () => fireEvent.click(screen.getByTestId('library-search-submit')));
        expect(screen.getByTestId('library-game-99')).toBeInTheDocument();
        expect(mock.mock.calls.some(([u]) => String(u).includes('/games?player=Botvinnik&structure=isolated_pawn'))).toBe(true);
    });

    it('ошибка сети показывается', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline');
        }));
        await act(async () => render(<MemoryRouter><LibraryPage/></MemoryRouter>));
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });
});

describe('библиотека: ссылки из курса и репертуара', () => {
    it('?moves= сразу ищет партии с этим началом, ?structure= — со структурой', async () => {
        const mock = stub();
        await act(async () => render(<MemoryRouter initialEntries={['/library?moves=e2e4%20e7e5&structure=saw']}><LibraryPage/></MemoryRouter>));
        expect(mock.mock.calls.some(([u]) => String(u).includes('/games?structure=saw&moves=e2e4+e7e5'))).toBe(true);
        expect(screen.getByTestId('library-game-99')).toBeInTheDocument();
    });
});
