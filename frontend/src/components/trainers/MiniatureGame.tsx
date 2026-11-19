// --- FILE: frontend/src/components/trainers/MiniatureGame.tsx ---
// «Миниатюры» (таск 27.9): короткая партия из библиотеки, закончившаяся матом. Позиция перед последним ходом — найти
// мат (засчитывается любой матующий ход, не только ход партии). После ответа доска не застывает: верный ход стоит на
// доске, неверный — видна стрелка хода партии; позицию можно доиграть (usePositionExplorer). И ссылка на партию.
// Данные: GET /library/miniatures (services/library.ts → src/api/library.py, src/services/miniatures.py): партии библиотеки, закончившиеся матом
// за MAX_PLIES полуходов. Запускается из TrainersPage.tsx (тренажёр miniatures); 10 очков за каждый найденный мат.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {Chess} from 'chess.js';
import {useI18n} from '../../i18n';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {ExplorerControls, usePositionExplorer} from '../puzzles/usePositionExplorer';
import {libraryApi} from '../../services/library';
import type {LibraryMiniature} from '../../services/library';

/** Позиций в попытке; уходит серверу как count. */
export const MINIATURE_ROUNDS = 10;

/** Свойства игры: seed (тот же seed — тот же набор) и onFinish(очки, ошибки). */
interface Props {
    seed: number;
    onFinish: (score: number, mistakes: number) => void;
}

/** Даёт ли ход uci мат в позиции fen. */
export function isMate(fen: string, uci: string): boolean {
    const game = new Chess(fen);
    try {
        game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q'});
    } catch {
        return false;
    }
    return game.isCheckmate();
}

/** Попытка из MINIATURE_ROUNDS позиций; пока набор грузится или загрузка не удалась, рисуется заглушка. */
export function MiniatureGame({seed, onFinish}: Props) {
    const {t} = useI18n();
    const [items, setItems] = useState<LibraryMiniature[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [index, setIndex] = useState(0);
    const [verdict, setVerdict] = useState<{ ok: boolean; move: string } | null>(null);
    const [score, setScore] = useState({correct: 0, wrong: 0});
    const explorer = usePositionExplorer();

    useEffect(() => {
        let alive = true;
        libraryApi.miniatures(MINIATURE_ROUNDS, seed)
            .then((body) => alive && setItems(body.miniatures))
            .catch(() => alive && setFailed(true));
        return () => {
            alive = false;
        };
    }, [seed]);

    if (failed) return <p className="text-sm text-rose-300">{t('trainers.memory.noPositions')}</p>;
    if (!items) return <p className="text-sm text-boxwood/70">{t('trainers.memory.loading')}</p>;
    const item = items[index];
    if (!item) return <p className="text-sm text-rose-300" data-testid="miniature-empty">{t('trainers.memory.noPositions')}</p>;
    const white = item.fen.split(' ')[1] === 'w';

    const onMove = (uci: string) => {
        if (verdict) {
            explorer.play(uci);
            return;
        }
        const ok = isMate(item.fen, uci);
        setVerdict({ok, move: uci});
        setScore((s) => (ok ? {...s, correct: s.correct + 1} : {...s, wrong: s.wrong + 1}));
        // Верный ход ставится на доску; неверный — нет: с позиции задачи видна стрелка хода партии, его можно сыграть.
        explorer.start(item.fen, ok ? [uci] : []);
    };
    const next = () => {
        if (index + 1 >= items.length) {
            onFinish(score.correct * 10, score.wrong);
            return;
        }
        setIndex((i) => i + 1);
        setVerdict(null);
        explorer.stop();
    };
    // Стрелка хода партии — только пока на доске позиция задачи (после неверного ответа).
    const shown = verdict && !verdict.ok && explorer.plies === 0 ? item.answer : null;

    return (
        <div className="flex flex-col gap-3" data-testid="miniature-game">
            <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-bold text-amber-200">{t('trainers.calc.question', {n: index + 1, total: items.length})}</span>
                <span className="text-sm" data-testid="quiz-score">{t('trainers.coord.score', {score: score.correct, mistakes: score.wrong})}</span>
            </div>
            <p className="text-sm text-boxwood/80" data-testid="miniature-players">
                {item.white} — {item.black}{item.year ? `, ${item.year}` : ''}
            </p>
            <p className="text-lg">{t(white ? 'trainers.miniaturePromptWhite' : 'trainers.miniaturePromptBlack', {moves: Math.ceil((item.moves.length + 1) / 2)})}</p>
            <div className="w-full max-w-[420px]">
                <PuzzleBoard fen={explorer.fen ?? item.fen} orientation={white ? 'white' : 'black'} interactive onMove={onMove}
                             lastMove={explorer.lastMove} sound={explorer.active}
                             arrows={shown ? [{from: shown.slice(0, 2), to: shown.slice(2, 4), color: 'yellow'}] : []}/>
            </div>
            <ExplorerControls explorer={explorer}/>
            {verdict && (
                <div className="flex flex-wrap items-center gap-3">
                    <span className={verdict.ok ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'} data-testid="miniature-verdict">
                        {t(verdict.ok ? 'trainers.miniatureRight' : 'trainers.miniatureWrong')}
                    </span>
                    <button type="button" onClick={next} data-testid="quiz-next" className="px-4 py-2 rounded bg-amber-700 text-white font-bold">
                        {t(index + 1 >= items.length ? 'trainers.memory.finish' : 'trainers.memory.next')}
                    </button>
                    <Link to={`/library/game/${item.id}`} className="text-sm text-amber-300 hover:underline" data-testid="miniature-game-link">
                        {t('trainers.structureGame')}
                    </Link>
                </div>
            )}
        </div>
    );
}
