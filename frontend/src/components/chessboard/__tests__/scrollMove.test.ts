// Список ходов прокручивается сам, страница — нет: текущий ход встаёт в середину окна списка.

import {describe, expect, it, vi} from 'vitest';
import {centeredScrollTop, scrollMoveIntoList} from '../scrollMove';

const box = (top: number, height: number) => ({top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({})}) as DOMRect;

/** Окно списка высотой 300 на экранной координате 200, содержимое 2000, строки по 30. */
function listWith(scrollTop: number, moveScreenTop: number) {
    const list = document.createElement('div');
    const move = document.createElement('button');
    list.appendChild(move);
    Object.defineProperty(list, 'clientHeight', {value: 300});
    Object.defineProperty(list, 'scrollHeight', {value: 2000});
    list.scrollTop = scrollTop;
    list.getBoundingClientRect = () => box(200, 300);
    move.getBoundingClientRect = () => box(moveScreenTop, 30);
    return {list, move};
}

describe('centeredScrollTop', () => {
    it('ставит строку в середину окна', () => {
        expect(centeredScrollTop(900, 30, 300, 2000)).toBe(765);
    });

    it('в начале и в конце списка не выходит за края', () => {
        expect(centeredScrollTop(30, 30, 300, 2000)).toBe(0);
        expect(centeredScrollTop(1970, 30, 300, 2000)).toBe(1700);
    });

    it('список целиком помещается в окно — прокрутки нет', () => {
        expect(centeredScrollTop(120, 30, 300, 240)).toBe(0);
    });
});

describe('scrollMoveIntoList', () => {
    it('прокручивает список к ходу с учётом уже сделанной прокрутки', () => {
        // Ход на 400 px ниже верха окна списка, список уже прокручен на 500 → строка на 900 от начала содержимого.
        const {list, move} = listWith(500, 600);
        scrollMoveIntoList(list, move);
        expect(list.scrollTop).toBe(765);
    });

    it('ход выше видимой части — список прокручивается назад', () => {
        const {list, move} = listWith(1000, 100);  // на 100 px выше окна: 900 от начала содержимого
        scrollMoveIntoList(list, move);
        expect(list.scrollTop).toBe(765);
    });

    it('страницу не трогает: ни scrollIntoView, ни прокрутки окна', () => {
        const {list, move} = listWith(0, 900);
        const intoView = vi.fn();
        move.scrollIntoView = intoView;
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        scrollMoveIntoList(list, move);
        expect(intoView).not.toHaveBeenCalled();
        expect(scrollTo).not.toHaveBeenCalled();
        scrollTo.mockRestore();
    });
});
