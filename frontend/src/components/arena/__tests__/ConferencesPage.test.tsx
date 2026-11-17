// Конференции (таск 33.6): Кубок сезона, выбор страны с подсказкой, правило одной смены за сезон; зачёт на странице арены.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {countryName, localeCountry} from '../../../services/conferences';
import {ArenaPage} from '../ArenaPages';
import {ConferencesPage} from '../ConferencesPage';

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
