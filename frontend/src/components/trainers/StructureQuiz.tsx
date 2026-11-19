// --- FILE: frontend/src/components/trainers/StructureQuiz.tsx ---
// «Узнай структуру» (таск 27.9, тренажёр 19.1): позиция из партии библиотеки (или учебный скелет) → название пешечной
// структуры из четырёх. После ответа — ссылка на партию, из которой взята позиция, и свободная доска: позицию можно
// разыграть за обе стороны (решение владельца 18.11, usePositionExplorer; учебный скелет без королей chess.js не
// примет — тогда доска просто остаётся показом).
// Данные: GET /library/structure-quiz (services/library.ts → src/api/library.py, src/services/structure_quiz.py); названия — каталог structures.*,
// планы — structurePlans.*. Запускается из TrainersPage.tsx (тренажёры structure_quiz и plan_quiz); 10 очков за верный ответ.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {useI18n} from '../../i18n';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {ExplorerControls, usePositionExplorer} from '../puzzles/usePositionExplorer';
import {libraryApi} from '../../services/library';
import type {StructureCode, StructureQuestion} from '../../services/library';

/** Вопросов в попытке; уходит серверу как count. */
export const STRUCTURE_ROUNDS = 10;

/** Свойства игры: seed, onFinish(очки, ошибки) и вариант вопроса. */
interface Props {
    seed: number;
    onFinish: (score: number, mistakes: number) => void;
    /** «Найди план» (27.9): варианты — типовые планы структур, а не их названия. */
    variant?: 'name' | 'plan';
}

/** Попытка из STRUCTURE_ROUNDS вопросов; пока вопросы грузятся или загрузка не удалась, рисуется заглушка. */
export function StructureQuiz({seed, onFinish, variant = 'name'}: Props) {
    const {t} = useI18n();
    const [questions, setQuestions] = useState<StructureQuestion[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [index, setIndex] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const [score, setScore] = useState({correct: 0, wrong: 0});
    const explorer = usePositionExplorer();

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
        explorer.stop();
    };
    const name = (code: StructureCode) => t(`structures.${code}`);
    const option = (code: StructureCode) => (variant === 'plan' ? t(`structurePlans.${code}`) : name(code));

    return (
        <div className="flex flex-col gap-3" data-testid="structure-quiz">
            <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-bold text-amber-200">{t('trainers.calc.question', {n: index + 1, total: questions.length})}</span>
                <span className="text-sm" data-testid="quiz-score">{t('trainers.coord.score', {score: score.correct, mistakes: score.wrong})}</span>
            </div>
            <p className="text-lg">{t(variant === 'plan' ? 'trainers.planPrompt' : 'trainers.structurePrompt')}</p>
            <div className="w-full max-w-[420px]">
                <PuzzleBoard fen={explorer.fen ?? quiz.fen} orientation="white" interactive={Boolean(picked)} sound={false}
                             lastMove={explorer.lastMove}
                             onMove={(uci) => {
                                 if (explorer.active) explorer.play(uci);
                                 else explorer.start(quiz.fen, [uci]);
                             }}/>
                <ExplorerControls explorer={explorer}/>
            </div>
            <div className={`grid gap-2 ${variant === 'plan' ? '' : 'sm:grid-cols-2'}`}>
                {quiz.options.map((code) => {
                    const tone = !picked ? 'bg-black/40 border-amber-800/60 hover:border-amber-400'
                        : code === quiz.answer ? 'bg-emerald-800 border-emerald-400' : code === picked ? 'bg-rose-900 border-rose-500' : 'bg-black/30 border-transparent opacity-60';
                    return (
                        <button key={code} type="button" onClick={() => answer(code)} data-testid={`quiz-option-${code}`}
                                className={`px-3 py-2 rounded-lg border text-left ${variant === 'plan' ? 'text-sm' : 'font-bold'} ${tone}`}>{option(code)}</button>
                    );
                })}
            </div>
            {picked && variant === 'plan' && (
                <p className="text-sm text-amber-200" data-testid="plan-verdict">{t('trainers.planVerdict', {name: name(quiz.answer)})}</p>
            )}
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
