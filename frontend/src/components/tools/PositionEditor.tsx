// --- FILE: frontend/src/components/tools/PositionEditor.tsx ---
// Редактор позиции (таск 16.4): расстановка фигур щелчком (выбранная фигура из палитры или ластик), очередь хода,
// права рокировки (недоступные по расстановке — выключены), проверка корректности по правилам (chess.js).
// Без сети: результат — FEN, который родитель получает через onUse. Используется в ToolsPage.tsx (вкладка редактора)
// и в тренажёре памяти (trainers/MemoryGames.tsx берёт fenOf для показа расстановки игрока).

import {useMemo, useState} from 'react';
import {Chess} from 'chess.js';
import {Eraser} from 'lucide-react';
import {useI18n} from '../../i18n';
import {validateFen} from '../chessboard/boardUtils';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {STANDARD_FEN} from '../../services/pgnExport';

// Палитра: фигуры белых (заглавные) и чёрных (строчные) в обозначениях FEN; кисть 'x' — ластик.
const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'] as const;
// Значки фигур для кнопок палитры (текста для игрока здесь нет).
const GLYPHS: Record<string, string> = {K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'};
// Четыре права рокировки: на каких полях должны стоять король и ладья, чтобы право можно было включить.
const CASTLING = [
    {flag: 'K', king: 'e1', rook: 'h1', piece: 'K', rookPiece: 'R'},
    {flag: 'Q', king: 'e1', rook: 'a1', piece: 'K', rookPiece: 'R'},
    {flag: 'k', king: 'e8', rook: 'h8', piece: 'k', rookPiece: 'r'},
    {flag: 'q', king: 'e8', rook: 'a8', piece: 'k', rookPiece: 'r'},
] as const;

// Расстановка: поле («e4») → фигура в обозначении FEN.
type Placement = Record<string, string>;

/** Расстановка из первой части FEN. */
export function placementOf(fen: string): Placement {
    const result: Placement = {};
    fen.split(' ')[0].split('/').forEach((row, i) => {
        let file = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) file += Number(ch);
            else result[`${String.fromCharCode(97 + file++)}${8 - i}`] = ch;
        }
    });
    return result;
}

/** FEN из расстановки: права рокировки остаются только те, что возможны по положению короля и ладьи; взятия на проходе нет. */
export function fenOf(placement: Placement, turn: 'w' | 'b', castling: string): string {
    const rows: string[] = [];
    for (let rank = 8; rank >= 1; rank--) {
        let row = '';
        let empty = 0;
        for (let file = 0; file < 8; file++) {
            const piece = placement[`${String.fromCharCode(97 + file)}${rank}`];
            if (piece) {
                row += (empty || '') + piece;
                empty = 0;
            } else {
                empty++;
            }
        }
        rows.push(row + (empty || ''));
    }
    const rights = CASTLING.filter((c) => castling.includes(c.flag) && placement[c.king] === c.piece && placement[c.rook] === c.rookPiece)
        .map((c) => c.flag).join('');
    return `${rows.join('/')} ${turn} ${rights || '-'} - 0 1`;
}

/** Ошибка позиции (ключ каталога) или null: короли, пешки на крайних горизонталях, шах стороне, которая не ходит. */
export function positionProblem(placement: Placement, fen: string): string | null {
    const pieces = Object.entries(placement);
    if (pieces.filter(([, p]) => p === 'K').length !== 1 || pieces.filter(([, p]) => p === 'k').length !== 1) return 'tools.editor.needKings';
    if (pieces.some(([square, p]) => (p === 'P' || p === 'p') && (square[1] === '1' || square[1] === '8'))) return 'tools.editor.pawnsOnEdge';
    try {
        const game = new Chess(fen);
        const flipped = new Chess(fen.replace(/ [wb] /, (m) => (m === ' w ' ? ' b ' : ' w ')), {skipValidation: true});
        if (flipped.inCheck()) return 'tools.editor.opponentInCheck';
        if (game.isGameOver()) return 'tools.editor.gameOver';
    } catch {
        return 'tools.editor.invalid';
    }
    return null;
}

// initialFen — с чего начать (текущая позиция доски); onUse — получить готовый FEN, вызывается только для корректной позиции.
interface Props {
    initialFen: string;
    onUse: (fen: string) => void;
}

/** Редактор: доска-холст, палитра, очередь хода, права рокировки и вердикт positionProblem. */
export function PositionEditor({initialFen, onUse}: Props) {
    const {t} = useI18n();
    const [placement, setPlacement] = useState<Placement>(() => placementOf(initialFen));
    const [turn, setTurn] = useState<'w' | 'b'>(initialFen.split(' ')[1] === 'b' ? 'b' : 'w');
    const [castling, setCastling] = useState(initialFen.split(' ')[2] ?? 'KQkq');
    const [brush, setBrush] = useState<string>('P');
    const [orientation, setOrientation] = useState<'white' | 'black'>('white');

    const fen = useMemo(() => fenOf(placement, turn, castling), [placement, turn, castling]);
    const problem = positionProblem(placement, fen);

    const place = (square: string) => setPlacement((current) => {
        const next = {...current};
        if (brush === 'x' || next[square] === brush) delete next[square];
        else next[square] = brush;
        return next;
    });
    const toggleCastle = (flag: string) => setCastling((c) => (c.includes(flag) ? c.replace(flag, '') : c + flag));
    const load = (source: string) => {
        setPlacement(placementOf(source));
        setTurn(source.split(' ')[1] === 'b' ? 'b' : 'w');
        setCastling(source.split(' ')[2] ?? '-');
    };

    return (
        <div className="flex flex-col lg:flex-row gap-5 items-start" data-testid="position-editor">
            <div className="w-full max-w-[520px] flex flex-col gap-2">
                <PuzzleBoard fen={fen} orientation={orientation} interactive onMove={() => undefined} onSquare={place}/>
                <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label={t('tools.editor.palette')}>
                    {PIECES.map((p) => (
                        <button key={p} type="button" role="radio" aria-checked={brush === p} onClick={() => setBrush(p)}
                                data-testid={`brush-${p}`} aria-label={p}
                                className={`text-2xl leading-none py-1 rounded border ${brush === p ? 'bg-amber-700 border-amber-300' : 'bg-black/30 border-amber-900/50'}`}>
                            {GLYPHS[p]}
                        </button>
                    ))}
                    <button type="button" role="radio" aria-checked={brush === 'x'} onClick={() => setBrush('x')} data-testid="brush-erase"
                            aria-label={t('tools.editor.erase')}
                            className={`flex items-center justify-center rounded border ${brush === 'x' ? 'bg-amber-700 border-amber-300' : 'bg-black/30 border-amber-900/50'}`}>
                        <Eraser size={18}/>
                    </button>
                </div>
            </div>
            <div className="flex-1 flex flex-col gap-3 text-sm min-w-0">
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => load(STANDARD_FEN)} className="px-2 py-1 rounded bg-black/30 border border-amber-900/50">{t('tools.editor.start')}</button>
                    <button type="button" onClick={() => setPlacement({})} data-testid="editor-clear" className="px-2 py-1 rounded bg-black/30 border border-amber-900/50">{t('tools.editor.clear')}</button>
                    <button type="button" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="px-2 py-1 rounded bg-black/30 border border-amber-900/50">{t('common.flipBoard')}</button>
                </div>
                <fieldset className="flex gap-3 items-center">
                    <legend className="sr-only">{t('tools.editor.turn')}</legend>
                    <span>{t('tools.editor.turn')}:</span>
                    {(['w', 'b'] as const).map((side) => (
                        <label key={side} className="flex items-center gap-1">
                            <input type="radio" name="turn" checked={turn === side} onChange={() => setTurn(side)} data-testid={`turn-${side}`}/>
                            {t(side === 'w' ? 'tools.editor.white' : 'tools.editor.black')}
                        </label>
                    ))}
                </fieldset>
                <div className="flex flex-wrap gap-3 items-center">
                    <span>{t('tools.editor.castling')}:</span>
                    {CASTLING.map((c) => {
                        const possible = placement[c.king] === c.piece && placement[c.rook] === c.rookPiece;
                        return (
                            <label key={c.flag} className={`flex items-center gap-1 ${possible ? '' : 'opacity-40'}`}>
                                <input type="checkbox" disabled={!possible} checked={possible && castling.includes(c.flag)}
                                       onChange={() => toggleCastle(c.flag)}/>
                                {t(`tools.editor.castle.${c.flag === c.flag.toUpperCase() ? 'white' : 'black'}${c.flag.toLowerCase() === 'k' ? 'Short' : 'Long'}`)}
                            </label>
                        );
                    })}
                </div>
                <code className="block bg-black/40 rounded p-2 break-all text-xs" data-testid="editor-fen">{fen}</code>
                {problem
                    ? <p className="text-rose-300" role="alert" data-testid="editor-problem">{t(problem as never)}</p>
                    : <p className="text-emerald-300" data-testid="editor-ok">{t('tools.editor.valid')}</p>}
                <button type="button" disabled={Boolean(problem) || validateFen(fen) !== null} onClick={() => onUse(fen)}
                        data-testid="editor-use"
                        className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold disabled:opacity-40">
                    {t('tools.editor.use')}
                </button>
            </div>
        </div>
    );
}
