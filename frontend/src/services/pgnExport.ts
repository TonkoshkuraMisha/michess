// --- FILE: frontend/src/services/pgnExport.ts ---
// Экспорт PGN (таск 16.4): линия из «Инструментов» и партия с комментариями разбора из просмотра партии. Комментарии
// идут в фигурных скобках после хода, оценка — в стандартной форме [%eval …], значки ходов (!, ?!, ?, ??) — после SAN.
// Файл собирается целиком в браузере, сервер не участвует. Текст комментария (вместе с [%eval …]) готовит
// вызывающий: здесь он только чистится от фигурных скобок и вставляется после хода.

import {Chess} from 'chess.js';

/** Начальная позиция обычных шахмат: с неё теги SetUp и FEN в PGN не пишутся. */
export const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Ход для записи в PGN. */
export interface PgnMove {
    san: string;
    /** Значок хода: !, ?!, ?, ?? (пусто — без значка). */
    symbol?: string;
    comment?: string | null;
}

/** Данные для buildPgn. */
export interface PgnInput {
    /** Теги PGN; пустые значения пропускаются, недостающие из семи обязательных заполняются знаком «?». */
    headers?: Record<string, string | null | undefined>;
    /** Позиция начала; если это не начальная позиция — в PGN добавляются теги SetUp и FEN. */
    startFen?: string | null;
    moves: PgnMove[];
    /** «1-0», «0-1», «1/2-1/2» или «*»; всё остальное записывается как «*». */
    result?: string | null;
}

/** Фигурные скобки внутри комментария закрыли бы его раньше времени — убираются; пробелы и переносы сжимаются. */
function escapeComment(text: string): string {
    return text.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Текст PGN: теги, затем ходы с номерами (строки не длиннее 80 символов) и результат. Номер «N...» перед ходом
 * чёрных ставится в начале записи и после комментария — как требует стандарт PGN.
 */
export function buildPgn({headers = {}, startFen, moves, result}: PgnInput): string {
    const custom = startFen && startFen !== STANDARD_FEN ? startFen : null;
    const final = result && /^(1-0|0-1|1\/2-1\/2|\*)$/.test(result) ? result : '*';
    const tags: Record<string, string> = {
        Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?',
        ...Object.fromEntries(Object.entries(headers).filter(([, v]) => v)) as Record<string, string>,
        Result: final,
    };
    if (custom) {
        tags.SetUp = '1';
        tags.FEN = custom;
    }
    const lines = Object.entries(tags).map(([key, value]) => `[${key} "${value.replace(/"/g, "'")}"]`);
    const blackFirst = custom ? custom.split(' ')[1] === 'b' : false;
    const firstNumber = custom ? Number(custom.split(' ')[5] ?? 1) || 1 : 1;
    const tokens: string[] = [];
    moves.forEach((move, i) => {
        const ply = i + (blackFirst ? 1 : 0);
        const number = firstNumber + Math.floor(ply / 2);
        if (ply % 2 === 0) tokens.push(`${number}.`);
        else if (i === 0 || moves[i - 1]?.comment) tokens.push(`${number}...`);
        tokens.push(`${move.san}${move.symbol ?? ''}`);
        if (move.comment && escapeComment(move.comment)) tokens.push(`{${escapeComment(move.comment)}}`);
    });
    tokens.push(final);
    // Строки movetext — не длиннее 80 символов.
    const body: string[] = [];
    let line = '';
    for (const token of tokens) {
        if (line && line.length + token.length + 1 > 80) {
            body.push(line);
            line = token;
        } else {
            line = line ? `${line} ${token}` : token;
        }
    }
    if (line) body.push(line);
    return `${lines.join('\n')}\n\n${body.join('\n')}\n`;
}

/** SAN ходов линии из позиции startFen; нелегальный ход — исключение chess.js. */
export function sansOf(startFen: string, uciMoves: string[]): string[] {
    const game = new Chess(startFen);
    return uciMoves.map((uci) => game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]}).san);
}

/** Отдать текст браузеру как скачиваемый файл PGN (временная ссылка на Blob). */
export function downloadText(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], {type: 'application/x-chess-pgn'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
