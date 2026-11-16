// Игра с форой (таск 21.1): готовые форы для партии с ботом. Материальная фора — начальная позиция без фигуры у
// дающего фору (ферзевый конь или ладья, ферзь, f-пешка; рокировка с убранной ладьёй пропадает); фора по времени —
// у дающего треть времени; «песочные часы» — время, потраченное одним, прибавляется другому. Партия идёт с
// позиции (таск 9.6), рейтинг не меняет.

export const ODDS = ['none', 'knight', 'rook', 'queen', 'pawn', 'time', 'hourglass'] as const;
export type OddsKind = typeof ODDS[number];
export type OddsGiver = 'me' | 'opponent';

export interface OddsChoice {
    kind: OddsKind;
    giver: OddsGiver;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Поле убираемой фигуры: [белые, чёрные].
const REMOVED: Partial<Record<OddsKind, [string, string]>> = {
    knight: ['b1', 'b8'],
    rook: ['a1', 'a8'],
    queen: ['d1', 'd8'],
    pawn: ['f2', 'f7'],
};

/** Начальная позиция с материальной форой; null — фора не материальная. */
export function oddsFen(kind: OddsKind, giver: 'white' | 'black'): string | null {
    const squares = REMOVED[kind];
    if (!squares) return null;
    const square = squares[giver === 'white' ? 0 : 1];
    const [placement, , , ...rest] = START.split(' ');
    const rows = placement.split('/').map((row) => row.replace(/\d/g, (n) => '1'.repeat(Number(n))).split(''));
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    rows[8 - rank][file] = '1';
    const packed = rows.map((row) => row.join('').replace(/1+/g, (ones) => String(ones.length))).join('/');
    let castling = 'KQkq';
    if (kind === 'rook') castling = castling.replace(giver === 'white' ? 'Q' : 'q', '');
    return [packed, 'w', castling || '-', ...rest].join(' ');
}

/** Стартовое время сторон с форой по времени: у дающего фору — треть (не меньше минуты). */
export function oddsTimes(kind: OddsKind, giver: 'white' | 'black', whiteMs: number, blackMs: number): { white: number; black: number } {
    if (kind !== 'time') return {white: whiteMs, black: blackMs};
    const cut = (ms: number) => Math.max(60_000, Math.round(ms / 3));
    return giver === 'white' ? {white: cut(whiteMs), black: blackMs} : {white: whiteMs, black: cut(blackMs)};
}

/** Форы для партии с человеком по ссылке (сервер, src/services/odds.py): материальные и по времени. */
export const PVP_ODDS = ['none', 'knight', 'rook', 'queen', 'pawn', 'time'] as const;
export type PvpOddsKind = typeof PVP_ODDS[number];

/** Поля приглашения для сервера: giver «me» — фору даёт создатель ссылки. */
export function inviteOddsFields(odds: OddsChoice): { odds_kind: string; odds_giver: 'creator' | 'acceptor' } {
    return {odds_kind: odds.kind === 'none' || odds.kind === 'hourglass' ? '' : odds.kind,
        odds_giver: odds.giver === 'me' ? 'creator' : 'acceptor'};
}

/** Кто даёт фору по цвету: «я» — мой цвет, «соперник» — противоположный. */
export function giverColor(giver: OddsGiver, myColor: 'white' | 'black'): 'white' | 'black' {
    if (giver === 'me') return myColor;
    return myColor === 'white' ? 'black' : 'white';
}
