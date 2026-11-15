// Справочник дебютов (таск 16.2): ходы со статистикой, название, партии мастеров; щелчок по ходу — сыграть его.

import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ToolsPage} from '../tools/ToolsPage';
import {shares} from '../../services/openingExplorer';

const START = {
    fen: 'start', opening: null,
    moves: [
        {uci: 'e2e4', san: 'e4', games: 10, white_wins: 5, draws: 3, black_wins: 2, opening: {eco: 'B00', name: "King's Pawn Game"}},
        {uci: 'd2d4', san: 'd4', games: 4, white_wins: 1, draws: 2, black_wins: 1, opening: null},
    ],
    games: [{id: 77, white: 'Morphy, Paul', black: 'Anderssen, Adolf', year: '1858', result: '1-0', eco: 'C60'}],
};
const AFTER_E4 = {fen: 'x', opening: {eco: 'B00', name: "King's Pawn Game"}, moves: [], games: []};

function stub() {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const moves = JSON.parse(String(init?.body)).moves as string[];
        return {ok: true, status: 200, json: async () => (moves.length ? AFTER_E4 : START)} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('справочник дебютов', () => {
    it('доли результатов в сумме — 100', () => {
        expect(shares({games: 3, white_wins: 1, draws: 1, black_wins: 1})).toEqual([33, 34, 33]);
        expect(shares({games: 0, white_wins: 0, draws: 0, black_wins: 0})).toEqual([0, 0, 0]);
    });

    it('ходы, партии мастеров и ход щелчком по строке', async () => {
        const fetchMock = stub();
        render(<MemoryRouter><ToolsPage/></MemoryRouter>);
        const table = await screen.findByTestId('explorer-moves');
        expect(within(table).getAllByRole('row')).toHaveLength(3);
        expect(screen.getByLabelText('Победы белых 50%, ничьи 30%, победы чёрных 20%')).toBeInTheDocument();
        expect(screen.getByTestId('explorer-games')).toHaveTextContent('Morphy, Paul — Anderssen, Adolf');
        expect(screen.getByRole('link', {name: /Morphy/})).toHaveAttribute('href', '/game/77');
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'e4'})));
        expect(await screen.findByTestId('explorer-opening')).toHaveTextContent("B00 · King's Pawn Game");
        expect(screen.getByTestId('explorer-empty')).toBeInTheDocument();
        expect(screen.getByTestId('tools-line')).toHaveTextContent('1. e4');
        expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))).toEqual({moves: ['e2e4']});
    });

    it('во время партии с человеком — сообщение сервера', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 409, json: async () => ({detail: {code: 'engine_locked_in_game'}}),
        } as Response)));
        render(<MemoryRouter><ToolsPage/></MemoryRouter>);
        expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
});
