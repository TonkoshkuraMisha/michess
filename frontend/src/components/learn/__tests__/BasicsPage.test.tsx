// Азбука (таск 14.5): список разделов, уровень «звёзд» с оценкой, запрет вставать под бой, вопрос «что на доске».

import {fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, describe, expect, it} from 'vitest';
import {BasicsPage, BasicsSectionPage} from '../BasicsPage';
import {playMove} from '../../../test/boardMoves';


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
        await playMove('a1', 'a5');
        expect(screen.queryByTestId('board-star-a5')).toBeNull();
        expect(screen.getByLabelText('Оценка: 3 из 3')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('basics-next'));
        expect(screen.getByText('Уровень 2 из 7')).toBeInTheDocument();
    });

    it('под бой вставать нельзя', async () => {
        renderAt('/learn/basics/rook');
        fireEvent.click(screen.getByRole('button', {name: '7'}));
        await playMove('a1', 'a3');
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
