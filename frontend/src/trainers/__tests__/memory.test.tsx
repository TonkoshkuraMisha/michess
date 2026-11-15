// Тренажёры памяти (таск 19.3): уровни, пул позиций из партий, выбор позиции по числу фигур, оценка по полям, игры.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    MEMORY_LEVELS, memoryLevel, pickGame, pickPosition, pieceCount, placementOfFen, positionPool, recallPlies, scorePlacement,
} from '../memory';
import {RecallGame, RestoreGame} from '../../components/trainers/MemoryGames';

const GAME = {
    id: 'g', white: 'A', black: 'B', event: null, year: '1900', result: '1-0', evals: [], comments: {}, stops: [], intro: {en: '', uk: '', ru: ''},
    summary: {en: '', uk: '', ru: ''},
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'f3g5', 'd7d5', 'e4d5', 'f6d5', 'g5f7', 'e8f7', 'd1f3', 'f7e6', 'b1c3', 'c6b4',
        'f3e4', 'c7c6', 'a2a3', 'b4a6', 'd2d4', 'a6c7', 'c4d5', 'c6d5'],
};

vi.mock('../../content/classics', () => ({loadAllClassics: async () => [GAME]}));
vi.mock('../../content/endgames.json', () => ({default: [{fen: '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1'}]}));

afterEach(() => vi.useRealTimers());

/** Дождаться загрузки партий (промисы) при фейковых таймерах. */
async function flush() {
    for (let i = 0; i < 5; i++) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

describe('память: логика', () => {
    it('ступени 3–6, 7–12, 13–24 фигуры; время показа убывает до 3 с', () => {
        expect(MEMORY_LEVELS).toHaveLength(10);
        expect(memoryLevel(1)).toEqual({min: 3, max: 6, seconds: 15});
        expect(memoryLevel(10)).toEqual({min: 13, max: 24, seconds: 3});
        expect(memoryLevel(99)).toEqual(memoryLevel(10));
        for (let i = 1; i < MEMORY_LEVELS.length; i++) {
            const prev = MEMORY_LEVELS[i - 1];
            const cur = MEMORY_LEVELS[i];
            expect(cur.min >= prev.min && (cur.min > prev.min || cur.seconds <= prev.seconds || cur.max > prev.max)).toBe(true);
        }
    });

    it('пул — все позиции партии и эндшпили; выбор по числу фигур уровня, повторяемый по seed', () => {
        const pool = positionPool([GAME], [{fen: '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1'},
            {fen: 'r3k2r/ppp2ppp/8/8/8/8/PPP2PPP/R3K2R w - - 0 1'}]);   // 16 фигур
        expect(pool).toHaveLength(GAME.moves.length + 2);
        const small = pickPosition(pool, 1, 5)!;
        expect(pieceCount(small)).toBe(3);
        const big = pickPosition(pool, 10, 5)!;
        expect(pieceCount(big)).toBeGreaterThanOrEqual(13);
        expect(pickPosition(pool, 10, 5)).toBe(big);
        expect(pickPosition([], 1, 1)).toBeNull();
    });

    it('оценка по полям: верные, не та фигура, лишняя, пропущенная', () => {
        const target = placementOfFen('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1');
        expect(scorePlacement(target, target)).toEqual({correct: ['e1', 'e2', 'e5'], wrong: [], score: 100});
        const result = scorePlacement(target, {e1: 'K', e2: 'p', a1: 'R'});
        expect(result.correct).toEqual(['e1']);
        expect(result.wrong).toEqual(['a1', 'e2', 'e5']);
        expect(result.score).toBe(25);
        expect(scorePlacement({}, {}).score).toBe(100);
    });

    it('«Запомни партию»: 6–24 полухода; партия достаточной длины', () => {
        expect(recallPlies(1)).toBe(6);
        expect(recallPlies(10)).toBe(24);
        expect(pickGame([GAME], 10, 1)).toBe(GAME);
        expect(pickGame([{moves: ['e2e4']}], 1, 1)).toBeNull();
    });
});

describe('память: игры', () => {
    it('«Восстанови позицию»: показ, расстановка, разбор, три позиции — итог', async () => {
        vi.useFakeTimers();
        const onFinish = vi.fn();
        render(<RestoreGame level={1} seed={2} onFinish={onFinish}/>);
        await flush();
        expect(screen.getByTestId('memory-left')).toHaveTextContent('15');
        for (let round = 0; round < 3; round++) {
            for (let s = 0; s < 80; s++) {
                await act(async () => {
                    vi.advanceTimersByTime(200);
                });
            }
            // Позиция уровня 1 — эндшпиль K+P против K: ставим короля e1 и проверяем.
            fireEvent.click(screen.getByTestId('brush-K'));
            fireEvent.click(document.querySelector('[data-square="e1"]')!);
            fireEvent.click(screen.getByTestId('memory-check'));
            expect(screen.getByTestId('memory-round-score')).toHaveTextContent('33%');
            fireEvent.click(screen.getByTestId('memory-next'));
        }
        expect(onFinish).toHaveBeenCalledWith(99, 6);
    });

    it('«Запомни партию»: просмотр, затем повтор; три промаха — ход показывается сам', async () => {
        vi.useFakeTimers();
        const onFinish = vi.fn();
        render(<RecallGame level={1} seed={1} onFinish={onFinish}/>);
        await flush();
        expect(screen.getByTestId('recall-watch')).toBeInTheDocument();
        for (let step = 0; step < 8; step++) {
            await act(async () => {
                vi.advanceTimersByTime(900);
            });
        }
        expect(screen.getByTestId('recall-play')).toHaveTextContent('Повторите ход 1 из 6');
        const play = async (from: string, to: string) => {
            await act(async () => {
                fireEvent.click(document.querySelector(`[data-square="${from}"]`)!);
            });
            await act(async () => {
                fireEvent.click(document.querySelector(`[data-square="${to}"]`)!);
            });
        };
        await play('e2', 'e4');
        await play('e7', 'e5');
        for (let i = 0; i < 3; i++) await play('a2', 'a3');   // вместо Kf3: три промаха — ход сам
        await play('b8', 'c6');
        await play('f1', 'c4');
        await play('g8', 'f6');
        expect(onFinish).toHaveBeenCalledWith(50, 3);
    });
});
