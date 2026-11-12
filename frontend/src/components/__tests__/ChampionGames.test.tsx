// --- FILE: frontend/src/components/__tests__/ChampionGames.test.tsx ---
// Архив партий чемпиона: карточка, результаты с точки зрения чемпиона (белыми и чёрными), даты из
// PGN, переход к разбору партии, скачивание PGN, пагинация и ошибки.

import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation, useParams} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import ChampionGames, {isChampionName} from '../ChampionGames';

const game = (id: number, white: string, black: string, result: string, extra: Record<string, unknown> = {}) => ({
    game_id: id,
    white_username: white,
    white_rating: 2600,
    black_username: black,
    black_rating: 2600,
    status: 'COMPLETED',
    is_rated: false,
    result,
    pgn_date: '1960.05.07',
    site: 'Moscow',
    eco: 'B10',
    finished_at: null,
    ...extra,
});

const TAL_GAMES = [
    game(1, 'Tal, Mikhail', 'Botvinnik, Mikhail', '1-0'),                 // белыми — победа
    game(2, 'Botvinnik, Mikhail', 'Tal, Mikhail', '1-0'),                 // чёрными — поражение
    game(3, 'Tseshkovsky, Vitaly', 'Tal, Mikhail', '0-1'),                // чёрными — победа («Vitaly» ≠ Tal)
    game(4, 'TAL, M.', 'Smyslov, Vassily', '0-1', {pgn_date: '1860.??.??'}),  // белыми — поражение
    game(5, 'Tal, Mikhail', 'Petrosian, Tigran', '1/2-1/2', {pgn_date: '????.??.??', finished_at: '2026-11-01T12:00:00Z'}),
    game(6, 'Spassky, Boris', 'Tal, Mikhail', '1/2-1/2', {pgn_date: null, site: null, eco: null}),
];

type Reply = { ok: boolean; status?: number; body?: unknown };

function stubGames(reply: (url: string) => Reply) {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const r = reply(input.toString());
        return {ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const okPage = (total: number, items = TAL_GAMES) => () => ({ok: true, body: {total, items}});
const urls = (fetchMock: ReturnType<typeof stubGames>) => fetchMock.mock.calls.map(([url]) => url.toString());

function GameStub() {
    const {id} = useParams();
    const location = useLocation();
    return <div>Партия {id} ({(location.state as any)?.game?.white_username})</div>;
}

function renderChampion(path = '/champions/Tal') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/champions/:championId" element={<ChampionGames/>}/>
                <Route path="/game/:id" element={<GameStub/>}/>
                <Route path="/" element={<div>Главная</div>}/>
            </Routes>
        </MemoryRouter>,
    );
}

const rows = () => screen.getAllByRole('row').slice(1);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isChampionName', () => {
    it.each([
        ['Tal, Mikhail', true],
        ['TAL, M.', true],
        ['tal', true],
        ['Tseshkovsky, Vitaly', false],
        ['Natalia Pogonina', false],
        ['Botvinnik, Mikhail', false],
    ])('%s → %s', (username, expected) => {
        expect(isChampionName(username, 'Tal')).toBe(expected);
    });

    it('работает с кириллицей и составными фамилиями', () => {
        expect(isChampionName('Дин Лижэнь', 'Дин')).toBe(true);
        expect(isChampionName('Ding Liren', 'Ding')).toBe(true);
    });
});

describe('ChampionGames', () => {
    it('показывает карточку чемпиона и число партий в базе', async () => {
        stubGames(okPage(130));
        renderChampion();

        expect(screen.getByRole('heading', {name: 'Михаил Таль'})).toBeInTheDocument();
        expect(screen.getByText('1960–1961')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText(/Партий в базе/).textContent).toContain('130'));
    });

    it('считает результат с точки зрения чемпиона — белыми и чёрными, без учёта регистра', async () => {
        stubGames(okPage(6));
        renderChampion();
        await screen.findByText('Tseshkovsky, Vitaly');

        const results = rows().map((row) => within(row).getAllByRole('cell')[3].textContent);
        expect(results).toEqual([
            'Победа (1-0)', 'Поражение (1-0)', 'Победа (0-1)', 'Поражение (0-1)', 'Ничья (1/2-1/2)', 'Ничья (1/2-1/2)',
        ]);
    });

    it('форматирует даты PGN: неизвестные части убираются, иначе — дата завершения или прочерк', async () => {
        stubGames(okPage(6));
        renderChampion();
        await screen.findByText('Tseshkovsky, Vitaly');

        const dates = rows().map((row) => within(row).getAllByRole('cell')[6].textContent);
        expect(dates).toEqual(['1960.05.07', '1960.05.07', '1960.05.07', '1860', '1 нояб. 2026', '—']);
        expect(within(rows()[5]).getAllByRole('cell')[4].textContent).toBe('—');  // нет кода дебюта
    });

    it('клик по строке открывает разбор партии и передаёт её данные', async () => {
        stubGames(okPage(6));
        renderChampion();

        fireEvent.click(await screen.findByText('Tseshkovsky, Vitaly'));

        expect(await screen.findByText('Партия 3 (Tseshkovsky, Vitaly)')).toBeInTheDocument();
    });

    it('скачивание PGN не открывает разбор партии', async () => {
        stubGames(okPage(6));
        renderChampion();
        const links = await screen.findAllByTitle('Скачать PGN');
        expect(links[0].getAttribute('href')).toMatch(/\/api\/v1\/profile\/games\/1\/pgn$/);

        // Настоящая загрузка файла в jsdom не нужна — отменяем переход по ссылке до браузера.
        const cancelNavigation = (e: Event) => e.preventDefault();
        window.addEventListener('click', cancelNavigation, true);
        fireEvent.click(links[0]);
        window.removeEventListener('click', cancelNavigation, true);

        expect(screen.queryByText(/^Партия 1/)).not.toBeInTheDocument();
        expect(screen.getByRole('heading', {name: 'Михаил Таль'})).toBeInTheDocument();
    });

    it('пагинация: соседние страницы, начало и конец, нумерация строк', async () => {
        const fetchMock = stubGames(okPage(130));
        renderChampion();
        await screen.findByText('Tseshkovsky, Vitaly');

        expect(urls(fetchMock).at(-1)).toMatch(/\/profile\/Tal\/games\?limit=25&offset=0&sort=asc$/);
        expect(screen.getByRole('button', {name: 'В начало'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Предыдущая страница'})).toBeDisabled();

        fireEvent.click(screen.getByRole('button', {name: 'Следующая страница'}));
        await waitFor(() => expect(urls(fetchMock).at(-1)).toContain('limit=25&offset=25'));
        expect(screen.getByRole('button', {name: '2'})).toHaveAttribute('aria-current', 'page');
        await waitFor(() => expect(within(rows()[0]).getAllByRole('cell')[0].textContent).toBe('26'));

        fireEvent.click(screen.getByRole('button', {name: 'В конец'}));
        await waitFor(() => expect(urls(fetchMock).at(-1)).toContain('offset=125'));
        expect(screen.getByRole('button', {name: 'Следующая страница'})).toBeDisabled();
        expect(screen.getByRole('button', {name: '6'})).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('button', {name: '4'}));
        await waitFor(() => expect(urls(fetchMock).at(-1)).toContain('offset=75'));

        fireEvent.click(screen.getByRole('button', {name: 'В начало'}));
        await waitFor(() => expect(urls(fetchMock).at(-1)).toContain('offset=0'));
    });

    it('смена размера страницы на 50 возвращает на первую страницу', async () => {
        const fetchMock = stubGames(okPage(130));
        renderChampion();
        await screen.findByText('Tseshkovsky, Vitaly');
        fireEvent.click(screen.getByRole('button', {name: 'В конец'}));
        await waitFor(() => expect(urls(fetchMock).at(-1)).toContain('offset=125'));

        fireEvent.change(screen.getByLabelText('Партий на странице'), {target: {value: '50'}});

        await waitFor(() => expect(urls(fetchMock).at(-1)).toContain('limit=50&offset=0'));
        expect(screen.getByRole('button', {name: '1'})).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', {name: '3'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: '4'})).not.toBeInTheDocument();
    });

    it('пустая страница архива', async () => {
        stubGames(okPage(0, []));
        renderChampion();
        expect(await screen.findByText('В архиве нет записей для этой страницы.')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'В конец'})).not.toBeInTheDocument();
    });

    it('неизвестный чемпион — ошибка и ссылка на главную', async () => {
        stubGames(okPage(0, []));
        renderChampion('/champions/Nobody');

        expect(screen.getByText(/Игрок с идентификатором Nobody не найден/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('link', {name: 'На главную'}));
        expect(await screen.findByText('Главная')).toBeInTheDocument();
    });

    it('ошибка сервера показывает его текст', async () => {
        stubGames(() => ({ok: false, status: 503, body: {detail: 'База партий временно недоступна'}}));
        renderChampion();

        expect(await screen.findByText('Ошибка загрузки')).toBeInTheDocument();
        expect(screen.getByText('База партий временно недоступна')).toBeInTheDocument();
    });

    it('ошибка валидации со списком detail не роняет страницу', async () => {
        stubGames(() => ({
            ok: false, status: 422,
            body: {detail: [{type: 'less_than_equal', loc: ['query', 'limit'], msg: '…', params: {le: 100}}]},
        }));
        renderChampion();

        expect(await screen.findByText('limit: должно быть не больше 100')).toBeInTheDocument();
    });

    it('ответ без тела — текст по умолчанию', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 500, json: async () => {
                throw new Error('not json');
            },
        }) as unknown as Response));
        renderChampion();

        expect(await screen.findByText('Не удалось загрузить партии из базы данных')).toBeInTheDocument();
    });
});
