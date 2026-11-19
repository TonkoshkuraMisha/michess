// --- FILE: frontend/src/components/trainers/BoardPuzzleGames.tsx ---
// Головоломки на доске (таск 19.4): расстановки (ферзи, ладьи, слоны, кони, доминирование) и «Обход конём».
// Доска N×N своя, щелчками: работает и на телефоне.
// Данные: чистые правила trainers/boardPuzzles.ts (задачи, проверки, подсказка по правилу Варнсдорфа); найденные решения расстановок
// запоминаются в localStorage (SOLUTIONS_KEY); цвета клеток — тема доски из config/boardAppearance.ts. Запускается из TrainersPage.tsx.

import {useMemo, useState} from 'react';
import {useI18n} from '../../i18n';
import {BOARD_THEMES, getSavedBoardThemeKey} from '../../config/boardAppearance';
import {
    CLOSED_TOUR_SCORE, OPEN_TOUR_SCORE, allQueenSolutions, conflicts, isClosedTour, isKnightMove, isSolved, isTour, key, knightMoves,
    placementPuzzle, solutionKey, tourSize, uncovered, warnsdorffHint,
} from '../../trainers/boardPuzzles';
import type {Cell, Piece} from '../../trainers/boardPuzzles';

/** Общие свойства игр: уровень, seed и onFinish(очки, ошибки). */
interface GameProps {
    level: number;
    seed: number;
    onFinish: (score: number, mistakes: number) => void;
}

/** Значки фигур на доске расстановок. */
const GLYPH: Record<Piece, string> = {Q: '♛', R: '♜', B: '♝', N: '♞'};
/** Буквы вертикалей для атрибута data-cell клеток. */
const FILES = 'abcdefgh';

/**
 * Доска size×size из кнопок. Подпись и подсветка клетки приходят из render: bad — конфликт, dim — не прикрыта,
 * hint — подсказка, last — текущая.
 */
function Grid({size, render, onCell}: { size: number; render: (cell: Cell) => { label?: string; tone?: 'bad' | 'dim' | 'hint' | 'last' }; onCell: (cell: Cell) => void }) {
    const theme = BOARD_THEMES[getSavedBoardThemeKey()] ?? BOARD_THEMES.walnut;
    const rows = Array.from({length: size}, (_, i) => size - 1 - i);
    return (
        <div className="grid w-full max-w-[460px] aspect-square rounded overflow-hidden border-2 border-black/60 select-none"
             style={{gridTemplateColumns: `repeat(${size}, 1fr)`}} data-testid="puzzle-grid">
            {rows.flatMap((y) => Array.from({length: size}, (_, x) => {
                const cell: Cell = [x, y];
                const {label, tone} = render(cell);
                const dark = (x + y) % 2 === 0;
                const overlay = tone === 'bad' ? 'bg-rose-500/55' : tone === 'dim' ? 'bg-sky-500/30' : tone === 'hint' ? 'bg-emerald-400/60'
                    : tone === 'last' ? 'bg-amber-300/45' : '';
                return (
                    <button key={key(cell)} type="button" data-cell={`${FILES[x]}${y + 1}`} onClick={() => onCell(cell)}
                            className="relative flex items-center justify-center cursor-pointer text-[min(6vw,2rem)] font-bold leading-none"
                            style={{backgroundColor: dark ? theme.dark : theme.light}}>
                        {overlay && <span className={`absolute inset-0 ${overlay}`}/>}
                        {label && <span className="relative text-acacia-dark drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">{label}</span>}
                    </button>
                );
            }))}
        </div>
    );
}

/** localStorage-ключ найденных решений расстановки id (список ключей решений); только в этом браузере. */
const SOLUTIONS_KEY = (id: string) => `regence_placement_solutions_${id}`;

/** Найденные ранее решения расстановки; недоступное хранилище — пустой список. */
function readSolutions(id: string): string[] {
    try {
        return JSON.parse(localStorage.getItem(SOLUTIONS_KEY(id)) ?? '[]') as string[];
    } catch {
        return [];
    }
}

/**
 * Расстановка count фигур: без боя друг друга (independent) или так, чтобы прикрыть все клетки (dominate). Очки — 100 минус 10
 * за ошибку, не меньше 10. Для ферзей показано число всех решений.
 */
export function PlacementGame({level, onFinish}: GameProps) {
    const {t} = useI18n();
    const puzzle = placementPuzzle(level);
    const [cells, setCells] = useState<Cell[]>([]);
    const [mistakes, setMistakes] = useState(0);
    const [found, setFound] = useState<string[]>(() => readSolutions(puzzle.id));
    const total = useMemo(() => (puzzle.piece === 'Q' && puzzle.goal === 'independent' ? allQueenSolutions(puzzle.size).length : null), [puzzle]);
    const bad = conflicts(puzzle.piece, cells, puzzle.size);
    const open = puzzle.goal === 'dominate' ? new Set(uncovered(puzzle.piece, cells, puzzle.size).map(key)) : new Set<string>();

    const toggle = (cell: Cell) => {
        const k = key(cell);
        if (cells.some((c) => key(c) === k)) {
            setCells(cells.filter((c) => key(c) !== k));
            return;
        }
        if (cells.length >= puzzle.count) return;
        const next = [...cells, cell];
        let nextMistakes = mistakes;
        if (puzzle.goal === 'independent' && conflicts(puzzle.piece, next, puzzle.size).has(k)) setMistakes((nextMistakes = mistakes + 1));
        setCells(next);
        if (isSolved(puzzle, next)) {
            const solution = solutionKey(next);
            const all = found.includes(solution) ? found : [...found, solution];
            setFound(all);
            try {
                localStorage.setItem(SOLUTIONS_KEY(puzzle.id), JSON.stringify(all));
            } catch {
                // без хранилища счётчик живёт до перезагрузки
            }
            onFinish(Math.max(10, 100 - nextMistakes * 10), nextMistakes);
        }
    };

    return (
        <div className="flex flex-col gap-3 items-start" data-testid="placement-game">
            <p className="font-bold text-amber-200">{t(`trainers.boardPuzzles.puzzles.${puzzle.id}` as never)}</p>
            <p className="text-sm" data-testid="placement-status">
                {t('trainers.boardPuzzles.placed', {n: cells.length, total: puzzle.count})}
                {bad.size > 0 && <span className="text-rose-300"> · {t('trainers.boardPuzzles.conflict')}</span>}
                {puzzle.goal === 'dominate' && <span> · {t('trainers.boardPuzzles.uncovered', {n: open.size})}</span>}
            </p>
            <Grid size={puzzle.size} onCell={toggle} render={(cell) => {
                const k = key(cell);
                const placed = cells.some((c) => key(c) === k);
                return {label: placed ? GLYPH[puzzle.piece] : undefined, tone: placed && bad.has(k) ? 'bad' : !placed && open.has(k) ? 'dim' : undefined};
            }}/>
            {total !== null && (
                <p className="text-sm text-boxwood/80" data-testid="placement-found">{t('trainers.boardPuzzles.found', {n: found.length, total})}</p>
            )}
            <button type="button" onClick={() => setCells([])} className="text-sm text-amber-400 hover:underline">{t('trainers.boardPuzzles.clear')}</button>
        </div>
    );
}

/**
 * Обход конём доски tourSize(level): очки — CLOSED_TOUR_SCORE (замкнутый) или OPEN_TOUR_SCORE минус 5 за подсказку, не более 90.
 * Недопустимый ход — ошибка, ход не принимается.
 */
export function KnightTourGame({level, onFinish}: GameProps) {
    const {t} = useI18n();
    const size = tourSize(level);
    const [path, setPath] = useState<Cell[]>([]);
    const [hints, setHints] = useState(0);
    const [hint, setHint] = useState<Cell | null>(null);
    const [mistakes, setMistakes] = useState(0);
    const order = useMemo(() => new Map(path.map((c, i) => [key(c), i + 1])), [path]);
    const visited = new Set(path.map(key));
    const stuck = path.length > 0 && path.length < size * size && knightMoves(path[path.length - 1], size, visited).length === 0;

    const step = (cell: Cell) => {
        if (path.length > 0 && (!isKnightMove(path[path.length - 1], cell) || visited.has(key(cell)))) {
            setMistakes((m) => m + 1);
            return;
        }
        const next = [...path, cell];
        setPath(next);
        setHint(null);
        if (isTour(next, size)) {
            const base = isClosedTour(next, size) ? CLOSED_TOUR_SCORE : OPEN_TOUR_SCORE;
            onFinish(base - Math.min(90, hints * 5), mistakes);
        }
    };

    return (
        <div className="flex flex-col gap-3 items-start" data-testid="tour-game">
            <p className="text-sm" data-testid="tour-status">
                {path.length === 0 ? t('trainers.boardPuzzles.tourStart') : t('trainers.boardPuzzles.tourProgress', {n: path.length, total: size * size})}
                {stuck && <span className="text-rose-300" data-testid="tour-stuck"> · {t('trainers.boardPuzzles.stuck')}</span>}
            </p>
            <Grid size={size} onCell={step} render={(cell) => {
                const n = order.get(key(cell));
                const isLast = path.length > 0 && key(path[path.length - 1]) === key(cell);
                return {label: n ? (isLast ? '♞' : String(n)) : undefined, tone: hint && key(hint) === key(cell) ? 'hint' : isLast ? 'last' : undefined};
            }}/>
            <div className="flex gap-2">
                <button type="button" disabled={path.length === 0 || stuck} data-testid="tour-hint"
                        onClick={() => {
                            setHint(warnsdorffHint(path, size));
                            setHints((h) => h + 1);
                        }}
                        className="px-3 py-1.5 rounded bg-black/40 border border-amber-800/60 disabled:opacity-40">{t('trainers.boardPuzzles.hint')}</button>
                <button type="button" disabled={path.length === 0} data-testid="tour-undo" onClick={() => setPath(path.slice(0, -1))}
                        className="px-3 py-1.5 rounded bg-black/40 border border-amber-800/60 disabled:opacity-40">{t('trainers.boardPuzzles.undo')}</button>
            </div>
            <p className="text-xs text-boxwood/70">{t('trainers.boardPuzzles.tourRule')}</p>
        </div>
    );
}
