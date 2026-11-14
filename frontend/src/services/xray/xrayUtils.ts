// --- FILE: frontend/src/services/xray/xrayUtils.ts ---
// «Рентген» доски (таск 12.1): чистые расчёты по позиции, без движка — контроль полей (с батареями), фигуры под
// ударом, перегруженные защитники, связки и сквозные удары, взятия (размен или выигрыш), защиты, шахи и маты,
// изолированные и проходные пешки, безопасные и опасные поля для выбранной фигуры. Всё — для любой стороны:
// «показать за соперника» — те же расчёты для другого цвета.

import {Chess} from 'chess.js';
import type {Move} from 'chess.js';

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface BoardPiece {
    type: PieceType;
    color: Color;
    square: string;
}

export const PIECE_VALUE: Record<PieceType, number> = {p: 1, n: 3, b: 3, r: 5, q: 9, k: 100};

const FILES = 'abcdefgh';
const ORTHOGONAL: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING: [number, number][] = [...ORTHOGONAL, ...DIAGONAL];

export function squareName(file: number, rank: number): string {
    return `${FILES[file]}${rank + 1}`;
}

function coords(square: string): [number, number] {
    return [FILES.indexOf(square[0]), Number(square[1]) - 1];
}

function onBoard(file: number, rank: number): boolean {
    return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

export function opposite(color: Color): Color {
    return color === 'w' ? 'b' : 'w';
}

/** Фигуры позиции по полям. */
export function piecesOf(fen: string): Map<string, BoardPiece> {
    const pieces = new Map<string, BoardPiece>();
    const placement = fen.split(' ')[0];
    let rank = 7;
    let file = 0;
    for (const ch of placement) {
        if (ch === '/') {
            rank -= 1;
            file = 0;
        } else if (/\d/.test(ch)) {
            file += Number(ch);
        } else {
            const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
            const square = squareName(file, rank);
            pieces.set(square, {type: ch.toLowerCase() as PieceType, color, square});
            file += 1;
        }
    }
    return pieces;
}

function slides(type: PieceType, direction: [number, number]): boolean {
    const diagonal = direction[0] !== 0 && direction[1] !== 0;
    if (type === 'q') return true;
    return diagonal ? type === 'b' : type === 'r';
}

export interface Attack {
    from: string;
    piece: BoardPiece;
    /** Удар через свою дальнобойную фигуру на той же линии (батарея). */
    xray: boolean;
}

/** Все удары по полям: для каждого поля — кто его бьёт (с батареями). */
export function attackMap(pieces: Map<string, BoardPiece>): Map<string, Attack[]> {
    const map = new Map<string, Attack[]>();
    const add = (square: string, attack: Attack) => {
        const list = map.get(square);
        if (list) list.push(attack);
        else map.set(square, [attack]);
    };
    for (const piece of pieces.values()) {
        const [f, r] = coords(piece.square);
        if (piece.type === 'p') {
            const dr = piece.color === 'w' ? 1 : -1;
            for (const df of [-1, 1]) {
                if (onBoard(f + df, r + dr)) add(squareName(f + df, r + dr), {from: piece.square, piece, xray: false});
            }
        } else if (piece.type === 'n' || piece.type === 'k') {
            for (const [df, dr] of piece.type === 'n' ? KNIGHT : KING) {
                if (onBoard(f + df, r + dr)) add(squareName(f + df, r + dr), {from: piece.square, piece, xray: false});
            }
        } else {
            const directions = piece.type === 'r' ? ORTHOGONAL : piece.type === 'b' ? DIAGONAL : KING;
            for (const direction of directions) {
                let xray = false;
                let file = f + direction[0];
                let rank = r + direction[1];
                while (onBoard(file, rank)) {
                    const square = squareName(file, rank);
                    add(square, {from: piece.square, piece, xray});
                    const blocker = pieces.get(square);
                    if (blocker) {
                        // Батарея: своя дальнобойная фигура той же линии «прозрачна» — удар идёт дальше.
                        if (blocker.color === piece.color && blocker.type !== 'k' && slides(blocker.type, direction)) {
                            xray = true;
                        } else {
                            break;
                        }
                    }
                    file += direction[0];
                    rank += direction[1];
                }
            }
        }
    }
    return map;
}

export interface SquareControl {
    white: number;
    black: number;
}

/** Контроль 64 полей: сколько фигур каждой стороны бьёт поле (с батареями). */
export function controlMap(pieces: Map<string, BoardPiece>, attacks = attackMap(pieces)): Map<string, SquareControl> {
    const control = new Map<string, SquareControl>();
    for (let file = 0; file < 8; file++) {
        for (let rank = 0; rank < 8; rank++) {
            const square = squareName(file, rank);
            const list = attacks.get(square) ?? [];
            control.set(square, {
                white: list.filter((a) => a.piece.color === 'w').length,
                black: list.filter((a) => a.piece.color === 'b').length,
            });
        }
    }
    return control;
}

function attackersBy(attacks: Map<string, Attack[]>, square: string, color: Color): Attack[] {
    return (attacks.get(square) ?? []).filter((a) => a.piece.color === color);
}

/**
 * Абсолютные связки обеих сторон: связанная фигура → поля, на которые она ещё может бить (линия связки
 * между королём и связывающей фигурой, включая её саму).
 */
export function absolutePins(pieces: Map<string, BoardPiece>): Map<string, Set<string>> {
    const pins = new Map<string, Set<string>>();
    for (const king of pieces.values()) {
        if (king.type !== 'k') continue;
        const [kf, kr] = coords(king.square);
        for (const direction of KING) {
            const line: string[] = [];
            let own: BoardPiece | null = null;
            let file = kf + direction[0];
            let rank = kr + direction[1];
            while (onBoard(file, rank)) {
                const square = squareName(file, rank);
                line.push(square);
                const other = pieces.get(square);
                if (other) {
                    if (other.color === king.color) {
                        if (own) break;
                        own = other;
                    } else {
                        if (own && other.type !== 'k' && other.type !== 'p' && other.type !== 'n'
                            && slides(other.type, direction)) {
                            pins.set(own.square, new Set(line));
                        }
                        break;
                    }
                }
                file += direction[0];
                rank += direction[1];
            }
        }
    }
    return pins;
}

/**
 * Удары, которые фигуры действительно могут нанести: связанная с королём фигура бьёт только вдоль линии связки.
 * Для «кто кого защищает» и «можно ли взять с выигрышем»; контроль полей (controlMap) остаётся полным — связанная
 * фигура по-прежнему не пускает короля соперника на свои поля.
 */
export function effectiveAttacks(pieces: Map<string, BoardPiece>, attacks = attackMap(pieces)): Map<string, Attack[]> {
    const pins = absolutePins(pieces);
    if (pins.size === 0) return attacks;
    const result = new Map<string, Attack[]>();
    for (const [square, list] of attacks) {
        result.set(square, list.filter((a) => {
            const line = pins.get(a.from);
            return !line || line.has(square);
        }));
    }
    return result;
}

/** Порядок участия в размене: сначала прямые удары по возрастанию ценности, затем батареи (за своей фигурой). */
function exchangeOrder(list: Attack[]): number[] {
    return [...list].sort((a, b) => Number(a.xray) - Number(b.xray) || PIECE_VALUE[a.piece.type] - PIECE_VALUE[b.piece.type])
        .map((a) => PIECE_VALUE[a.piece.type]);
}

/**
 * Статическая оценка размена (SEE) на поле: сколько выигрывает сторона, берущая фигуру ценностью victim первой
 * фигурой ценностью first; дальше стороны бьют по очереди самыми дешёвыми и могут остановиться в любой момент.
 */
export function exchangeGain(victim: number, first: number, takers: number[], defenders: number[]): number {
    const gains = [victim];
    let onSquare = first;
    const lists = [defenders.slice(), takers.slice()];
    for (let side = 0; lists[side].length > 0; side = 1 - side) {
        gains.push(onSquare - gains[gains.length - 1]);
        onSquare = lists[side].shift() as number;
    }
    for (let i = gains.length - 1; i > 0; i--) gains[i - 1] = -Math.max(-gains[i - 1], gains[i]);
    return gains[0] + 0; // без -0
}

/**
 * Фигура под ударом: размен на её поле, начатый самой дешёвой нападающей, выигрывает материал (SEE) —
 * учитывает число нападающих и защитников и связки (attacks — из effectiveAttacks). Король не в счёт.
 */
export function isEnPrise(piece: BoardPiece, attacks: Map<string, Attack[]>): boolean {
    if (piece.type === 'k') return false;
    const attackers = exchangeOrder(attackersBy(attacks, piece.square, opposite(piece.color)));
    if (attackers.length === 0) return false;
    const defenders = exchangeOrder(attackersBy(attacks, piece.square, piece.color));
    return exchangeGain(PIECE_VALUE[piece.type], attackers[0], attackers.slice(1), defenders) > 0;
}

/** Фигуры стороны color, которые можно взять с выигрышем. */
export function hangingPieces(pieces: Map<string, BoardPiece>, color: Color, attacks = effectiveAttacks(pieces)): string[] {
    return [...pieces.values()].filter((p) => p.color === color && isEnPrise(p, attacks)).map((p) => p.square);
}

export interface Overload {
    defender: string;
    duties: string[];
}

/** Перегруженные защитники стороны color: единственная защита двух и более атакованных фигур. */
export function overloadedDefenders(
    pieces: Map<string, BoardPiece>, color: Color, attacks = effectiveAttacks(pieces),
): Overload[] {
    const duties = new Map<string, string[]>();
    for (const piece of pieces.values()) {
        if (piece.color !== color || piece.type === 'k') continue;
        if (attackersBy(attacks, piece.square, opposite(color)).length === 0) continue;
        const defenders = attackersBy(attacks, piece.square, color).filter((a) => !a.xray);
        if (defenders.length !== 1) continue;
        const list = duties.get(defenders[0].from) ?? [];
        list.push(piece.square);
        duties.set(defenders[0].from, list);
    }
    return [...duties.entries()].filter(([, list]) => list.length >= 2).map(([defender, list]) => ({defender, duties: list}));
}

export interface LineTactic {
    kind: 'pin' | 'skewer';
    /** Нападающая дальнобойная фигура. */
    attacker: string;
    /** Фигура на линии впереди. */
    front: string;
    /** Фигура за ней. */
    behind: string;
    /** Связка с королём: передней фигурой ходить нельзя. */
    absolute: boolean;
}

/** Связки и сквозные удары фигур стороны color по фигурам соперника. */
export function lineTactics(
    pieces: Map<string, BoardPiece>, color: Color, attacks = effectiveAttacks(pieces),
): LineTactic[] {
    const result: LineTactic[] = [];
    for (const piece of pieces.values()) {
        if (piece.color !== color || !['b', 'r', 'q'].includes(piece.type)) continue;
        const [f, r] = coords(piece.square);
        const directions = piece.type === 'r' ? ORTHOGONAL : piece.type === 'b' ? DIAGONAL : KING;
        for (const direction of directions) {
            const found: BoardPiece[] = [];
            let file = f + direction[0];
            let rank = r + direction[1];
            while (onBoard(file, rank) && found.length < 2) {
                const other = pieces.get(squareName(file, rank));
                if (other) found.push(other);
                file += direction[0];
                rank += direction[1];
            }
            if (found.length < 2) continue;
            const [front, behind] = found;
            if (front.color === color || behind.color === color) continue;
            const frontValue = PIECE_VALUE[front.type];
            const behindValue = PIECE_VALUE[behind.type];
            if (behindValue > frontValue && behind.type !== 'p') {
                result.push({kind: 'pin', attacker: piece.square, front: front.square, behind: behind.square,
                    absolute: behind.type === 'k'});
            } else if (frontValue > behindValue && behind.type !== 'p' && (frontValue > PIECE_VALUE[piece.type]
                // Незащищённую переднюю фигуру можно взять и более ценной: ферзь бьёт сквозь ладью на слона.
                || attackersBy(attacks, front.square, front.color).length === 0)) {
                result.push({kind: 'skewer', attacker: piece.square, front: front.square, behind: behind.square,
                    absolute: front.type === 'k'});
            }
        }
    }
    return result;
}

/** Позиция, где ходит сторона color: «а что сделал бы соперник, если бы ходил он?». null — такая позиция невозможна. */
export function gameFor(
    fen: string, color: Color, pieces = piecesOf(fen), attacks?: Map<string, Attack[]>,
): Chess | null {
    const parts = fen.split(' ');
    if (parts[1] === color) return new Chess(fen);
    parts[1] = color;
    parts[3] = '-';
    // Если бы ходил color, а король соперника уже под шахом — такой позиции не бывает.
    const enemyKing = [...pieces.values()].find((p) => p.type === 'k' && p.color === opposite(color));
    if (enemyKing && attackersBy(attacks ?? attackMap(pieces), enemyKing.square, color).length > 0) return null;
    try {
        return new Chess(parts.join(' '));
    } catch {
        return null;
    }
}

export interface MoveArrow {
    from: string;
    to: string;
}

export interface CaptureArrow extends MoveArrow {
    /** winning — выигрыш материала (толстая стрелка), exchange — размен (тонкая). */
    kind: 'winning' | 'exchange';
}

/** Все ходы стороны color (подробно); невозможная позиция — пусто. */
export function verboseMoves(fen: string, color: Color, pieces = piecesOf(fen), attacks?: Map<string, Attack[]>): Move[] {
    return gameFor(fen, color, pieces, attacks)?.moves({verbose: true}) ?? [];
}

export function legalMoves(fen: string, color: Color, moves = verboseMoves(fen, color)): MoveArrow[] {
    const seen = new Set<string>();
    const arrows: MoveArrow[] = [];
    for (const move of moves) {
        const key = `${move.from}${move.to}`;
        if (seen.has(key)) continue; // превращения в разные фигуры — одна стрелка
        seen.add(key);
        arrows.push({from: move.from, to: move.to});
    }
    return arrows;
}

/** Взятия стороны color: выигрыш — размен на поле, начатый этим взятием, приносит материал (SEE, со связками), иначе размен. */
export function captures(
    fen: string, color: Color, pieces = piecesOf(fen), attacks = effectiveAttacks(pieces),
    moves = verboseMoves(fen, color, pieces, attacks),
): CaptureArrow[] {
    const seen = new Set<string>();
    const arrows: CaptureArrow[] = [];
    for (const move of moves) {
        if (!move.captured || seen.has(`${move.from}${move.to}`)) continue;
        seen.add(`${move.from}${move.to}`);
        const target = pieces.get(move.to);
        // Взятие на проходе: пешка соперника не на поле хода — размен на этом поле не считаем.
        const winning = target !== undefined && exchangeGain(
            PIECE_VALUE[target.type], PIECE_VALUE[move.piece as PieceType],
            exchangeOrder(attackersBy(attacks, move.to, color).filter((a) => a.from !== move.from)),
            exchangeOrder(attackersBy(attacks, move.to, target.color)),
        ) > 0;
        arrows.push({from: move.from, to: move.to, kind: winning ? 'winning' : 'exchange'});
    }
    return arrows;
}

/** Защиты стороны color: какая своя фигура прикрывает какую (без короля под защитой). */
export function defenses(pieces: Map<string, BoardPiece>, color: Color, attacks = effectiveAttacks(pieces)): MoveArrow[] {
    const arrows: MoveArrow[] = [];
    for (const piece of pieces.values()) {
        if (piece.color !== color || piece.type === 'k') continue;
        for (const defender of attackersBy(attacks, piece.square, color)) {
            if (!defender.xray) arrows.push({from: defender.from, to: piece.square});
        }
    }
    return arrows;
}

export interface CheckArrow extends MoveArrow {
    mate: boolean;
}

/** Шахи и маты, которые может дать сторона color. */
export function checks(fen: string, color: Color, moves = verboseMoves(fen, color)): CheckArrow[] {
    const byKey = new Map<string, CheckArrow>();
    for (const move of moves) {
        if (!move.san.includes('+') && !move.san.includes('#')) continue;
        const key = `${move.from}${move.to}`;
        const mate = move.san.includes('#');
        const existing = byKey.get(key);
        if (existing) existing.mate ||= mate;
        else byKey.set(key, {from: move.from, to: move.to, mate});
    }
    return [...byKey.values()];
}

export interface PawnFlags {
    isolated: string[];
    passed: string[];
}

/** Изолированные и проходные пешки стороны color. */
export function pawnFlags(pieces: Map<string, BoardPiece>, color: Color): PawnFlags {
    const own = [...pieces.values()].filter((p) => p.type === 'p' && p.color === color);
    const enemy = [...pieces.values()].filter((p) => p.type === 'p' && p.color !== color);
    const forward = color === 'w' ? 1 : -1;
    const isolated: string[] = [];
    const passed: string[] = [];
    for (const pawn of own) {
        const [f, r] = coords(pawn.square);
        if (!own.some((o) => Math.abs(coords(o.square)[0] - f) === 1)) isolated.push(pawn.square);
        const blocked = enemy.some((e) => {
            const [ef, er] = coords(e.square);
            return Math.abs(ef - f) <= 1 && (er - r) * forward > 0;
        });
        if (!blocked) passed.push(pawn.square);
    }
    return {isolated, passed};
}

export interface SquareSafety {
    square: string;
    safe: boolean;
}

/** Куда может пойти фигура с поля from и где она там окажется под ударом. */
export function destinationSafety(fen: string, from: string): SquareSafety[] {
    const pieces = piecesOf(fen);
    const piece = pieces.get(from);
    if (!piece) return [];
    const game = gameFor(fen, piece.color);
    if (!game) return [];
    const result: SquareSafety[] = [];
    const seen = new Set<string>();
    for (const move of game.moves({square: from as never, verbose: true})) {
        if (seen.has(move.to)) continue;
        seen.add(move.to);
        const after = new Chess(game.fen());
        after.move({from: move.from, to: move.to, promotion: move.promotion ?? 'q'});
        const afterPieces = piecesOf(after.fen());
        const moved = afterPieces.get(move.to);
        result.push({square: move.to, safe: !moved || !isEnPrise(moved, effectiveAttacks(afterPieces))});
    }
    return result;
}

export interface XrayReport {
    control: Map<string, SquareControl>;
    hanging: string[];
    overloaded: Overload[];
    lines: LineTactic[];
    captures: CaptureArrow[];
    defenses: MoveArrow[];
    checks: CheckArrow[];
    moves: MoveArrow[];
    pawns: PawnFlags;
}

/**
 * Полный «рентген» для стороны color: что она может (взятия, шахи, ходы, связки), что защищает, какие её фигуры
 * под ударом и перегружены, её пешечные слабости и сильные стороны. Контроль полей — для обеих сторон.
 */
export function xrayFor(fen: string, color: Color): XrayReport {
    // Позиция разбирается один раз: фигуры, карта ударов и ходы chess.js — общие для всех режимов.
    const pieces = piecesOf(fen);
    const attacks = attackMap(pieces);
    // Защиты и размены — без ударов связанных фигур; контроль полей — полный.
    const effective = effectiveAttacks(pieces, attacks);
    const moves = verboseMoves(fen, color, pieces, attacks);
    return {
        control: controlMap(pieces, attacks),
        hanging: hangingPieces(pieces, color, effective),
        overloaded: overloadedDefenders(pieces, color, effective),
        lines: lineTactics(pieces, color, effective),
        captures: captures(fen, color, pieces, effective, moves),
        defenses: defenses(pieces, color, effective),
        checks: checks(fen, color, moves),
        moves: legalMoves(fen, color, moves),
        pawns: pawnFlags(pieces, color),
    };
}
