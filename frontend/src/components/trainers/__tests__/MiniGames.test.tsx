// Игры тренеров (таск 19.8): список, ход щелчками уходит на сервер, ответ бота, итог, ошибка хода, игра за чёрных.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {MINI_GAMES, MiniGamePage, MiniGamesPage} from '../MiniGames';

afterEach(() => vi.unstubAllGlobals());

const page = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/train/games" element={<MiniGamesPage/>}/>
            <Route path="/train/games/:gameId" element={<MiniGamePage/>}/>
        </Routes>
    </MemoryRouter>,
);
const click = (square: string) => fireEvent.click(document.querySelector(`[data-square="${square}"]`)!);

describe('игры тренеров', () => {
    it('список — пять игр со ссылками', () => {
        page('/train/games');
        expect(MINI_GAMES.map((id) => screen.getByTestId(`mini-${id}`).getAttribute('href'))).toEqual(MINI_GAMES.map((id) => `/train/games/${id}`));
    });

    it('ход щелчками — на сервер; бот отвечает; итог', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init!.body));
            const won = body.move === 'a7a8';
            return {ok: true, json: async () => (won
                ? {fen: 'Q7/8/8/8/8/8/8/8 b - - 0 1', result: '1-0', bot_move: null}
                : {fen: '8/pppppppp/8/8/4P3/8/PPPP1PPP/8 w - - 0 2', result: null, bot_move: 'd7d6'})} as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        page('/train/games/pawn_war');
        expect(screen.getByTestId('mini-status')).toHaveTextContent('Ход белых');
        click('e2');
        await act(async () => click('e4'));
        expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({move: 'e2e4', bot: true});
        expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('/mini-games/pawn_war/move');
        click('a7');
        await act(async () => click('a8'));
        expect(screen.getByTestId('mini-status')).toHaveTextContent('Победа белых!');
    });

    it('вдвоём — без бота; за чёрных — первым ходит бот; ошибка хода показывается', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (String(url).endsWith('/bot-first')) {
                return {ok: true, json: async () => ({fen: '4k3/pppppppp/8/8/4P3/8/PPPP1PPP/4K3 b - - 0 1', result: null, bot_move: 'e2e4'})} as Response;
            }
            return {ok: false, status: 400, json: async () => ({detail: {code: 'mini_game_illegal_move', message: 'x'}})} as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        page('/train/games/capture_flag');
        fireEvent.click(screen.getByTestId('mini-mode-hotseat'));
        click('e2');
        await act(async () => click('e5'));
        expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).bot).toBe(false);
        expect(screen.getByRole('alert')).toHaveTextContent('По правилам игры так ходить нельзя');
        await act(async () => fireEvent.click(screen.getByTestId('mini-mode-bot-black')));
        expect(screen.getByTestId('mini-status')).toHaveTextContent('Ход чёрных');
    });

    it('неизвестная игра — сообщение', () => {
        page('/train/games/chess960');
        expect(screen.getByText('Такой игры нет.')).toBeInTheDocument();
    });
});
