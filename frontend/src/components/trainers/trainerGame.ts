// --- FILE: frontend/src/components/trainers/trainerGame.ts ---
// Общее для игр-тренажёров с уровнями (BlindGames, BoardPuzzleGames, CalcGames, MemoryGames, VisionGames): что
// игра получает от страницы тренажёров (TrainersPage.tsx) и загрузка партий классики, из которых строятся задания.
// Партии — content/classics.ts (loadAllClassics): отдельный кусок сборки, грузится по требованию, не по сети к API.

import {useEffect, useState} from 'react';
import {loadAllClassics} from '../../content/classics';
import type {ClassicGame} from '../../content/classics';

/**
 * Свойства игры-тренажёра: уровень (сложность заданий), seed (одна и та же попытка у одного seed — задания
 * детерминированы) и onFinish — итог попытки: очки и число ошибок, их сохраняет страница тренажёров.
 */
export interface TrainerGameProps {
    level: number;
    seed: number;
    onFinish: (score: number, mistakes: number) => void;
}

/** Партии классики для заданий; null — ещё грузятся, пустой список — загрузить не удалось. */
export function useClassics(): ClassicGame[] | null {
    const [games, setGames] = useState<ClassicGame[] | null>(null);
    useEffect(() => {
        let alive = true;
        loadAllClassics().then((list) => alive && setGames(list)).catch(() => alive && setGames([]));
        return () => {
            alive = false;
        };
    }, []);
    return games;
}
