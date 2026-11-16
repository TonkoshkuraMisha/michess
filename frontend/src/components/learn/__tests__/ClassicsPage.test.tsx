// Партии мастеров (таск 14.7): список, вводный текст, комментарий наставника, остановка «что бы вы сыграли?».

import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import game from '../../../content/classics/botvinnik-tal-1961.json';
import {ClassicGamePage, ClassicsPage} from '../ClassicsPage';

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

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/learn/classics" element={<ClassicsPage/>}/>
                <Route path="/learn/classics/:gameId" element={<ClassicGamePage/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => vi.unstubAllGlobals());

describe('Партии мастеров', () => {
    it('список из сорока пяти партий', async () => {
        renderAt('/learn/classics');
        expect(await screen.findByTestId('classic-botvinnik-tal-1961')).toHaveTextContent('Botvinnik');
        expect(screen.getAllByTestId(/^classic-[a-z]/)).toHaveLength(45);
    });

    it('вводный текст, затем остановка перед ключевым ходом и баллы за ход мастера', async () => {
        renderAt('/learn/classics/botvinnik-tal-1961');
        expect(await screen.findByTestId('classic-intro')).toHaveTextContent('Защита Нимцовича');
        const stop = game.stops[0];
        const moves = within(screen.getByTestId('classic-moves')).getAllByRole('button');
        fireEvent.click(moves[stop.ply - 1]);
        fireEvent.click(screen.getByRole('button', {name: 'Ход вперёд'}));
        expect(screen.getByTestId('classic-stop')).toHaveTextContent('Что бы вы сыграли за белых?');
        await drag(stop.move.slice(0, 2), stop.move.slice(2, 4));
        expect(screen.getByTestId('classic-stop-score')).toHaveTextContent('Баллы: 100 из 100');
        fireEvent.click(screen.getByTestId('classic-stop-continue'));
        expect(screen.queryByTestId('classic-stop')).toBeNull();
        expect(screen.getByTestId('classic-stop-total')).toHaveTextContent('100 из 100');
    });

    it('без остановок ход проходит сразу', async () => {
        renderAt('/learn/classics/botvinnik-tal-1961');
        await screen.findByTestId('classic-intro');
        fireEvent.click(screen.getByTestId('classic-stops-toggle'));
        const moves = within(screen.getByTestId('classic-moves')).getAllByRole('button');
        fireEvent.click(moves[game.stops[0].ply - 1]);
        fireEvent.click(screen.getByRole('button', {name: 'Ход вперёд'}));
        expect(screen.queryByTestId('classic-stop')).toBeNull();
    });
});
