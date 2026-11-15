// Игра вслепую (таск 19.5): видимость по ступеням, ход нотацией, подсмотр; на доске — партия с ботом вслепую.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {Chess} from 'chess.js';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {armBlindfold, getBlindfold, parseMoveInput, peek, startBlindfold, stopBlindfold, visibleSquares} from '../blindfold';
import Chessboard from '../../components/Chessboard';
import {resetBotCatalogCache} from '../../services/botCatalog';
import {setToken} from '../../services/authToken';
import {mockFetchRouter} from '../../test/mocks';

vi.mock('../../services/gameSocket', () => ({gameSocket: {connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), on: vi.fn(), off: vi.fn()}}));
vi.mock('../../services/soundEngine', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/soundEngine')>()),
    soundEngine: {play: vi.fn(), isMuted: vi.fn(() => false), toggleMute: vi.fn(() => true)},
}));

beforeEach(() => {
    localStorage.clear();
    armBlindfold(0);
    stopBlindfold();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setToken(null);
});

describe('вслепую: правила', () => {
    const game = new Chess();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) game.move(san);
    const board = game.board();
    const history = game.history({verbose: true});

    it('ступени: свои фигуры / последние ходы / пешки / ничего', () => {
        const own = visibleSquares(1, board, history, 'w');
        expect(own.has('e1') && own.has('f3') && !own.has('e8')).toBe(true);
        expect([...visibleSquares(2, board, history, 'w')].sort()).toEqual(['a6', 'b5', 'c6', 'f3']);   // 4 последних полухода
        const pawns = visibleSquares(3, board, history, 'w');
        expect(pawns.has('e4') && pawns.has('a6') && !pawns.has('b5')).toBe(true);
        expect(visibleSquares(4, board, history, 'w').size).toBe(0);
        expect(visibleSquares(0, board, history, 'w').size).toBe(32);
    });

    it('ход нотацией: SAN, рокировка нулями, UCI, превращение; нелегальный — null', () => {
        const moves = new Chess().moves({verbose: true});
        expect(parseMoveInput(moves, 'Nf3')).toEqual({from: 'g1', to: 'f3', promotion: undefined});
        expect(parseMoveInput(moves, 'nf3')).toEqual({from: 'g1', to: 'f3', promotion: undefined});
        expect(parseMoveInput(moves, 'e2e4')).toEqual({from: 'e2', to: 'e4', promotion: undefined});
        expect(parseMoveInput(moves, 'e2-e4+')).toEqual({from: 'e2', to: 'e4', promotion: undefined});
        expect(parseMoveInput(moves, 'Ke2')).toBeNull();
        expect(parseMoveInput(moves, '')).toBeNull();
        const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1').moves({verbose: true});
        expect(parseMoveInput(castle, '0-0')).toEqual({from: 'e1', to: 'g1', promotion: undefined});
        const promo = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1').moves({verbose: true});
        expect(parseMoveInput(promo, 'a8=N')).toEqual({from: 'a7', to: 'a8', promotion: 'n'});
        expect(parseMoveInput(promo, 'a7a8')).toEqual({from: 'a7', to: 'a8', promotion: 'q'});
    });

    it('подсмотр считается, повторный во время подсмотра — нет; без рейтинга не включается', () => {
        armBlindfold(2);
        startBlindfold(false);
        expect(getBlindfold().level).toBe(0);
        startBlindfold(true);
        expect(getBlindfold().level).toBe(2);
        peek(1000);
        peek(2000);
        expect(getBlindfold().peeks).toBe(1);
        peek(5000);
        expect(getBlindfold().peeks).toBe(2);
    });
});

describe('вслепую: партия с ботом', () => {
    it('фигуры скрыты, ход нотацией, подсмотр открывает доску, в архив — ступень и подсмотры', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        resetBotCatalogCache();
        setToken('test-token');
        const fetchMock = mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
            '/bots/move': () => ({uci: 'e7e5', san: 'e5', fen_after: '', source: 'book', comment: '', thinking_time_ms: 10}),
            '/bots/save-game': () => ({game_id: 5, status: 'finished', result: '0-1'}),
        });
        vi.stubGlobal('fetch', fetchMock);
        armBlindfold(4);
        render(<MemoryRouter><Chessboard/></MemoryRouter>);
        const start = await screen.findByRole('button', {name: /Белыми/});
        await act(async () => fireEvent.click(start));
        expect(screen.getByTestId('blindfold-panel')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-hidden="true"]').length).toBe(32);

        fireEvent.change(screen.getByTestId('blindfold-move-input'), {target: {value: 'e4'}});
        await act(async () => fireEvent.submit(screen.getByTestId('blindfold-move-input').closest('form')!));
        expect(screen.getByText('e4')).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByTestId('blindfold-peek')));
        expect(document.querySelectorAll('[data-hidden="true"]').length).toBe(0);
        expect(screen.getByTestId('blindfold-peeks')).toHaveTextContent('Подсмотров: 1');
        fireEvent.click(screen.getByTestId('blindfold-hide-moves'));
        expect(screen.queryByText('e4')).toBeNull();

        // Сдача — партия сохраняется с пометкой «вслепую».
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        await act(async () => fireEvent.click(screen.getByRole('button', {name: /Сдаться/})));
        const save = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => String(url).includes('/bots/save-game'));
        expect(JSON.parse(String(save![1].body))).toMatchObject({blindfold: 4, peeks: 1});
    });
});
