// --- FILE: frontend/src/components/chessboard/CoachCards.tsx ---
// «Клубный тренер» в итоге партии (план владельца 18.11, задача 5): до трёх карточек действия в один клик —
// «Исправь свой зевок» (личная задача из самой дорогой ошибки решается прямо здесь, ответ — POST
// /puzzles/personal/{id}/answer, как в «Ваших ошибках»), «Дебютное отклонение» (строка DeviationItem из просмотра
// партии) и «Урок по теме ошибки» (модуль Большого курса — lessonModuleFor). Данные — services/coachCards.ts;
// пока разбор готов, а задачи ещё нет, карточки переспрашиваются (POLL_ATTEMPTS раз через POLL_DELAY_MS).
// Нет ни одной карточки — блок не показывается.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {GraduationCap} from 'lucide-react';
import {useI18n} from '../../i18n';
import {fetchAfterGame, lessonModuleFor, POLL_DELAY_MS, shouldPoll} from '../../services/coachCards';
import type {AfterGameCards} from '../../services/coachCards';
import {puzzlesApi} from '../../services/puzzles';
import type {PersonalAnswer} from '../../services/puzzles';
import {themeText} from '../../services/themes';
import {moduleTitleKey} from '../../content/supercourse';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {sanMoves} from '../puzzles/puzzleNotation';
import {DeviationItem} from '../repertoire/RepertoireDeviations';

const CARD = 'flex flex-col gap-1.5 pt-2 border-t border-amber-900/40';
const BUTTON = 'self-start px-2 py-1 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold cursor-pointer';

export function CoachCards({gameId}: { gameId: number }) {
    const {t} = useI18n();
    const [cards, setCards] = useState<AfterGameCards | null>(null);
    const [solving, setSolving] = useState(false);
    const [answer, setAnswer] = useState<PersonalAnswer | null>(null);

    // Карточки — после появления панели; пока задача из партии не готова, ещё POLL_ATTEMPTS вопроса. Ошибка
    // сети карточки просто не показывает: итог партии от них не зависит.
    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setCards(null);
        setSolving(false);
        setAnswer(null);
        const ask = (attempt: number) => {
            fetchAfterGame(gameId).then((next) => {
                if (!alive) return;
                setCards(next);
                if (next.analysed && shouldPoll(next, attempt)) timer = setTimeout(() => ask(attempt + 1), POLL_DELAY_MS);
            }).catch(() => undefined);
        };
        ask(0);
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
    }, [gameId]);

    if (!cards) return null;
    // Ответ сервера другой версии может не содержать полей — карточки тогда просто не показываются.
    const lesson = lessonModuleFor(cards.lesson_themes ?? []);
    if (!cards.puzzle && !cards.deviation && !lesson) return null;
    const deviation = cards.deviation ?? null;
    const puzzle = cards.puzzle ?? null;

    const onMove = async (uci: string) => {
        if (!puzzle || answer) return;
        setAnswer(await puzzlesApi.personalAnswer(puzzle.id, uci).catch(() => null));
    };

    return (
        <div className="flex flex-col gap-1" data-testid="coach-cards">
            <p className="flex items-center gap-1.5 font-bold text-amber-300 pt-1"><GraduationCap size={14}/> {t('summary.coach.title')}</p>
            {puzzle && (
                <div className={CARD} data-testid="coach-card-puzzle">
                    <p className="font-bold">{t('summary.coach.puzzle')}</p>
                    {!solving ? (
                        <button type="button" className={BUTTON} onClick={() => setSolving(true)} data-testid="coach-solve">
                            {t('summary.coach.solve')}
                        </button>
                    ) : (
                        <>
                            <p className="text-boxwood/80">{t('puzzles.personal.task')}</p>
                            <div className="w-full max-w-[280px]">
                                <PuzzleBoard fen={puzzle.fen} orientation={puzzle.color} interactive={!answer}
                                             onMove={(uci) => void onMove(uci)}/>
                            </div>
                            {answer && (
                                <p className={answer.correct ? 'text-emerald-300' : 'text-rose-300'} data-testid="coach-puzzle-result">
                                    {t(answer.correct ? 'puzzles.personal.right' : 'puzzles.personal.wrong')}{' '}
                                    {t('puzzles.personal.inGame', {
                                        move: sanMoves(puzzle.fen, [answer.played])[0] ?? answer.played,
                                        best: sanMoves(puzzle.fen, [answer.solution])[0] ?? answer.solution,
                                    })}
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}
            {deviation && (
                <div className={CARD} data-testid="coach-card-deviation">
                    <p className="font-bold">{t('summary.coach.deviation')}</p>
                    <DeviationItem deviation={deviation}/>
                </div>
            )}
            {lesson && (
                <div className={CARD} data-testid="coach-card-lesson">
                    <p className="font-bold">{t('summary.coach.lesson', {theme: themeText(lesson.theme, 'name', t)})}</p>
                    <Link to={`/learn/course?level=${lesson.module.level}&module=${lesson.module.code}`} className={BUTTON}
                          data-testid="coach-lesson-link">
                        {t('summary.coach.openLesson', {module: t(moduleTitleKey(lesson.module.code) as 'supercourse.title')})}
                    </Link>
                </div>
            )}
        </div>
    );
}
