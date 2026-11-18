// Счёт и внимание (таск 19.7): викторины целиком (верный ответ — по той же логике, что и генерация), «Шахи и взятия».

import {act, fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {ChecksGame, QUIZ_ROUNDS, QuizGame} from '../CalcGames';
import type {QuizKind} from '../CalcGames';
import {loadAllClassics} from '../../../content/classics';
import {positionPool} from '../../../trainers/memory';
import {
    checksAndCaptures, checksPosition, compareQuestion, distanceQuestion, evalQuestion, exchangeQuestion, squareFen, squareQuestion,
} from '../../../trainers/calculation';
import {Chess} from 'chess.js';

async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
}

describe('викторины счёта', () => {
    it.each(['calc_exchange', 'calc_distance', 'calc_square', 'calc_eval', 'calc_compare'] as QuizKind[])('%s: верные ответы — 100 очков', async (kind) => {
        const games = await loadAllClassics();
        const pool = positionPool(games, []);
        const onFinish = vi.fn();
        render(<QuizGame kind={kind} level={1} seed={8} onFinish={onFinish}/>);
        await settle();
        for (let i = 0; i < QUIZ_ROUNDS; i++) {
            const answer = kind === 'calc_exchange' ? exchangeQuestion(pool, 8 * 97 + i)!.answer
                : kind === 'calc_distance' ? String(distanceQuestion(8, i).answer)
                    : kind === 'calc_square' ? (squareQuestion(8, i).answer ? 'yes' : 'no')
                        : kind === 'calc_compare' ? compareQuestion(games, 8 * 71 + i)!.best
                            : evalQuestion(games, 8 * 53 + i)!.answer;
            fireEvent.click(screen.getByTestId(`quiz-option-${answer}`));
            fireEvent.click(screen.getByTestId('quiz-next'));
        }
        expect(onFinish).toHaveBeenCalledWith(100, 0);
    }, 30_000);

    it('неверный ответ — ошибка, правильный подсвечивается', async () => {
        render(<QuizGame kind="calc_square" level={1} seed={2} onFinish={vi.fn()}/>);
        await settle();
        const right = squareQuestion(2, 0).answer ? 'yes' : 'no';
        const wrong = right === 'yes' ? 'no' : 'yes';
        fireEvent.click(screen.getByTestId(`quiz-option-${wrong}`));
        expect(screen.getByTestId('quiz-score')).toHaveTextContent('Верно: 0 · ошибок: 1');
        expect(screen.getByTestId(`quiz-option-${right}`).className).toContain('emerald');
    });

    it('после ответа позицию можно разыграть на доске (гонку пешки и короля)', async () => {
        render(<QuizGame kind="calc_square" level={1} seed={2} onFinish={vi.fn()}/>);
        await settle();
        expect(screen.queryByTestId('explorer-controls')).toBeNull();  // до ответа доска закрыта
        fireEvent.click(screen.getByTestId('quiz-option-yes'));
        expect(screen.getByTestId('explorer-back')).toBeDisabled();
        const move = new Chess(squareFen(squareQuestion(2, 0))).moves({verbose: true})[0];
        fireEvent.click(document.querySelector(`[data-square="${move.from}"]`)!);
        fireEvent.click(document.querySelector(`[data-square="${move.to}"]`)!);
        expect(screen.getByTestId('explorer-back')).not.toBeDisabled();
        fireEvent.click(screen.getByTestId('explorer-back'));
        expect(screen.getByTestId('explorer-back')).toBeDisabled();
    });
});

describe('шахи и взятия', () => {
    it('все верные отметки — 100 за позицию; лишняя — минус; разбор по цветам', async () => {
        const games = await loadAllClassics();
        const pool = positionPool(games, []);
        const onFinish = vi.fn();
        render(<ChecksGame level={1} seed={6} onFinish={onFinish}/>);
        await settle();
        for (let round = 0; round < 3; round++) {
            const fen = checksPosition(pool, 6 * 13 + round * 101)!;
            for (const uci of checksAndCaptures(fen)) {
                fireEvent.click(document.querySelector(`[data-square="${uci.slice(0, 2)}"]`)!);
                fireEvent.click(document.querySelector(`[data-square="${uci.slice(2, 4)}"]`)!);
            }
            fireEvent.click(screen.getByTestId('checks-done'));
            expect(screen.getByTestId('checks-review')).toHaveTextContent('пропущено: 0');
            fireEvent.click(screen.getByTestId('checks-next'));
        }
        expect(onFinish).toHaveBeenCalledWith(300, 0);
    }, 30_000);
});

describe('«Сравни два хода» (27.9)', () => {
    it('ход мастера против линии слабее на пешку и больше, разбор после ответа', async () => {
        const games = await loadAllClassics();
        for (let seed = 0; seed < 40; seed++) {
            const q = compareQuestion(games, seed)!;
            expect(q.bestCp - q.otherCp).toBeGreaterThanOrEqual(100);
            expect(new Set(q.options)).toEqual(new Set([q.best, q.other]));
        }
        render(<QuizGame kind="calc_compare" level={1} seed={3} onFinish={vi.fn()}/>);
        await settle();
        const q = compareQuestion(games, 3 * 71)!;
        fireEvent.click(screen.getByTestId(`quiz-option-${q.other}`));
        expect(screen.getByTestId('quiz-explain')).toHaveTextContent('сильнее');
        expect(screen.getByTestId(`quiz-option-${q.best}`).className).toContain('emerald');
    }, 30_000);
});
