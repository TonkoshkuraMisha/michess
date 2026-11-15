// Шахматы Фишера (таск 21.3): щелчки → ход (рокировка «король на ладью», превращение), запрос к серверу, игра за
// чёрных (первым ходит бот), итог партии.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Chess960Page, clickMove, piecesOf} from '../Chess960Page';
import type {State960} from '../Chess960Page';

const POS0 = 'bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1';
const state = (extra: Partial<State960> = {}): State960 => ({
    number: 0, fen: POS0, moves: [], sans: [], result: null, termination: null, bot_move: null, check: false, ...extra,
});

function stub(reply: (path: string, body: Record<string, unknown>) => State960) {
    const bodies: [string, Record<string, unknown>][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split('/api/v1/chess960')[1];
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        bodies.push([path, body]);
        return {ok: true, json: async () => reply(path, body)} as Response;
    }));
    return bodies;
}

const click = (square: string) => fireEvent.click(document.querySelector(`[data-square="${square}"]`)!);
const page = () => render(<MemoryRouter><Chess960Page/></MemoryRouter>);

afterEach(() => vi.unstubAllGlobals());

describe('шахматы Фишера', () => {
    it('фигуры по полям и ход по щелчкам', () => {
        expect(piecesOf(POS0).get('g1')).toBe('K');
        expect(piecesOf(POS0).get('a8')).toBe('b');
        expect(clickMove(POS0, 'g1', 'h1')).toBe('g1h1');  // король на свою ладью — рокировка
        expect(clickMove(POS0, 'g1', 'f1')).toBe('g1f1');
        expect(clickMove(POS0, 'd1', 'e1')).toBeNull();  // своя фигура — не ход
        expect(clickMove('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'a8')).toBe('a7a8q');
        expect(clickMove(POS0, 'e4', 'e5')).toBeNull();
    });

    it('новая партия, ход щелчками уходит на сервер, ответ бота, итог', async () => {
        const bodies = stub((path) => (path.startsWith('/new') ? state()
            : state({fen: 'bbqnnrkr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/BBQNNRKR w KQkq - 0 2', moves: ['e2e4', 'e7e5'], sans: ['e4', 'e5'],
                bot_move: 'e7e5', result: '0-1', termination: 'checkmate'})));
        await act(async () => page());
        expect(screen.getByTestId('c960-number-label')).toHaveTextContent('№ 0');
        click('e2');
        await act(async () => click('e4'));
        expect(bodies[1]).toEqual(['/move', {number: 0, moves: [], move: 'e2e4', level: 2}]);
        expect(screen.getByTestId('c960-moves')).toHaveTextContent('1. e4 e5');
        expect(screen.getByTestId('c960-status')).toHaveTextContent('Победа чёрных: мат.');
    });

    it('за чёрных первым ходит бот; номер расстановки и уровень уходят на сервер', async () => {
        const bodies = stub((path) => state(path.startsWith('/new') ? {number: 709} : {number: 709, moves: ['e2e4'], sans: ['e4']}));
        await act(async () => page());
        fireEvent.change(screen.getByTestId('c960-color'), {target: {value: 'black'}});
        fireEvent.change(screen.getByTestId('c960-level'), {target: {value: '4'}});
        fireEvent.change(screen.getByTestId('c960-number'), {target: {value: '709'}});
        await act(async () => fireEvent.click(screen.getByTestId('c960-new')));
        expect(bodies.map(([path]) => path).slice(1)).toEqual(['/new?number=709', '/bot-move']);
        expect(bodies[2][1]).toEqual({number: 709, moves: [], level: 4});
        expect(screen.getByTestId('c960-status')).toHaveTextContent('Ход бота.');
    });

    it('ошибка сервера показывается', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 503, json: async () => ({detail: {code: 'engine_busy', params: {}, message: ''}}),
        }) as Response));
        await act(async () => page());
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });
});
