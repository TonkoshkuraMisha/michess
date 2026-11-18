// Эндшпильный тренажёр (таск 14.4): данные упражнений, ответ идеального защитника, упущенный выигрыш, мат против
// оптимума, удержанная ничья; запасной ответ движка при недоступных таблицах. Таблицы подменены.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Chess} from 'chess.js';
import {EndgamesPage, EndgameTrainerPage, EXERCISES} from '../EndgameTrainer';
import {trainerVerdict} from '../../../services/tablebase';

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

function stubProbe(answer: (fen: string) => unknown) {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
        ok: true, status: 200, json: async () => answer(JSON.parse(String(init?.body)).fen),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function open(id: string) {
    return render(
        <MemoryRouter initialEntries={[`/learn/endgames/${id}`]}>
            <Routes><Route path="/learn/endgames/:exerciseId" element={<EndgameTrainerPage/>}/></Routes>
        </MemoryRouter>,
    );
}

afterEach(() => vi.unstubAllGlobals());

describe('данные упражнений', () => {
    it('34 законные позиции, у матов — оптимум не больше лимита', () => {
        expect(EXERCISES).toHaveLength(34);
        for (const e of EXERCISES) {
            const game = new Chess(e.fen);
            expect(game.isGameOver(), e.id).toBe(false);
            expect(game.turn()).toBe(e.side === 'white' ? 'w' : 'b');
            if (e.goal === 'mate') expect(e.optimum! <= e.limit, e.id).toBe(true);
        }
    });

    it('список по целям', () => {
        render(<MemoryRouter><EndgamesPage/></MemoryRouter>);
        expect(screen.getAllByTestId(/^endgame-/)).toHaveLength(34);
        expect(screen.getByTestId('endgame-lucena')).toHaveTextContent('Лусены');
    });
});

describe('игра против таблиц', () => {
    it('ход игрока — защитник отвечает лучшим ходом, счётчик растёт', async () => {
        const fetchMock = stubProbe(() => ({category: 'loss', dtm: -16, dtz: -16,
            best: {uci: 'e5e4', san: 'Ke4', category: 'win', dtm: 15, dtz: 15}}));
        open('kq_center');
        await drag('b1', 'f1');
        expect(await screen.findByTestId('endgame-moves')).toHaveTextContent('Ходов: 1 · оптимум 9 · лимит 17');
        expect(cell('e4').querySelector('img')?.getAttribute('alt')).toBe('bk');
        const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
        expect(body.fen).toContain('8/8/8/4k3/8/8/8/K4Q2 b');
    });

    it('ход, упускающий выигрыш, — задание не выполнено', async () => {
        stubProbe(() => ({category: 'draw', dtm: 0, dtz: 0, best: {uci: 'e5e4', san: 'Ke4', category: 'draw', dtm: 0, dtz: 0}}));
        open('kq_center');
        await drag('b1', 'b8');
        expect(await screen.findByTestId('endgame-result')).toHaveTextContent('упустил выигрыш');
    });

    it('защита: ход, который проигрывает, — провал', async () => {
        stubProbe(() => ({category: 'win', dtm: 9, dtz: 9, best: null}));
        open('kp_opposition_def');
        await drag('e8', 'd7');
        expect(await screen.findByTestId('endgame-result')).toHaveTextContent('проигрывает');
    });
});

describe('таблицы недоступны — отвечает движок', () => {
    it('спорная оценка движка не обрывает задание, видна пометка', async () => {
        stubProbe(() => ({category: 'maybe-win', dtm: null, dtz: null, source: 'engine',
            best: {uci: 'e5e4', san: 'Ke4', category: null, dtm: null, dtz: null}}));
        open('kq_center');
        await drag('b1', 'f1');
        expect(await screen.findByTestId('endgame-engine-fallback')).toHaveTextContent('Таблицы эндшпиля сейчас недоступны');
        expect(screen.queryByTestId('endgame-result')).toBeNull();
        expect(cell('e4').querySelector('img')?.getAttribute('alt')).toBe('bk');
    });

    it('правила вердикта: таблицам — строго, движку — только явная оценка', () => {
        const probe = (category: string, source: 'tablebase' | 'engine') => ({category, dtm: null, dtz: null, best: null, source});
        expect(trainerVerdict(probe('maybe-loss', 'tablebase'), true)).toBe('winLost');
        expect(trainerVerdict(probe('maybe-loss', 'engine'), true)).toBe('continue');
        expect(trainerVerdict(probe('maybe-win', 'engine'), true)).toBe('continue');
        expect(trainerVerdict(probe('draw', 'engine'), true)).toBe('winLost');
        expect(trainerVerdict(probe('loss', 'engine'), true)).toBe('continue');
        expect(trainerVerdict(probe('maybe-win', 'tablebase'), false)).toBe('drawLost');
        expect(trainerVerdict(probe('maybe-win', 'engine'), false)).toBe('continue');
        expect(trainerVerdict(probe('win', 'engine'), false)).toBe('drawLost');
    });
});
