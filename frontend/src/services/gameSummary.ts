// --- FILE: frontend/src/services/gameSummary.ts ---
// Итог партии (таск 11.5): тип партии считает сервер (src/services/game_summary.py), здесь — подбор следующего
// соперника по результату и силе ботов. Запроса здесь нет: итог приходит полем summary вместе с разбором партии
// (/api/v1/analysis/game/{id}, для импортированных — /api/v1/imports/games/{id}/analysis).

/**
 * Тип партии по графику оценки: «качели», «решила ошибка», «доминирование», «упущенная победа», «равная борьба»,
 * «постепенный перевес». Пороги и порядок проверки — в докстринге src/services/game_summary.py.
 */
export type GameSummaryKind = 'seesaw' | 'decisive_blunder' | 'domination' | 'missed_win' | 'balanced' | 'gradual';
export const GAME_SUMMARY_KINDS: readonly GameSummaryKind[] = [
    'seesaw', 'decisive_blunder', 'domination', 'missed_win', 'balanced', 'gradual',
];

/** Итог партии, как его отдаёт сервер (считается по готовому разбору, без движка). Полуходы (ply) — с единицы. */
export interface GameSummary {
    kind: GameSummaryKind;
    /** Полуход перелома; null — перелома не было. */
    turning_point_ply: number | null;
    /** Сколько раз решающий перевес переходил от одной стороны к другой. */
    lead_changes: number;
    /** Доля ходов (0…1), когда позиция была равной. */
    equal_share: number;
    /** Ключевые моменты стороны: лучший ход и худший (самая большая потеря). */
    white: { best_ply: number | null; worst_ply: number | null };
    black: { best_ply: number | null; worst_ply: number | null };
    /** Упущенные удары: ответ не наказал крупную ошибку соперника (таск B.5). Нет поля — старый разбор. */
    missed?: { ply: number; color: 'white' | 'black'; cp: number }[];
}

/** Известен ли клиенту тип партии: незнакомый (сервер новее) показывать нечем — подписи берутся из каталога. */
export function isSummaryKind(value: unknown): value is GameSummaryKind {
    return typeof value === 'string' && (GAME_SUMMARY_KINDS as readonly string[]).includes(value);
}

/** Соперник из пула: исторический бот или архетип мастерской. */
export interface PoolOpponent {
    kind: 'historical' | 'archetype';
    id: string;
    rating: number;
}

export type GameOutcome = 'win' | 'loss' | 'draw';

/** Шаг по силе, меньше которого соперник считается «того же уровня». */
const SAME_LEVEL = 40;

/** Итог для игрока по записи результата («1-0», «0-1»); всё остальное считается ничьей. */
export function outcomeFor(result: string, playerColor: 'white' | 'black'): GameOutcome {
    if (result === '1-0') return playerColor === 'white' ? 'win' : 'loss';
    if (result === '0-1') return playerColor === 'black' ? 'win' : 'loss';
    return 'draw';
}

/**
 * Следующий соперник: после победы — ближайший заметно сильнее, после поражения — ближайший заметно слабее,
 * после ничьей — другой соперник, ближайший по силе (при равном расстоянии — более сильный). Если в нужную сторону
 * никого нет — ближайший по силе. «Заметно» — не меньше SAME_LEVEL пунктов рейтинга.
 */
export function recommendOpponent(
    pool: readonly PoolOpponent[], current: { id: string; rating: number }, outcome: GameOutcome,
): PoolOpponent | null {
    const others = pool.filter((o) => o.id !== current.id);
    if (others.length === 0) return null;
    // Ближайшие по силе; при равном расстоянии — более сильный: так игрок растёт.
    const byDistance = [...others].sort(
        (a, b) => Math.abs(a.rating - current.rating) - Math.abs(b.rating - current.rating) || b.rating - a.rating,
    );
    if (outcome === 'win') {
        const stronger = others.filter((o) => o.rating >= current.rating + SAME_LEVEL).sort((a, b) => a.rating - b.rating);
        return stronger[0] ?? byDistance[0];
    }
    if (outcome === 'loss') {
        const weaker = others.filter((o) => o.rating <= current.rating - SAME_LEVEL).sort((a, b) => b.rating - a.rating);
        return weaker[0] ?? byDistance[0];
    }
    return byDistance[0];
}
