// --- FILE: frontend/src/components/chessboard/scrollMove.ts ---
// Список ходов — отдельное окно со своей прокруткой, текущий ход держится в его середине (так устроены доски
// анализа на шахматных сайтах). Прокручивается только сам список: Element.scrollIntoView двигает ещё и страницу,
// и при листании партии стрелками доска «прыгала» вверх-вниз вслед за ходом.

/** Куда прокрутить список высотой viewHeight, чтобы строка (itemTop от начала содержимого, itemHeight) встала посередине. */
export function centeredScrollTop(itemTop: number, itemHeight: number, viewHeight: number, contentHeight: number): number {
    const target = itemTop - (viewHeight - itemHeight) / 2;
    return Math.round(Math.max(0, Math.min(target, Math.max(0, contentHeight - viewHeight))));
}

/** Ставит ход в середину списка, не трогая прокрутку страницы. */
export function scrollMoveIntoList(list: HTMLElement, move: HTMLElement): void {
    const listBox = list.getBoundingClientRect();
    const moveBox = move.getBoundingClientRect();
    const itemTop = moveBox.top - listBox.top + list.scrollTop;
    list.scrollTop = centeredScrollTop(itemTop, moveBox.height, list.clientHeight, list.scrollHeight);
}
