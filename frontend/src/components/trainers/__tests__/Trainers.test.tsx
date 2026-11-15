// Тренажёры (таски 19.1, 16.5): прохождение «Тихой тропы» по решению, «Двойной удар» с таймером, страница и рекорды.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Chess} from 'chess.js';
import {setToken} from '../../../services/authToken';
import {starsSolution} from '../../../content/basics/rules';
import {forkLevel, knightTargets, pathLevel} from '../../../trainers/vision';
import {ForkGame, PathGame, ROUNDS, TailGame} from '../VisionGames';
import {legalMoves, newGame} from '../../../trainers/tail';
import {TrainerPage, TrainersPage} from '../TrainersPage';

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

beforeEach(() => vi.useFakeTimers({shouldAdvanceTime: true}));
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setToken(null);
});

describe('Тихая тропа', () => {
    it('пять позиций кратчайшим путём — 500 очков без ошибок', async () => {
        const onFinish = vi.fn();
        render(<PathGame kind="quiet" level={2} seed={11} onFinish={onFinish}/>);
        for (let round = 0; round < ROUNDS; round++) {
            const level = pathLevel('quiet', 2, 11 + round);
            const solution = starsSolution({fen: level.fen, hero: level.hero, stars: [level.target]})!;
            for (const uci of solution.path) await drag(uci.slice(0, 2), uci.slice(2, 4));
            await act(async () => {
                vi.advanceTimersByTime(500);
            });
        }
        expect(onFinish).toHaveBeenCalledWith(500, 0);
    });

    it('ход королём вместо своей фигуры — ошибка и подсказка', async () => {
        const level = pathLevel('quiet', 1, 3);
        const game = new Chess(level.fen);
        const kingMove = game.moves({verbose: true}).find((m) => m.piece === 'k')!;
        render(<PathGame kind="quiet" level={1} seed={3} onFinish={vi.fn()}/>);
        await drag(kingMove.from, kingMove.to);
        expect(screen.getByTestId('path-feedback')).toHaveTextContent('только фигура игрока');
        expect(screen.getByTestId('path-progress')).toHaveTextContent('ходов 0');
    });
});

describe('Двойной удар', () => {
    it('верное поле — следующая позиция, неверное — ошибка; по времени — итог', async () => {
        const onFinish = vi.fn();
        render(<ForkGame level={2} seed={5} onFinish={onFinish}/>);
        const first = forkLevel(2, 5);
        fireEvent.click(cell(first.answers[0]));
        expect(screen.getByTestId('fork-solved')).toHaveTextContent('Найдено: 1');
        const second = forkLevel(2, 6);
        const wrong = knightTargets(second.knight).find((s) => !second.answers.includes(s))
            ?? ['a1', 'h8', 'a8'].find((s) => !second.answers.includes(s))!;
        fireEvent.click(cell(wrong));
        expect(screen.getByTestId('fork-feedback')).toBeInTheDocument();
        await act(async () => {
            vi.advanceTimersByTime(61_000);
        });
        expect(onFinish).toHaveBeenCalledWith(10, 1);
    });
});

describe('страница тренажёров', () => {
    it('список с рекордами и сохранение результата', async () => {
        setToken('jwt');
        vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
            ok: true, status: 200,
            json: async () => (String(url).endsWith('/records')
                ? {records: {quiet_path: {best: 450, max_level: 3, attempts: 4}}}
                : {results: [{score: 100}, {score: 300}]}),
        } as Response)));
        render(<MemoryRouter initialEntries={['/train']}><Routes><Route path="/train" element={<TrainersPage/>}/></Routes></MemoryRouter>);
        expect(await screen.findByText('Рекорд 450 · уровень до 3')).toBeInTheDocument();
        expect(screen.getByTestId('trainer-double_strike')).toHaveAttribute('href', '/train/double_strike');
    });

    it('страница тренажёра: график и запуск; неизвестный — сообщение', async () => {
        setToken('jwt');
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({results: [{score: 100}, {score: 300}]})} as Response)));
        const view = render(<MemoryRouter initialEntries={['/train/knight_route']}><Routes><Route path="/train/:trainerId" element={<TrainerPage/>}/></Routes></MemoryRouter>);
        expect(await screen.findByTestId('trainer-chart')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('trainer-start'));
        expect(screen.getByTestId('path-game-knight')).toBeInTheDocument();
        view.unmount();
        render(<MemoryRouter initialEntries={['/train/nope']}><Routes><Route path="/train/:trainerId" element={<TrainerPage/>}/></Routes></MemoryRouter>);
        expect(screen.getByText('Такого тренажёра нет.')).toBeInTheDocument();
    });

    it('координаты: настройки вместо уровня, итог уходит с уровнем этих настроек', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        setToken('jwt');
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ok: true, status: 200, json: async () => ({results: [], record: true, best: 0})} as Response));
        vi.stubGlobal('fetch', fetchMock);
        render(<MemoryRouter initialEntries={['/train/coord_color']}><Routes><Route path="/train/:trainerId" element={<TrainerPage/>}/></Routes></MemoryRouter>);
        expect(screen.queryByTestId('trainer-level')).toBeNull();
        fireEvent.click(screen.getByTestId('coord-side-black'));
        fireEvent.click(screen.getByTestId('coord-seconds-60'));
        fireEvent.click(screen.getByTestId('trainer-start'));
        expect(screen.getByTestId('coord-game')).toBeInTheDocument();
        await act(async () => {
            vi.advanceTimersByTime(61_000);
        });
        const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
        expect(JSON.parse(String(post[1]!.body))).toMatchObject({trainer: 'coord_color', level: 6, score: 0});
        vi.useRealTimers();
    });
});

describe('Хвост', () => {
    it('щелчок по допустимому полю двигает голову, по недопустимому — ошибка; «Закончить» отдаёт итог', () => {
        const onFinish = vi.fn();
        render(<TailGame level={1} seed={4} onFinish={onFinish}/>);
        const start = newGame(1, 4);
        const [target] = legalMoves(start);
        const blocked = ['a1', 'h8', 'a8', 'h1'].find((s) => !legalMoves(start).includes(s) && s !== start.head)!;
        fireEvent.click(cell(blocked));
        expect(screen.getByTestId('tail-game')).toHaveTextContent('ошибок: 1');
        fireEvent.click(cell(target));
        expect(cell(target).querySelector('img')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Закончить'}));
        expect(onFinish).toHaveBeenCalledWith(target === start.food ? 10 : 0, 1);
    });
});
