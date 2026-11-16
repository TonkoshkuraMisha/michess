// Партия Фишера с человеком (21.3): ходы по WebSocket, рокировка «король на свою ладью», ничья и итог.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Chess960LiveGame, displayFen, sansOf} from '../Chess960LiveGame';
import {setToken} from '../../../services/authToken';

const handlers = new Map<string, (data: any) => void>();
vi.mock('../../../services/gameSocket', () => ({
    gameSocket: {
        connect: vi.fn(),
        send: vi.fn(),
        on: vi.fn((event: string, cb: (data: any) => void) => handlers.set(event, cb)),
        off: vi.fn((event: string) => handlers.delete(event)),
    },
}));
import {gameSocket} from '../../../services/gameSocket';

// Обычная расстановка по правилам 960 после 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5: белые могут рокироваться (e1 → h1).
const FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w HAha - 6 4';
const PGN = '[Variant "Chess960"]\n[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1"]\n\n'
    + '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5';
const MATCH = {
    event: 'match_found', variant: 'chess960', game_id: 42, color: 'white', opponent_id: 2,
    white_username: 'alice', white_rating: 1500, black_username: 'bob', black_rating: 1480,
    white_time_ms: 180000, black_time_ms: 180000, base_time_ms: 180000, fen: FEN, pgn: PGN, state_version: 6,
};

const cell = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLElement;

function renderPage(match: object | null = MATCH) {
    return render(
        <MemoryRouter initialEntries={[{pathname: '/play/960/live', state: match ? {match} : null}]}>
            <Routes><Route path="/play/960/live" element={<Chess960LiveGame/>}/></Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    handlers.clear();
    vi.mocked(gameSocket.send).mockClear();
});

describe('помощники', () => {
    it('ходы из PGN и позиция для доски без прав на рокировку', () => {
        expect(sansOf(PGN)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
        expect(sansOf('[FEN "x"]\n\n1. e4 e5 2. O-O 1-0')).toEqual(['e4', 'e5', 'O-O']);
        expect(displayFen(FEN).split(' ')[2]).toBe('-');
    });
});

describe('партия 960 с человеком', () => {
    it('рокировка щелчком по королю и своей ладье, ответ сервера обновляет доску', async () => {
        renderPage();
        expect(screen.getByTestId('c960-live-status')).toHaveTextContent('Ваш ход');
        expect(screen.getByTestId('c960-live-moves')).toHaveTextContent('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5');
        fireEvent.click(cell('e1'));
        fireEvent.click(cell('h1'));
        expect(gameSocket.send).toHaveBeenCalledWith('make_move', expect.objectContaining({
            game_id: 42, move: 'e1h1', state_version: 6, is_premove: false,
        }));
        await act(async () => handlers.get('move_made')!({
            game_id: 42, move: 'e1h1', state_version: 7, white_time_ms: 175000, black_time_ms: 180000,
            fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b ha - 7 4', pgn: `${PGN} 4. O-O`,
        }));
        expect(screen.getByTestId('c960-live-status')).toHaveTextContent('Ход соперника');
        expect(screen.getByTestId('c960-live-moves')).toHaveTextContent('4. O-O');
    });

    it('ничья: предложение соперника, принять; итог партии', async () => {
        renderPage();
        await act(async () => handlers.get('draw_offered')!({game_id: 42}));
        fireEvent.click(screen.getByText('Принять'));
        expect(gameSocket.send).toHaveBeenCalledWith('accept_draw', {game_id: 42});
        await act(async () => handlers.get('game_over')!({game_id: 42, result: '1/2-1/2', reason: 'agreement'}));
        expect(screen.getByTestId('c960-live-again')).toBeInTheDocument();
        expect(screen.queryByTestId('c960-live-resign')).toBeNull();
    });

    it('события чужой партии не трогают доску; без партии — подсказка, как начать', async () => {
        renderPage();
        await act(async () => handlers.get('move_made')!({game_id: 99, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', pgn: ''}));
        expect(screen.getByTestId('c960-live-moves')).toHaveTextContent('3. Bc4 Bc5');
        renderPage(null);
        expect(screen.getByTestId('c960-live-empty')).toHaveTextContent('Партии 960 сейчас нет');
    });

    it('переподключение: match_found партии 960 восстанавливает доску', async () => {
        renderPage(null);
        await act(async () => handlers.get('match_found')!(MATCH));
        expect(screen.getByTestId('c960-live')).toBeInTheDocument();
        expect(screen.getByTestId('c960-live-opponent')).toHaveTextContent('bob (1480)');
    });
});
