// Каталог мастеров прошлого (таск 28.5): список, поиск и порядок, старт отдельной партии с мастером.

import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setLanguage, t} from '../../../i18n';
import {setToken} from '../../../services/authToken';
import {birthYear, matchesQuery, sortMasters} from '../../../services/masters';
import type {Master} from '../../../services/masters';
import {guestName} from '../../../services/timeMachine';
import {MastersPage} from '../MastersPage';

const CONFIG = {target_elo: 2400, aggression: 30};
const MASTERS: Master[] = [
    {id: 'kieseritzky', pgn_name: 'Kieseritzky, Lionel', era: '1806–1853', rating: 1950, events: ['london_1851'],
        openings: {white: ["King's Gambit Accepted: Kieseritzky Gambit"], black: []}},
    {id: 'keres', pgn_name: 'Keres, Paul', era: '1916–1975', rating: 2400, events: ['avro_1938'], openings: {white: [], black: []}},
    {id: 'mucklow', pgn_name: 'Mucklow, James R.', era: null, rating: 1600, events: ['london_1851'], openings: {white: [], black: []}},
];

type Handler = (url: string) => { status?: number; body: unknown } | unknown;

function stub(handler: Handler) {
    const fetchMock = vi.fn(async (url: string) => {
        const reply = handler(String(url));
        const {status = 200, body} = reply && typeof reply === 'object' && 'body' in reply
            ? reply as { status?: number; body: unknown } : {body: reply};
        return {ok: status < 400, status, json: async () => body} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** Доска-заглушка: показывает, с каким состоянием маршрута на неё пришли. */
function Home() {
    const location = useLocation();
    return <pre data-testid="home-state">{JSON.stringify(location.state)}</pre>;
}

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/masters']}>
            <Routes>
                <Route path="/masters" element={<MastersPage/>}/>
                <Route path="/" element={<Home/>}/>
                <Route path="/time-machine" element={<p data-testid="time-machine-opened"/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

const order = () => screen.getAllByRole('listitem').map((item) => item.getAttribute('data-testid'));

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    setLanguage('ru', {persist: false});
    vi.unstubAllGlobals();
});

describe('порядок и поиск', () => {
    const nameOf = (master: Master) => guestName(master.id, t);

    it('год рождения — из годов жизни; без дат — null', () => {
        expect(MASTERS.map(birthYear)).toEqual([1806, 1916, null]);
    });

    it('по силе, по годам жизни (без дат — в конце) и по имени', () => {
        expect(sortMasters(MASTERS, 'strength', nameOf, 'ru').map((m) => m.id)).toEqual(['keres', 'kieseritzky', 'mucklow']);
        expect(sortMasters(MASTERS, 'years', nameOf, 'ru').map((m) => m.id)).toEqual(['kieseritzky', 'keres', 'mucklow']);
        expect(sortMasters(MASTERS, 'name', nameOf, 'ru').map((m) => nameOf(m)))
            .toEqual([...MASTERS.map(nameOf)].sort((a, b) => a.localeCompare(b, 'ru')));
        // Исходный список не меняется.
        expect(MASTERS[0].id).toBe('kieseritzky');
    });

    it('ищет по имени на языке игрока и по латинскому имени из PGN', () => {
        expect(matchesQuery(MASTERS[1], 'Пауль Керес', 'керес')).toBe(true);
        expect(matchesQuery(MASTERS[1], 'Пауль Керес', 'KERES')).toBe(true);
        expect(matchesQuery(MASTERS[1], 'Пауль Керес', '  ')).toBe(true);
        expect(matchesQuery(MASTERS[1], 'Пауль Керес', 'морфи')).toBe(false);
    });
});

describe('страница мастеров', () => {
    it('показывает всех: имя, годы, силу, турниры и фирменный дебют', async () => {
        stub(() => ({guests: MASTERS}));
        renderPage();
        const keres = await screen.findByTestId('master-keres');
        expect(within(keres).getByRole('heading')).toHaveTextContent('Пауль Керес');
        expect(keres).toHaveTextContent('1916–1975');
        expect(keres).toHaveTextContent('сила 2400');
        expect(keres).toHaveTextContent('АВРО 1938');
        expect(screen.queryByTestId('master-opening-keres')).toBeNull();
        expect(screen.getByTestId('master-opening-kieseritzky')).toHaveTextContent('Kieseritzky Gambit');
        expect(screen.getByTestId('master-mucklow')).toHaveTextContent('годы жизни неизвестны');
        expect(screen.getByTestId('masters-count')).toHaveTextContent('3 мастера');
        // По умолчанию — по силе.
        expect(order()).toEqual(['master-keres', 'master-kieseritzky', 'master-mucklow']);
    });

    it('поиск, порядок и «только с фирменным дебютом» меняют список', async () => {
        stub(() => ({guests: MASTERS}));
        renderPage();
        await screen.findByTestId('master-keres');

        fireEvent.change(screen.getByTestId('masters-order'), {target: {value: 'years'}});
        expect(order()).toEqual(['master-kieseritzky', 'master-keres', 'master-mucklow']);

        fireEvent.change(screen.getByTestId('masters-search'), {target: {value: 'mucklow'}});
        expect(order()).toEqual(['master-mucklow']);
        fireEvent.change(screen.getByTestId('masters-search'), {target: {value: 'никто'}});
        expect(screen.getByTestId('masters-empty')).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('masters-search'), {target: {value: ''}});

        fireEvent.click(screen.getByTestId('masters-only-opening'));
        expect(order()).toEqual(['master-kieseritzky']);
        expect(screen.getByTestId('masters-count')).toHaveTextContent('1 мастер');
    });

    it('«Сыграть чёрными» берёт характер мастера и открывает доску с партией', async () => {
        const fetchMock = stub((url) => url.endsWith('/guests/keres')
            ? {id: 'keres', pgn_name: 'Keres, Paul', rating: 2400, config: CONFIG} : {guests: MASTERS});
        renderPage();
        const button = await screen.findByTestId('play-keres-black');
        await act(async () => {
            fireEvent.click(button);
        });
        const state = JSON.parse((await screen.findByTestId('home-state')).textContent ?? 'null');
        // На доске — имя на языке игрока, в архив — латинское имя из PGN.
        expect(state).toEqual({guestGame: {name: 'Пауль Керес', savedName: 'Keres, Paul', config: CONFIG, color: 'black'}});
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/bots/guests/keres'))).toBe(true);
    });

    it('гостю предлагает войти и партию не начинает', async () => {
        setToken(null);
        const fetchMock = stub(() => ({guests: MASTERS}));
        renderPage();
        fireEvent.click(await screen.findByTestId('play-keres-white'));
        expect(screen.getByRole('alert')).toHaveTextContent('Войдите');
        expect(screen.queryByTestId('home-state')).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('ошибки сервера показаны: список не загрузился, характер не пришёл', async () => {
        stub(() => ({status: 500, body: {}}));
        const {unmount} = renderPage();
        expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить мастеров');
        unmount();

        stub((url) => url.endsWith('/guests/keres')
            ? {status: 404, body: {detail: {code: 'guest_not_found', params: {}, message: 'x'}}} : {guests: MASTERS});
        renderPage();
        const button = await screen.findByTestId('play-keres-random');
        await act(async () => {
            fireEvent.click(button);
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('Такого мастера прошлого нет');
        expect(screen.queryByTestId('home-state')).toBeNull();
    });

    it('на английском и украинском — свои имена и подписи', async () => {
        setLanguage('en', {persist: false});
        stub(() => ({guests: MASTERS}));
        const {unmount} = renderPage();
        const keres = await screen.findByTestId('master-keres');
        expect(keres).toHaveTextContent('Paul Keres');
        expect(keres).toHaveTextContent('strength 2400');
        unmount();
        setLanguage('uk', {persist: false});
        renderPage();
        expect(await screen.findByTestId('master-mucklow')).toHaveTextContent('роки життя невідомі');
    });
});

describe('карточка одного мастера (переход «к сопернику» из турнира)', () => {
    it('/masters?master=<id> показывает только его и ссылку на всех', async () => {
        stub(() => ({guests: MASTERS}));
        render(<MemoryRouter initialEntries={['/masters?master=keres']}>
            <Routes><Route path="/masters" element={<MastersPage/>}/></Routes>
        </MemoryRouter>);
        expect(await screen.findByTestId('master-keres')).toBeInTheDocument();
        expect(screen.queryByTestId('master-kieseritzky')).toBeNull();
        expect(screen.getByTestId('masters-all')).toHaveAttribute('href', '/masters');
    });
});
