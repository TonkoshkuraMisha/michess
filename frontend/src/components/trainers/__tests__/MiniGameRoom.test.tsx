// Игры тренеров с человеком по сети (таск 19.8): ссылка для соперника, вход по ссылке, ход с версией комнаты, ход
// соперника виден по опросу, сдача и «ещё раз» с переходом в новую комнату; кнопка на странице игры создаёт комнату.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MiniGameRoomPage, POLL_MS} from '../MiniGameRoom';
import {MiniGamePage} from '../MiniGames';
import {setToken} from '../../../services/authToken';
import type {MiniRoom} from '../../../services/miniGameRooms';

const START = '8/pppppppp/8/8/8/8/PPPPPPPP/8 w - - 0 1';
const room = (over: Partial<MiniRoom> = {}): MiniRoom => ({
    code: 'abc12345', game_id: 'pawn_war', fen: START, moves: [], result: null, reason: null, version: 0, next: null,
    white: 'misha', black: 'olga', you: 'white', waiting: false, ...over,
});

function Where() {
    return <pre data-testid="where">{useLocation().pathname}</pre>;
}

const page = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/train/games/:gameId" element={<MiniGamePage/>}/>
            <Route path="/train/games/room/:code" element={<><MiniGameRoomPage/><Where/></>}/>
        </Routes>
    </MemoryRouter>,
);
const click = (square: string) => fireEvent.click(document.querySelector(`[data-square="${square}"]`)!);

beforeEach(() => {
    setToken('jwt');
    vi.useFakeTimers({shouldAdvanceTime: true});
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setToken(null);
});

describe('игра тренера с другом по ссылке', () => {
    it('создатель ждёт соперника и видит ссылку; гость садится играть', async () => {
        let state = room({black: null, waiting: true});
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (String(url).endsWith('/join')) state = room();
            return {ok: true, json: async () => state} as Response;
        }));
        page('/train/games/room/abc12345');
        expect(await screen.findByTestId('mini-room-invite')).toHaveTextContent('Отправьте ссылку');
        expect(screen.getByDisplayValue(/\/train\/games\/room\/abc12345$/)).toBeInTheDocument();
        expect(screen.getByTestId('mini-room-status')).toHaveTextContent('Ждём соперника');

        state = room({black: null, waiting: true, you: null});
        await act(async () => vi.advanceTimersByTime(POLL_MS));
        await act(async () => fireEvent.click(await screen.findByTestId('mini-room-join')));
        expect(screen.getByTestId('mini-room-status')).toHaveTextContent('Ваш ход');
    });

    it('ход уходит с версией; ход соперника приходит опросом; сдача и «ещё раз»', async () => {
        let state = room();
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (u.endsWith('/move')) state = room({fen: '8/pppppppp/8/8/4P3/8/PPPP1PPP/8 b - - 0 1', moves: ['e2e4'], version: 1});
            if (u.endsWith('/resign')) state = {...state, result: '0-1', reason: 'resign'};
            if (u.endsWith('/rematch') || u.endsWith('/next0001')) {
                return {ok: true, json: async () => room({code: 'next0001', you: 'black'})} as Response;
            }
            return {ok: true, json: async () => state, method: init?.method} as unknown as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        page('/train/games/room/abc12345');
        expect(await screen.findByTestId('mini-room-status')).toHaveTextContent('Ваш ход');
        click('e2');
        await act(async () => click('e4'));
        const sent = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/move')) as unknown as [string, RequestInit];
        expect(JSON.parse(String(sent[1].body))).toEqual({move: 'e2e4', version: 0});
        expect(screen.getByTestId('mini-room-status')).toHaveTextContent('Ход соперника');

        // Соперник ответил — страница узнаёт об этом при следующем опросе.
        state = room({fen: '8/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/8 w - - 0 2', moves: ['e2e4', 'd7d6'], version: 2});
        await act(async () => vi.advanceTimersByTime(POLL_MS));
        expect(screen.getByTestId('mini-room-status')).toHaveTextContent('Ваш ход');

        await act(async () => fireEvent.click(screen.getByTestId('mini-room-resign')));
        expect(screen.getByTestId('mini-room-status')).toHaveTextContent('Победа чёрных! (сдача)');
        await act(async () => fireEvent.click(screen.getByTestId('mini-room-rematch')));
        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/train/games/room/next0001'));
    });

    it('кнопка «С другом по ссылке» на странице игры создаёт комнату и ведёт в неё', async () => {
        const fetchMock = vi.fn(async (url: string) => ({ok: true, json: async () => (String(url).includes('mini-game-rooms')
            ? room({code: 'made0001', black: null, waiting: true}) : {fen: START, result: null, bot_move: null})} as Response));
        vi.stubGlobal('fetch', fetchMock);
        page('/train/games/pawn_war');
        await act(async () => fireEvent.click(screen.getByTestId('mini-mode-online')));
        const created = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/mini-game-rooms')) as unknown as [string, RequestInit];
        expect(JSON.parse(String(created[1].body))).toEqual({game_id: 'pawn_war', color: 'random'});
        expect(await screen.findByTestId('where')).toHaveTextContent('/train/games/room/made0001');
    });
});
