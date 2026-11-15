// «Угадай ход мастера» (таск 14.3): позиция с контекстом партии, ход игрока, баллы и ход мастера, серия, итог сессии.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {GuessPage} from '../GuessPage';
import {understanding} from '../../../services/guess';

const POSITION = {
    id: 5, game_id: 42, ply: 8, fen: 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5',
    side: 'white', move_number: 5, difficulty: 1500, series_id: 7, series_index: 0, series_length: 2,
    white: 'Legal', black: 'Saint Brie', event: 'Paris', date: '1750',
    previous: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6'], first_previous_ply: 0, last_move: 'g7g6',
};
const ANSWER = {
    score: 100, loss_cp: 0, master_move: 'f3e5', master_san: 'Nxe5',
    lines: [{uci: 'f3e5', san: 'Nxe5', cp: 300}, {uci: 'h2h3', san: 'h3', cp: 50}],
    comment: [], arrows: [], next_id: 6,
};

const cell = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLElement;

async function drag(from: string, to: string) {
    document.elementsFromPoint = vi.fn(() => [cell(to)]);
    await act(async () => {
        fireEvent.pointerDown(cell(from), {button: 0, pointerType: 'mouse', clientX: 5, clientY: 5});
    });
    await act(async () => {
        fireEvent.pointerMove(window, {clientX: 50, clientY: 50});
    });
    await act(async () => {
        fireEvent.pointerUp(window, {clientX: 90, clientY: 90});
    });
}

function stub(routes: Record<string, (init?: RequestInit) => unknown>) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const key = Object.keys(routes).find((path) => String(url).includes(path));
        if (!key) return {ok: false, status: 404, json: async () => ({})} as Response;
        return {ok: true, status: 200, json: async () => routes[key](init)} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function renderPage(path = '/guess') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/guess" element={<GuessPage/>}/>
                <Route path="/guess/:positionId" element={<GuessPage/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Угадай ход мастера', () => {
    it('позиция с контекстом партии, ход — баллы, ход мастера и продолжение серии', async () => {
        const fetchMock = stub({'/guess/next': () => ({position: POSITION}), '/position/5/answer': () => ANSWER});
        renderPage();

        expect(await screen.findByTestId('guess-players')).toHaveTextContent('Legal — Saint Brie, Paris 1750');
        expect(screen.getByText('Ход белых')).toBeInTheDocument();
        expect(screen.getByTestId('guess-series')).toHaveTextContent('Ход 1 из 2 в этой партии');

        await drag('f3', 'e5');
        // Сначала дождаться ответа (запрос уходит асинхронно — под нагрузкой CI его ещё могло не быть), потом проверить тело.
        expect(await screen.findByTestId('guess-score')).toHaveTextContent('100');
        const post = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([, init]) => init?.method === 'POST')!;
        expect(JSON.parse(String(post[1].body))).toEqual({move: 'f3e5'});
        expect(screen.getByText('Как мастер!')).toBeInTheDocument();
        expect(screen.getByText('Ход мастера: Nxe5')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Дальше в партии/})).toBeInTheDocument();
        expect(screen.getByTestId('guess-session')).toHaveTextContent('Баллы: 100 из 100 · точность понимания 100%');
    });

    it('позиции ещё не отобраны — понятное сообщение', async () => {
        stub({'/guess/next': () => ({position: null})});
        renderPage();
        expect(await screen.findByTestId('guess-empty')).toHaveTextContent('Позиции ещё не подготовлены');
    });

    it('конкретная позиция по ссылке из просмотра партии', async () => {
        const fetchMock = stub({'/guess/position/5': () => POSITION});
        renderPage('/guess/5');
        expect(await screen.findByTestId('guess-players')).toBeInTheDocument();
        expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/\/guess\/position\/5$/);
    });

    it('точность понимания — средний балл', () => {
        expect(understanding([])).toBeNull();
        expect(understanding([100, 80, 0])).toBe(60);
    });
});
