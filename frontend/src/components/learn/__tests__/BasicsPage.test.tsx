// Азбука (таск 14.5): список разделов, уровень «звёзд» с оценкой, запрет вставать под бой, вопрос «что на доске».

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {BasicsPage, BasicsSectionPage} from '../BasicsPage';

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
                <Route path="/learn/basics" element={<BasicsPage/>}/>
                <Route path="/learn/basics/:sectionId" element={<BasicsSectionPage/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => {
    localStorage.clear();
});

describe('Азбука', () => {
    it('восемь разделов', () => {
        renderAt('/learn/basics');
        expect(screen.getAllByTestId(/^basics-section-/)).toHaveLength(8);
        expect(screen.getByTestId('basics-section-knight')).toHaveTextContent('Конь');
    });

    it('ладья собирает звезду за минимум ходов — три звезды и следующий уровень', async () => {
        renderAt('/learn/basics/rook');
        expect(screen.getByTestId('board-star-a5')).toBeInTheDocument();
        expect(screen.getByTestId('basics-moves')).toHaveTextContent('Ходов: 0 · можно за 1');
        await drag('a1', 'a5');
        expect(screen.queryByTestId('board-star-a5')).toBeNull();
        expect(screen.getByLabelText('Оценка: 3 из 3')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('basics-next'));
        expect(screen.getByText('Уровень 2 из 7')).toBeInTheDocument();
    });

    it('под бой вставать нельзя', async () => {
        renderAt('/learn/basics/rook');
        fireEvent.click(screen.getByRole('button', {name: '7'}));
        await drag('a1', 'a3');
        expect(screen.getByTestId('basics-feedback')).toHaveTextContent('Это поле бьёт соперник');
        expect(screen.getByTestId('basics-moves')).toHaveTextContent('Ходов: 0');
    });

    it('вопрос «что на доске»: неверный ответ — подсказка, верный — объяснение', () => {
        renderAt('/learn/basics/special');
        fireEvent.click(screen.getByRole('button', {name: '7'}));
        fireEvent.click(screen.getByTestId('basics-answer-mate'));
        expect(screen.getByTestId('basics-feedback')).toHaveTextContent('Не совсем');
        fireEvent.click(screen.getByTestId('basics-answer-stalemate'));
        expect(screen.getByTestId('basics-feedback')).toHaveTextContent('это пат, ничья');
    });
});
