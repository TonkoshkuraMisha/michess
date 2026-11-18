// Конференции (таск 33.6): Кубок сезона, выбор страны с подсказкой, правило одной смены за сезон; зачёт на странице арены;
// матчи конференций — список на странице и счёт с досками на странице матча.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {countryName, localeCountry} from '../../../services/conferences';
import {ArenaPage} from '../ArenaPages';
import {ConferencesPage} from '../ConferencesPage';
import {matchScore} from '../ConferenceMatches';

const TABLE = [
    {conference: 'central', score: 42, arenas: 3}, {conference: 'eastern', score: 12, arenas: 2},
    {conference: 'western', score: 0, arenas: 0}, {conference: 'northern', score: 0, arenas: 0},
    {conference: 'southern', score: 0, arenas: 0},
];
const PAGE = {
    season: '2026-11', top_players: 10, table: TABLE, conferences: [],
    countries: {UA: 'central', PL: 'central', DE: 'northern', US: 'western', IN: 'eastern', IT: 'southern'},
    suggested_country: null, me: null,
};

function page() {
    return render(<MemoryRouter><ConferencesPage/></MemoryRouter>);
}

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('страница конференций', () => {
    it('кубок сезона: пять конференций по очкам, своя выделена', async () => {
        const me = {country: 'IN', conference: 'eastern', can_change: true};
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({...PAGE, me})} as Response)));
        page();
        expect(await screen.findByText('Кубок конференций, сезон 2026-11')).toBeInTheDocument();
        const rows = screen.getAllByTestId(/^cup-/);
        expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(
            ['cup-central', 'cup-eastern', 'cup-western', 'cup-northern', 'cup-southern']);
        expect(rows[0]).toHaveTextContent('Центральная конференция');
        expect(rows[0]).toHaveTextContent('42');
        expect(rows[1].className).toContain('font-bold');
        expect(screen.getByTestId('my-conference')).toHaveTextContent('Ваша конференция: Восточная конференция');
        expect(screen.getByTestId('country-select')).toHaveValue('IN');
    });

    it('подсказка страны только предлагается; сохранение отправляет выбранную страну', async () => {
        let me: Record<string, unknown> = {country: null, conference: null, can_change: true};
        const sent: unknown[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (String(url).endsWith('/me')) {
                sent.push([init?.method, JSON.parse(String(init?.body))]);
                me = {country: 'UA', conference: 'central', can_change: true};
                return {ok: true, status: 200, json: async () => me} as Response;
            }
            return {ok: true, status: 200, json: async () => ({...PAGE, suggested_country: 'UA', me})} as Response;
        }));
        page();
        expect(await screen.findByTestId('my-conference')).toHaveTextContent('Страна не указана');
        expect(screen.getByTestId('country-suggestion')).toHaveTextContent('Похоже, ваша страна — Украина.');
        expect(screen.getByTestId('country-save')).toBeDisabled();
        expect(sent).toEqual([]);                                        // подсказка сама ничего не отправляет

        fireEvent.click(screen.getByTestId('country-use-suggested'));
        expect(screen.getByTestId('country-select')).toHaveValue('UA');
        expect(screen.getByTestId('country-preview')).toHaveTextContent('Эта страна играет за: Центральная конференция');
        await act(async () => fireEvent.click(screen.getByTestId('country-save')));
        expect(sent).toEqual([['PUT', {country: 'UA'}]]);
        expect(await screen.findByText('Ваша конференция: Центральная конференция')).toBeInTheDocument();
        expect(screen.queryByTestId('country-suggestion')).toBeNull();
    });

    it('смена в сезоне уже использована — об этом сказано; отказ сервера виден; страну можно убрать', async () => {
        const sent: unknown[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (String(url).endsWith('/me')) {
                const body = JSON.parse(String(init?.body));
                sent.push(body);
                if (body.country) {
                    return {ok: false, status: 409, json: async () => ({detail: {code: 'country_change_too_soon',
                        message: 'x', params: {season: '2026-11'}}})} as Response;
                }
                return {ok: true, status: 200, json: async () => ({country: null, conference: null, can_change: false})} as Response;
            }
            return {ok: true, status: 200, json: async () => ({...PAGE,
                me: {country: 'DE', conference: 'northern', can_change: false}})} as Response;
        }));
        page();
        expect(await screen.findByText(/В этом сезоне вы уже меняли конференцию/)).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('country-select'), {target: {value: 'IT'}});
        await act(async () => fireEvent.click(screen.getByTestId('country-save')));
        expect(await screen.findByRole('alert')).toHaveTextContent('Сменить конференцию можно один раз за сезон');
        await act(async () => fireEvent.click(screen.getByTestId('country-remove')));
        expect(sent).toEqual([{country: 'IT'}, {country: null}]);
    });

    it('гость видит кубок и приглашение войти', async () => {
        setToken(null);
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => PAGE} as Response)));
        page();
        expect(await screen.findByTestId('conference-cup')).toBeInTheDocument();
        expect(screen.getByTestId('my-country')).toHaveTextContent('Войдите, чтобы указать страну');
        expect(screen.queryByTestId('country-select')).toBeNull();
    });

    it('названия стран — от браузера на языке интерфейса; страна из языка браузера', () => {
        expect(countryName('UA', 'ru')).toBe('Украина');
        expect(countryName('UA', 'uk')).toBe('Україна');
        expect(countryName('DE', 'en')).toBe('Germany');
        expect(localeCountry(['uk-UA', 'en'])).toBe('UA');
        expect(localeCountry(['en', 'pt-br'])).toBe('BR');
        expect(localeCountry(['en', 'uk'])).toBeNull();
    });
});

describe('зачёт конференций на странице арены', () => {
    it('конференция у игрока в таблице и очки конференций под ней', async () => {
        const arena = {
            id: 3, schedule_key: 'western:blitz-3+2', conference: 'western', base_time_ms: 180000, increment_ms: 2000,
            starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 40 * 60_000).toISOString(), status: 'running',
            standings: [
                {place: 1, username: 'misha', score: 6, games: 3, wins: 3, fire: true, rating: 1500, conference: 'central'},
                {place: 2, username: 'guest', score: 2, games: 3, wins: 1, fire: false, rating: 1500, conference: null},
            ],
            conferences: [{conference: 'central', score: 6, counted: 1, players: 1}],
            me: null,
        };
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => arena} as Response)));
        render(
            <MemoryRouter initialEntries={['/arenas/3']}>
                <Routes><Route path="/arenas/:arenaId" element={<ArenaPage/>}/></Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByTestId('arena-conf-misha')).toHaveTextContent('Центр');
        expect(screen.queryByTestId('arena-conf-guest')).toBeNull();
        const table = screen.getByTestId('arena-conferences');
        expect(table).toHaveTextContent('Центральная конференция');
        expect(table).toHaveTextContent('1/1');
    });
});

describe('матчи конференций', () => {
    it('счёт записывается с половинками', () => {
        expect([0, 0.5, 1, 1.5, 4].map(matchScore)).toEqual(['0', '½', '1', '1½', '4']);
    });

    it('список матчей на странице конференций: сыгранный со счётом, ближайший — со временем', async () => {
        const matches = [
            {arena_id: 7, home: 'central', guest: 'western', starts_at: '2026-11-14T17:00:00Z', status: 'finished',
                home_score: 1.5, guest_score: 2.5, players: 4},
            {arena_id: 8, home: 'northern', guest: 'eastern', starts_at: '2026-11-21T17:00:00Z', status: 'scheduled',
                home_score: 0, guest_score: 0, players: 3},
        ];
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({...PAGE, matches})} as Response)));
        page();
        const played = await screen.findByTestId('match-7');
        expect(played).toHaveAttribute('href', '/arenas/7');
        expect(played).toHaveTextContent('Центральная конференция — Западная конференция');
        expect(played).toHaveTextContent('1½ : 2½');
        expect(screen.getByTestId('match-8')).not.toHaveTextContent('0 : 0');
    });

    it('страница матча: счёт и доски вместо таблицы, запись закрыта — кнопки входа нет', async () => {
        const seat = (username: string, score: number) => ({username, rating: 1500, score});
        const arena = {
            id: 7, format: 'match', conference: 'central', opponent_conference: 'western', rounds: 2, current_round: 2,
            base_time_ms: 300000, increment_ms: 3000, starts_at: new Date().toISOString(),
            ends_at: new Date(Date.now() + 3600_000).toISOString(), status: 'running', standings: [], conferences: [],
            me: {joined: false, waiting: false, current_game_id: null},
            match: {home: 'central', guest: 'western', home_score: 1.5, guest_score: 0.5, home_players: 2, guest_players: 3,
                entry_open: false, boards: [{board: 1, home: seat('misha', 1), guest: seat('magnus', 0)},
                    {board: 2, home: seat('olga', 0.5), guest: seat('hikaru', 0.5)}]},
        };
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => arena} as Response)));
        render(
            <MemoryRouter initialEntries={['/arenas/7']}>
                <Routes><Route path="/arenas/:arenaId" element={<ArenaPage/>}/></Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByTestId('match-score')).toHaveTextContent('1½ : ½');
        expect(screen.getByText('Матч Центральная конференция — Западная конференция')).toBeInTheDocument();
        expect(screen.getByTestId('match-board-2')).toHaveTextContent('olga');
        expect(screen.queryByTestId('arena-standings')).toBeNull();
        expect(screen.queryByTestId('arena-join')).toBeNull();
        expect(screen.queryByTestId('arena-play')).toBeNull();
    });
});
