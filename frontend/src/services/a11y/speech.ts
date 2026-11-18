// --- FILE: frontend/src/services/a11y/speech.ts ---
// Доступность (таск 26.3): ходы, клетки и позиция словами — для программ чтения экрана и для тех, кто играет без
// взгляда на доску. Модуль чистый: слова берутся из каталога переводов (ключи a11y.*), поэтому на трёх языках; данные —
// подробный ход chess.js (history({verbose: true})) и доска chess.js (board()). Скрытые в игре вслепую фигуры сюда
// не передаются: что скрыто, решает вызывающий (Chessboard, visibleSquares).

/** Перевод: ключ и параметры → строка (useI18n().t). */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Side = 'w' | 'b';

/** Фигура на клетке (как в chess.js board()). */
export interface BoardPiece {
    type: PieceType;
    color: Side;
}

/** Подробный ход chess.js: нужные здесь поля. */
export interface VerboseMove {
    color: Side;
    piece: PieceType;
    from: string;
    to: string;
    san: string;
    captured?: PieceType;
    promotion?: PieceType;
    /** Флаги chess.js: k — короткая рокировка, q — длинная, e — взятие на проходе. */
    flags: string;
}

// Порядок фигур в описании позиции: от короля к пешкам.
const ORDER: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const FILES = 'abcdefgh';

/** Клетка для программы чтения экрана: «e4, белый конь», «e4, пусто»; hidden — фигуру не называть (игра вслепую). */
export function squareLabel(square: string, piece: BoardPiece | null, t: Translate, hidden = false): string {
    if (hidden) return square;
    return piece ? t('a11y.square', {square, piece: t(`a11y.piece.${piece.color}${piece.type}`)})
        : t('a11y.emptySquare', {square});
}

/** Ход словами: «Белые: конь берёт f3, шах», «Чёрные: короткая рокировка», «Белые: пешка e8, превращение в ферзя, мат». */
export function moveWords(move: VerboseMove, t: Translate): string {
    const parts: string[] = [];
    if (move.flags.includes('k')) parts.push(t('a11y.castleShort'));
    else if (move.flags.includes('q')) parts.push(t('a11y.castleLong'));
    else {
        const noun = t(`a11y.noun.${move.piece}`);
        parts.push(move.captured ? t('a11y.captures', {piece: noun, from: move.from, to: move.to})
            : t('a11y.moves', {piece: noun, from: move.from, to: move.to}));
        if (move.flags.includes('e')) parts.push(t('a11y.enPassant'));
        if (move.promotion) parts.push(t(`a11y.promotion.${move.promotion}`));
    }
    if (move.san.endsWith('#')) parts.push(t('a11y.mate'));
    else if (move.san.endsWith('+')) parts.push(t('a11y.check'));
    return t('a11y.move', {side: t(move.color === 'w' ? 'a11y.white' : 'a11y.black'), words: parts.join(', ')});
}

/**
 * Позиция словами: по сторонам, фигуры от короля к пешкам, у каждой — её клетки: «Белые: король на g1; ферзь на
 * d1; пешка на a2, b2. Чёрные: …». board — 8 рядов с 8-й горизонтали по 1-ю (chess.js board()); null — пустая клетка.
 */
export function positionWords(board: (BoardPiece | null)[][], t: Translate): string {
    const squares: Record<string, string[]> = {};
    board.forEach((row, rowIndex) => row.forEach((piece, fileIndex) => {
        if (!piece) return;
        (squares[`${piece.color}${piece.type}`] ??= []).push(`${FILES[fileIndex]}${8 - rowIndex}`);
    }));
    const side = (color: Side) => {
        const groups = ORDER.filter((type) => squares[`${color}${type}`])
            .map((type) => t('a11y.group', {piece: t(`a11y.noun.${type}`), squares: squares[`${color}${type}`].sort().join(', ')}));
        return t('a11y.side', {side: t(color === 'w' ? 'a11y.white' : 'a11y.black'), pieces: groups.length ? groups.join('; ') : t('a11y.nothing')});
    };
    return `${side('w')} ${side('b')}`;
}

/**
 * Клетка, на которую переходит фокус по стрелке: стрелки — по экрану, поэтому при перевёрнутой доске направления
 * меняются. За краем доски фокус остаётся на месте.
 */
export function stepSquare(square: string, key: string, flipped: boolean): string {
    const step: Record<string, [number, number]> = {ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0]};
    const delta = step[key];
    if (!delta) return square;
    const sign = flipped ? -1 : 1;
    const file = FILES.indexOf(square[0]) + delta[0] * sign;
    const rank = Number(square[1]) + delta[1] * sign;
    return file < 0 || file > 7 || rank < 1 || rank > 8 ? square : `${FILES[file]}${rank}`;
}
