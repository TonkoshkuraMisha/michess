// «Узнай структуру» (таск 27.9, тренажёр 19.1): позиция из партии библиотеки (или учебный скелет) → название пешечной
// структуры из четырёх. После ответа — ссылка на партию, из которой взята позиция.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {useI18n} from '../../i18n';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {libraryApi} from '../../services/library';
import type {StructureCode, StructureQuestion} from '../../services/library';

export const STRUCTURE_ROUNDS = 10;

interface Props {
    seed: number;
    onFinish: (score: number, mistakes: number) => void;
}

export function StructureQuiz({seed, onFinish}: Props) {
    const {t} = useI18n();
    const [questions, setQuestions] = useState<StructureQuestion[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [index, setIndex] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const [score, setScore] = useState({correct: 0, wrong: 0});

    useEffect(() => {
        let alive = true;
        libraryApi.structureQuiz(STRUCTURE_ROUNDS, seed)
            .then((body) => alive && setQuestions(body.questions))
            .catch(() => alive && setFailed(true));
        return () => {
            alive = false;
        };
    }, [seed]);

    if (failed) return <p className="text-sm text-rose-300">{t('trainers.memory.noPositions')}</p>;
    if (!questions) return <p className="text-sm text-boxwood/70">{t('trainers.memory.loading')}</p>;
    const quiz = questions[index];
    if (!quiz) return <p className="text-sm text-rose-300">{t('trainers.memory.noPositions')}</p>;

    const answer = (id: string) => {
        if (picked) return;
        setPicked(id);
        setScore((s) => (id === quiz.answer ? {...s, correct: s.correct + 1} : {...s, wrong: s.wrong + 1}));
    };
    const next = () => {
        if (index + 1 >= questions.length) {
            onFinish(score.correct * 10, score.wrong);
            return;
        }
        setIndex((i) => i + 1);
        setPicked(null);
    };
    const name = (code: StructureCode) => t(`structures.${code}`);

    return (
        <div className="flex flex-col gap-3" data-testid="structure-quiz">
            <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-bold text-amber-200">{t('trainers.calc.question', {n: index + 1, total: questions.length})}</span>
                <span className="text-sm" data-testid="quiz-score">{t('trainers.coord.score', {score: score.correct, mistakes: score.wrong})}</span>
            </div>
            <p className="text-lg">{t('trainers.structurePrompt')}</p>
            <div className="w-full max-w-[420px]">
                <PuzzleBoard fen={quiz.fen} orientation="white" interactive={false} onMove={() => undefined} sound={false}/>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
                {quiz.options.map((code) => {
                    const tone = !picked ? 'bg-black/40 border-amber-800/60 hover:border-amber-400'
                        : code === quiz.answer ? 'bg-emerald-800 border-emerald-400' : code === picked ? 'bg-rose-900 border-rose-500' : 'bg-black/30 border-transparent opacity-60';
                    return (
                        <button key={code} type="button" onClick={() => answer(code)} data-testid={`quiz-option-${code}`}
                                className={`px-3 py-2 rounded-lg border font-bold text-left ${tone}`}>{name(code)}</button>
                    );
                })}
            </div>
            {picked && (
                <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={next} data-testid="quiz-next" className="px-4 py-2 rounded bg-amber-700 text-white font-bold">
                        {t(index + 1 >= questions.length ? 'trainers.memory.finish' : 'trainers.memory.next')}
                    </button>
                    {quiz.game_id !== null && (
                        <Link to={`/library/game/${quiz.game_id}`} className="text-sm text-amber-300 hover:underline" data-testid="structure-game-link">
                            {t('trainers.structureGame')}
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}
