// «Миниатюры» (таск 27.9): короткая партия из библиотеки, закончившаяся матом. Позиция перед последним ходом — найти
// мат (засчитывается любой матующий ход, не только ход партии). После ответа — ход партии и ссылка на неё.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {Chess} from 'chess.js';
import {useI18n} from '../../i18n';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {libraryApi} from '../../services/library';
import type {LibraryMiniature} from '../../services/library';

export const MINIATURE_ROUNDS = 10;

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

export function MiniatureGame({seed, onFinish}: Props) {
    const {t} = useI18n();
    const [items, setItems] = useState<LibraryMiniature[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [index, setIndex] = useState(0);
    const [verdict, setVerdict] = useState<{ ok: boolean; move: string } | null>(null);
    const [score, setScore] = useState({correct: 0, wrong: 0});

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
        if (verdict) return;
        const ok = isMate(item.fen, uci);
        setVerdict({ok, move: uci});
        setScore((s) => (ok ? {...s, correct: s.correct + 1} : {...s, wrong: s.wrong + 1}));
    };
    const next = () => {
        if (index + 1 >= items.length) {
            onFinish(score.correct * 10, score.wrong);
            return;
        }
        setIndex((i) => i + 1);
        setVerdict(null);
    };
    const shown = verdict ? (verdict.ok ? verdict.move : item.answer) : null;

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
                <PuzzleBoard fen={item.fen} orientation={white ? 'white' : 'black'} interactive={!verdict} onMove={onMove} sound={false}
                             arrows={shown ? [{from: shown.slice(0, 2), to: shown.slice(2, 4), color: verdict?.ok ? 'green' : 'yellow'}] : []}/>
            </div>
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
