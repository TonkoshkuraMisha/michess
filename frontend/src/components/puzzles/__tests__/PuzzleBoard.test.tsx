// Доска задач: все способы сделать ход — перетаскиванием и двумя щелчками; особые ходы (рокировка, взятие на проходе,
// превращение с выбором фигуры, со взятием), запреты (чужая фигура, связка, шах, не своя очередь, неинтерактивная
// доска), отмена и перевыбор, смена позиции посреди хода, ориентация за чёрных, режим выбора поля (13.6).

import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {PuzzleBoard} from '../PuzzleBoard';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CASTLING = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
const EN_PASSANT = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
const PROMOTION = '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
const CAPTURE = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
const PINNED = '4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1';
const IN_CHECK = '4k3/8/8/8/8/8/8/r3K2N w - - 0 1';
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function setup(props: Partial<Parameters<typeof PuzzleBoard>[0]> = {}) {
    const onMove = vi.fn();
    const utils = render(<PuzzleBoard fen={START} orientation="white" interactive onMove={onMove} {...props}/>);
    return {onMove, ...utils};
}

function cell(name: string): HTMLElement {
    const el = document.querySelector(`[data-square="${name}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`no square ${name}`);
    return el;
}

const click = (name: string) => act(() => {
    fireEvent.click(cell(name));
});

/** Перетаскивание: нажатие на поле from, движение указателя, отпускание над полем to (или вне доски — null). */
function drag(from: string, to: string | null, {button = 0, pointerType = 'mouse', cancel = false} = {}) {
    const target = to ? cell(to) : null;
    document.elementsFromPoint = vi.fn(() => (target ? [target.firstElementChild ?? target, target] : [document.body]));
    act(() => {
        fireEvent.pointerDown(cell(from), {button, pointerType, clientX: 10, clientY: 10});
    });
    act(() => {
        fireEvent.pointerMove(window, {clientX: 40, clientY: 40});
    });
    act(() => {
        if (cancel) fireEvent.pointerCancel(window);
        else fireEvent.pointerUp(window, {clientX: 80, clientY: 80});
    });
}

const targets = () => Array.from(document.querySelectorAll('[data-testid^="puzzle-target-"]'))
    .map((el) => el.getAttribute('data-testid')!.replace('puzzle-target-', '')).sort();

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ход двумя щелчками', () => {
    it('фигура, затем поле', () => {
        const {onMove} = setup();
        click('e2');
        expect(targets()).toEqual(['e3', 'e4']);
        click('e4');
        expect(onMove).toHaveBeenCalledWith('e2e4');
        expect(targets()).toEqual([]);
    });

    it('конь: два поля в начальной позиции', () => {
        const {onMove} = setup();
        click('g1');
        expect(targets()).toEqual(['f3', 'h3']);
        click('h3');
        expect(onMove).toHaveBeenCalledWith('g1h3');
    });

    it('другая своя фигура — выбор переключается; пустое поле — снимает выбор', () => {
        const {onMove} = setup();
        click('e2');
        click('d2');
        expect(targets()).toEqual(['d3', 'd4']);
        click('a5');
        expect(targets()).toEqual([]);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('чужая фигура не выбирается', () => {
        setup();
        click('e7');
        expect(targets()).toEqual([]);
    });

    it('недопустимое поле не ходит и не снимает лишнего: выбор пропадает', () => {
        const {onMove} = setup();
        click('e2');
        click('e5');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('взятие щелчком', () => {
        const {onMove} = setup({fen: CAPTURE});
        click('e4');
        expect(targets()).toEqual(['d5', 'e5']);
        click('d5');
        expect(onMove).toHaveBeenCalledWith('e4d5');
    });
});

describe('ход перетаскиванием', () => {
    it('пешка на два поля', () => {
        const {onMove} = setup();
        drag('e2', 'e4');
        expect(onMove).toHaveBeenCalledWith('e2e4');
    });

    it('конь и взятие', () => {
        const {onMove} = setup({fen: CAPTURE});
        drag('g1', 'f3');
        expect(onMove).toHaveBeenLastCalledWith('g1f3');
        drag('e4', 'd5');
        expect(onMove).toHaveBeenLastCalledWith('e4d5');
    });

    it('касание пальцем и перо работают так же, как мышь', () => {
        const {onMove} = setup();
        drag('e2', 'e4', {pointerType: 'touch'});
        drag('d2', 'd4', {pointerType: 'pen'});
        expect(onMove.mock.calls).toEqual([['e2e4'], ['d2d4']]);
    });

    it('отпустили на том же поле — фигура выбрана, ход заканчивается щелчком', () => {
        const {onMove} = setup();
        drag('e2', 'e2');
        expect(onMove).not.toHaveBeenCalled();
        expect(targets()).toEqual(['e3', 'e4']);
        click('e3');
        expect(onMove).toHaveBeenCalledWith('e2e3');
    });

    it('на недопустимое поле — хода нет', () => {
        const {onMove} = setup();
        drag('e2', 'e5');
        drag('g1', 'g3');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('мимо доски и отмена жеста — хода нет', () => {
        const {onMove} = setup();
        drag('e2', null);
        drag('e2', 'e4', {cancel: true});
        expect(onMove).not.toHaveBeenCalled();
    });

    it('правая кнопка мыши и чужая фигура перетаскивание не начинают', () => {
        const {onMove} = setup();
        drag('e2', 'e4', {button: 2});
        drag('e7', 'e5');
        drag('e4', 'e5');  // пустое поле
        expect(onMove).not.toHaveBeenCalled();
    });

    it('фигура «прилипает» к указателю, исходное поле приглушено; после хода — пропадает', () => {
        setup();
        document.elementsFromPoint = vi.fn(() => [cell('e4')]);
        act(() => {
            fireEvent.pointerDown(cell('e2'), {button: 0, pointerType: 'mouse', clientX: 10, clientY: 10});
        });
        expect(screen.queryByTestId('puzzle-drag-piece')).toBeNull();  // ещё не сдвинули — это может быть щелчок
        act(() => {
            fireEvent.pointerMove(window, {clientX: 60, clientY: 70});
        });
        const ghost = screen.getByTestId('puzzle-drag-piece');
        expect(ghost.style.left).toBe('60px');
        expect(ghost.style.top).toBe('70px');
        expect(cell('e2').querySelector('img')!.className).toContain('opacity-30');
        act(() => {
            fireEvent.pointerUp(window, {clientX: 60, clientY: 70});
        });
        expect(screen.queryByTestId('puzzle-drag-piece')).toBeNull();
    });
});

describe('особые ходы', () => {
    it.each([
        ['e1', 'g1', 'e1g1'],
        ['e1', 'c1', 'e1c1'],
    ])('рокировка %s→%s щелчками и перетаскиванием', (from, to, uci) => {
        const {onMove, unmount} = setup({fen: CASTLING});
        click(from);
        expect(targets()).toContain(to);
        click(to);
        expect(onMove).toHaveBeenLastCalledWith(uci);
        unmount();
        const second = setup({fen: CASTLING});
        drag(from, to);
        expect(second.onMove).toHaveBeenLastCalledWith(uci);
    });

    it('взятие на проходе', () => {
        const {onMove} = setup({fen: EN_PASSANT});
        click('e5');
        expect(targets()).toEqual(['d6', 'e6']);
        drag('e5', 'd6');
        expect(onMove).toHaveBeenCalledWith('e5d6');
    });

    it.each(['q', 'r', 'b', 'n'])('превращение щелчками: выбор фигуры %s', (piece) => {
        const {onMove} = setup({fen: PROMOTION});
        click('a7');
        click('a8');
        expect(onMove).not.toHaveBeenCalled();  // сначала — выбор фигуры
        expect(screen.getByRole('dialog')).toBeTruthy();
        act(() => {
            fireEvent.click(screen.getByTestId(`puzzle-promote-${piece}`));
        });
        expect(onMove).toHaveBeenCalledWith(`a7a8${piece}`);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('превращение со взятием перетаскиванием', () => {
        const {onMove} = setup({fen: PROMOTION});
        drag('a7', 'b8');
        act(() => {
            fireEvent.click(screen.getByTestId('puzzle-promote-n'));
        });
        expect(onMove).toHaveBeenCalledWith('a7b8n');
    });

    it('пока открыт выбор фигуры, доска не принимает других ходов', () => {
        const {onMove} = setup({fen: PROMOTION});
        drag('a7', 'a8');
        click('e1');
        drag('e1', 'd1');
        expect(onMove).not.toHaveBeenCalled();
    });
});

describe('правила на доске', () => {
    it('связанная фигура ходит только вдоль связки', () => {
        setup({fen: PINNED});
        click('e2');
        expect(targets()).toEqual([]);  // слон на e2 связан ладьёй e7 — ходов нет
    });

    it('под шахом — только ходы, которые от него спасают', () => {
        const {onMove} = setup({fen: IN_CHECK});
        click('h1');
        expect(targets()).toEqual([]);  // конь не закрывает шах
        drag('h1', 'g3');
        expect(onMove).not.toHaveBeenCalled();
        click('e1');
        expect(targets()).toEqual(['d2', 'e2', 'f2']);
    });

    it('неинтерактивная доска: ни выбора, ни перетаскивания', () => {
        const {onMove} = setup({interactive: false});
        click('e2');
        drag('e2', 'e4');
        expect(targets()).toEqual([]);
        expect(onMove).not.toHaveBeenCalled();
    });

    it('не своя очередь: фигуры другого цвета не двигаются', () => {
        const {onMove} = setup({fen: BLACK_TO_MOVE});
        drag('d2', 'd4');
        expect(onMove).not.toHaveBeenCalled();
        drag('e7', 'e5');
        expect(onMove).toHaveBeenCalledWith('e7e5');
    });
});

describe('смена позиции', () => {
    it('выбор из прошлой позиции не действует в новой', () => {
        const {onMove, rerender} = setup();
        click('e2');
        rerender(<PuzzleBoard fen={BLACK_TO_MOVE} orientation="white" interactive onMove={onMove}/>);
        expect(targets()).toEqual([]);
        click('e3');
        expect(onMove).not.toHaveBeenCalled();
    });

    it('позиция сменилась посреди перетаскивания — хода нет', () => {
        const {onMove, rerender} = setup();
        document.elementsFromPoint = vi.fn(() => [cell('e4')]);
        act(() => {
            fireEvent.pointerDown(cell('e2'), {button: 0, pointerType: 'mouse', clientX: 10, clientY: 10});
        });
        act(() => {
            fireEvent.pointerMove(window, {clientX: 50, clientY: 50});
        });
        rerender(<PuzzleBoard fen={BLACK_TO_MOVE} orientation="white" interactive onMove={onMove}/>);
        act(() => {
            fireEvent.pointerUp(window, {clientX: 50, clientY: 50});
        });
        expect(onMove).not.toHaveBeenCalled();
    });
});

describe('ориентация и отметки', () => {
    it('за чёрных доска перевёрнута, ход работает', () => {
        const {onMove} = setup({fen: BLACK_TO_MOVE, orientation: 'black'});
        const order = Array.from(document.querySelectorAll('[data-square]')).map((el) => el.getAttribute('data-square'));
        expect(order[0]).toBe('h1');
        expect(order[63]).toBe('a8');
        drag('g8', 'f6');
        expect(onMove).toHaveBeenCalledWith('g8f6');
    });

    it('последний ход, подсказка и отметка ✓/✗', () => {
        setup({lastMove: {from: 'e2', to: 'e4'}, hint: {from: 'g1', to: 'f3'}, mark: {square: 'f3', ok: false}});
        expect(screen.getByTestId('puzzle-hint-g1')).toBeTruthy();
        expect(screen.getByTestId('puzzle-hint-f3')).toBeTruthy();
        expect(screen.getByTestId('puzzle-mark-wrong')).toBeTruthy();
    });
});

describe('выбор поля (защитные упражнения)', () => {
    it('щелчок сообщает поле; перетаскивания и ходов нет', () => {
        const onSquare = vi.fn();
        const {onMove} = setup({onSquare});
        click('f2');
        click('e7');
        drag('e2', 'e4');
        // Жест перетаскивания здесь — не ход и не выбор поля (щелчок браузер пришлёт отдельно, если он был).
        expect(onSquare.mock.calls.map((c) => c[0])).toEqual(['f2', 'e7']);
        expect(screen.queryByTestId('puzzle-drag-piece')).toBeNull();
        expect(onMove).not.toHaveBeenCalled();
        expect(targets()).toEqual([]);
    });
});
