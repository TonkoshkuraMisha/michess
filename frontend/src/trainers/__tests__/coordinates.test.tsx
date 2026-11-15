// Тренажёры координат (таск 19.2): цвет поля, диагонали, вопросы по seed, кодирование настроек, игра на время.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    ALL_SQUARES, COORD_TRAINERS, coordQuestion, isCorrect, levelToOptions, optionsToLevel, sameDiagonal, squareColor,
} from '../coordinates';
import {CoordinateGame} from '../../components/trainers/CoordinateGames';

afterEach(() => vi.useRealTimers());

describe('координаты: логика', () => {
    it('цвет поля: a1 и h8 тёмные, h1 и a8 светлые; поровну', () => {
        expect([squareColor('a1'), squareColor('h8'), squareColor('h1'), squareColor('a8'), squareColor('e4'), squareColor('d4')])
            .toEqual(['dark', 'dark', 'light', 'light', 'light', 'dark']);
        expect(ALL_SQUARES.filter((s) => squareColor(s) === 'dark')).toHaveLength(32);
    });

    it('диагонали', () => {
        expect(sameDiagonal('a1', 'h8')).toBe(true);
        expect(sameDiagonal('c1', 'h6')).toBe(true);
        expect(sameDiagonal('e4', 'e5')).toBe(false);
        expect(sameDiagonal('e4', 'e4')).toBe(false);
    });

    it('настройки ↔ уровень 1–8 без потерь', () => {
        const levels = new Set<number>();
        for (const side of ['white', 'black'] as const) {
            for (const coordinates of [true, false]) {
                for (const seconds of [30, 60] as const) {
                    const level = optionsToLevel({side, coordinates, seconds});
                    levels.add(level);
                    expect(levelToOptions(level)).toEqual({side, coordinates, seconds});
                }
            }
        }
        expect([...levels].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('вопросы по seed повторяемы и всегда решаемы: ровно один верный вариант', () => {
        for (const trainer of COORD_TRAINERS) {
            for (let i = 0; i < 200; i++) {
                const q = coordQuestion(trainer, 42, i);
                expect(coordQuestion(trainer, 42, i)).toEqual(q);
                if (trainer === 'coord_name' || trainer === 'coord_diagonal') {
                    expect(q.options).toHaveLength(4);
                    expect(new Set(q.options).size).toBe(4);
                    expect(q.options.filter((o) => isCorrect(q, o))).toHaveLength(1);
                }
                if (trainer === 'coord_diagonal') {
                    expect(q.options.filter((o) => sameDiagonal(q.square, o))).toEqual([q.answer]);
                }
                if (trainer === 'coord_color') expect(q.answer).toBe(squareColor(q.square));
            }
        }
    });
});

describe('координаты: игра', () => {
    it('«Найди поле»: верный щелчок — очко, неверный — ошибка; по времени — итог', () => {
        vi.useFakeTimers();
        const onFinish = vi.fn();
        render(<CoordinateGame trainer="coord_find" level={1} seed={7} onFinish={onFinish}/>);
        const first = coordQuestion('coord_find', 7, 0).square;
        fireEvent.click(document.querySelector(`[data-square="${first}"]`)!);
        const second = coordQuestion('coord_find', 7, 1).square;
        const wrong = second === 'a1' ? 'h8' : 'a1';
        fireEvent.click(document.querySelector(`[data-square="${wrong}"]`)!);
        expect(screen.getByTestId('coord-score')).toHaveTextContent('Верно: 1 · ошибок: 1');
        act(() => vi.advanceTimersByTime(31_000));
        expect(onFinish).toHaveBeenCalledWith(1, 1);
    });

    it('«Цвет поля» — кнопками; «Назови поле» — вариантами; координаты можно скрыть', () => {
        const onFinish = vi.fn();
        const {unmount} = render(<CoordinateGame trainer="coord_color" level={1} seed={3} onFinish={onFinish}/>);
        const q = coordQuestion('coord_color', 3, 0);
        fireEvent.click(screen.getByTestId(`coord-${q.answer}`));
        expect(screen.getByTestId('coord-score')).toHaveTextContent('Верно: 1');
        unmount();
        render(<CoordinateGame trainer="coord_name" level={3} seed={3} onFinish={onFinish}/>);
        const name = coordQuestion('coord_name', 3, 0);
        expect(screen.getByTestId('coord-board').querySelector(`[data-square="${name.square}"] [data-testid="coord-highlight"]`)).not.toBeNull();
        expect(screen.getByTestId('coord-board').textContent).toBe('');   // уровень 3: без координат
        fireEvent.click(screen.getByTestId(`coord-option-${name.answer}`));
        expect(screen.getByTestId('coord-score')).toHaveTextContent('Верно: 1');
    });

    it('за чёрных доска перевёрнута', () => {
        render(<CoordinateGame trainer="coord_find" level={2} seed={1} onFinish={vi.fn()}/>);
        const squares = Array.from(screen.getByTestId('coord-board').querySelectorAll('[data-square]')).map((el) => el.getAttribute('data-square'));
        expect(squares[0]).toBe('h1');
        expect(squares[63]).toBe('a8');
    });
});
