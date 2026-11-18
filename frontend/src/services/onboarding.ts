// --- FILE: frontend/src/services/onboarding.ts ---
// Первый вход (таск 17.8): ответы при регистрации и выбор соперника для первой партии. Запросов здесь нет: ответы
// уходят на сервер вместе с регистрацией (форма входа), стартовый рейтинг по ним считает сервер
// (src/services/onboarding.py), а соперник выбирается из каталога ботов (services/botCatalog.ts).

import type {CatalogArchetype} from './botCatalog';

/** Ответы анкеты при регистрации: опыт игры и самооценка силы. Коды те же, что принимает сервер. */
export type Experience = 'new' | 'casual' | 'regular';
export type StrengthBand = 'under_1000' | '1000_1400' | '1400_1800' | 'over_1800';

export const EXPERIENCES: Experience[] = ['new', 'casual', 'regular'];
export const STRENGTH_BANDS: StrengthBand[] = ['under_1000', '1000_1400', '1400_1800', 'over_1800'];

/** Партий в категории, пока рейтинг временный (PROVISIONAL_GAMES сервера, src/services/rating.py). */
export const PROVISIONAL_GAMES = 30;

/** Состояние перехода на главную доску: начать первую партию по стартовому рейтингу. */
export interface FirstGameStart {
    rating: number;
}

/**
 * Соперник первой партии: самый сильный архетип не сильнее игрока (по измеренной силе — первая партия должна быть
 * посильной), а если все сильнее — самый слабый.
 */
export function pickFirstOpponent(archetypes: CatalogArchetype[], rating: number): CatalogArchetype | null {
    if (archetypes.length === 0) return null;
    const sorted = [...archetypes].sort((a, b) => a.rating - b.rating);
    const fitting = sorted.filter((a) => a.rating <= rating);
    return fitting.length > 0 ? fitting[fitting.length - 1] : sorted[0];
}
