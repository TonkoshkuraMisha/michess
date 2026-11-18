// --- FILE: frontend/src/components/chessboard/boardUtils.ts ---
// Константы и чистые функции доски (вынесено из Chessboard.tsx): размер доски по окну, перевес в материале,
// копия партии chess.js, начальная позиция партии, проверка FEN, раскладка ходов по парам. Сервер не нужен:
// правила шахмат — библиотека chess.js, тексты — каталог сообщений (ключи board.*).

import {Chess} from 'chess.js';
import {t} from '../../i18n';

/** Вертикали слева направо и горизонтали сверху вниз — как их видят белые. */
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

/** Пределы стороны доски в пикселях (ползунок размера и уголок растягивания). */
export const MIN_BOARD_SIZE = 280;
export const MAX_BOARD_SIZE = 860;

export type PromotionPiece = 'q' | 'n' | 'r' | 'b';

// Название фигуры читается из каталога в момент показа (геттер): смена языка меняет подпись без перезагрузки.
function promotionOption(type: PromotionPiece): { type: PromotionPiece; readonly label: string } {
    return {
        type,
        get label() {
            return t(`board.pieces.${type}`);
        },
    };
}

/** Фигуры для выбора при превращении пешки, в порядке показа (PromotionDialog). */
export const PROMOTION_OPTIONS: Array<{ type: PromotionPiece; readonly label: string }> = [
    promotionOption('q'),
    promotionOption('n'),
    promotionOption('r'),
    promotionOption('b'),
];

/**
 * Наибольшая сторона доски, которая помещается в окно: по высоте — окно минус 220 px под остальную разметку,
 * по ширине — минус 850 px под боковые колонки на экране от 1280 px, иначе вся ширина минус 24 px. Не меньше
 * MIN_BOARD_SIZE и не больше MAX_BOARD_SIZE.
 */
export function getMaxViewportBoardSize(): number {
    if (typeof window === 'undefined') return 560;
    const availableHeight = window.innerHeight - 220;
    const availableWidth = window.innerWidth >= 1280
        ? window.innerWidth - 850
        : window.innerWidth - 24;
    const limit = Math.min(availableHeight, availableWidth, MAX_BOARD_SIZE);
    return Math.max(MIN_BOARD_SIZE, Math.min(limit, window.innerWidth - 24));
}

/** Размер доски по умолчанию — наибольший, что помещается в окно (двойной щелчок по уголку растягивания). */
export function getDefaultBoardSize(): number {
    if (typeof window !== 'undefined') {
        return getMaxViewportBoardSize();
    }
    return 540;
}

/** Условная ценность фигур в пешках — только для строки перевеса у имени игрока, на игру не влияет. */
export const PIECE_VALUES: Record<string, number> = {p: 1, n: 3, b: 3, r: 5, q: 9, k: 0};

/**
 * Перевес в материале и «взятые» фигуры по позиции на доске (boardState — результат board() из chess.js).
 * Взятые считаются как разница с полным начальным комплектом, а не по истории взятий: превращённая пешка
 * выглядит взятой, а в партии с нестандартной позиции список не имеет смысла (Chessboard его тогда не показывает).
 * whiteCapturedSymbols — чёрные фигуры, взятые белыми, и наоборот.
 */
export function calculateMaterialBalance(boardState: any[][]) {
    const startCounts: Record<string, number> = {p: 8, n: 2, b: 2, r: 2, q: 1};
    const currentWhite: Record<string, number> = {p: 0, n: 0, b: 0, r: 0, q: 0};
    const currentBlack: Record<string, number> = {p: 0, n: 0, b: 0, r: 0, q: 0};

    let whiteScore = 0;
    let blackScore = 0;

    for (const row of boardState) {
        for (const cell of row) {
            if (!cell) continue;
            const val = PIECE_VALUES[cell.type] || 0;
            if (cell.color === 'w') {
                whiteScore += val;
                if (currentWhite[cell.type] !== undefined) currentWhite[cell.type]++;
            } else {
                blackScore += val;
                if (currentBlack[cell.type] !== undefined) currentBlack[cell.type]++;
            }
        }
    }

    const whiteCapturedSymbols: string[] = [];
    const blackCapturedSymbols: string[] = [];
    const order = ['q', 'r', 'b', 'n', 'p'];
    const glyphs: Record<string, string> = {q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'};

    for (const t of order) {
        const missingBlack = Math.max(0, startCounts[t] - currentBlack[t]);
        for (let i = 0; i < missingBlack; i++) whiteCapturedSymbols.push(glyphs[t]);

        const missingWhite = Math.max(0, startCounts[t] - currentWhite[t]);
        for (let i = 0; i < missingWhite; i++) blackCapturedSymbols.push(glyphs[t]);
    }

    return {
        whiteAdvantage: Math.max(0, whiteScore - blackScore),
        blackAdvantage: Math.max(0, blackScore - whiteScore),
        whiteCapturedSymbols,
        blackCapturedSymbols
    };
}

/**
 * Независимая копия партии. Копируется через PGN, чтобы сохранить историю ходов (и заголовок FEN у партии с
 * произвольной позиции); у позиции без ходов и заголовков PGN пуст — тогда копируется только FEN.
 */
export function cloneChessInstance(source: Chess): Chess {
    const copy = new Chess();
    const currentPgn = source.pgn();
    if (currentPgn) {
        copy.loadPgn(currentPgn);
    } else {
        copy.load(source.fen());
    }
    return copy;
}

export const STANDARD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Начальная позиция партии, если она не обычная расстановка (из заголовка FEN в PGN), иначе null. */
export function customStartFen(source: Chess): string | null {
    const fen = source.header().FEN;
    return fen && fen !== STANDARD_START_FEN ? fen : null;
}

/**
 * Проверяет FEN теми же правилами, что и доска (chess.js); возвращает текст ошибки на языке игрока или null.
 * Позиция, в которой партия уже окончена (мат, пат, ничья), тоже отклоняется: играть с неё нечего.
 */
export function validateFen(fen: string): string | null {
    try {
        const probe = new Chess(fen.trim());
        if (probe.isGameOver()) return t('board.fenGameOver');
        return null;
    } catch {
        return t('board.fenInvalid');
    }
}

/** Строка списка ходов: номер хода, ход белых и ход чёрных с их индексами в истории полуходов. */
export interface HalfMovePair {
    moveNumber: number;
    /** undefined и whiteIdx === -1 — партия начата с хода чёрных, у первой пары нет хода белых. */
    whiteSan?: string;
    whiteIdx: number;
    blackSan?: string;
    blackIdx?: number;
}

/**
 * Раскладывает полуходы по парам «белые / чёрные». Партия с произвольной позиции может
 * начинаться с хода чёрных и не с первого хода — номер и сторона берутся из её FEN.
 */
export function pairHalfMoves(history: Array<{ san: string }>, startFen?: string | null): HalfMovePair[] {
    const fenParts = (startFen ?? '').trim().split(/\s+/);
    const blackStarts = fenParts[1] === 'b';
    const firstMoveNumber = Number(fenParts[5]) > 0 ? Number(fenParts[5]) : 1;

    const pairs: HalfMovePair[] = [];
    history.forEach((move, idx) => {
        const ply = idx + (blackStarts ? 1 : 0);
        const moveNumber = firstMoveNumber + Math.floor(ply / 2);
        if (ply % 2 === 0) {
            pairs.push({moveNumber, whiteSan: move.san, whiteIdx: idx});
        } else if (pairs.length === 0) {
            pairs.push({moveNumber, whiteIdx: -1, blackSan: move.san, blackIdx: idx});
        } else {
            pairs[pairs.length - 1].blackSan = move.san;
            pairs[pairs.length - 1].blackIdx = idx;
        }
    });
    return pairs;
}

/** Индекс полухода, который сейчас на доске: у живой позиции (viewIndex === -1) это последний ход истории. */
export function prevIndexHelper(viewIndex: number, historyLength: number): number {
    return viewIndex === -1 ? historyLength - 1 : viewIndex;
}
