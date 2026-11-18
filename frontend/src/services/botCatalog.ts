// --- FILE: frontend/src/services/botCatalog.ts ---

/**
 * Каталог ботов с сервера (GET /api/v1/bots/catalog): архетипы мастерской и сила ботов —
 * заявленная или измеренная матчами с якорями Stockfish (scripts/calibrate_bots.py).
 * Источник правды по архетипам — сервер: по ним же строится клубная лестница.
 */

import {API_BASE_URL} from '../config/api';
import type {PersonalityConfig} from './personalities';
import {t, uiMessage} from '../i18n';
import {UiError} from './apiErrors';
import {isArchetypeId} from '../config/archetypes';
import type {ArchetypeId} from '../config/archetypes';

/** Сила бота из src/services/bots/calibration.json (её читает сервер, bot_calibration.strength_of). */
export interface BotStrength {
    /** Заявленный рейтинг — тот, на который бот настроен. */
    declared_rating: number;
    /** Рейтинг для показа: измеренный, если калибровка была (measured), иначе равен заявленному. */
    rating: number;
    measured: boolean;
    /** Число партий калибровки и погрешность измеренного рейтинга: ± ci95 пунктов (95 %); null — не измерен. */
    games: number;
    ci95: number | null;
    /** Исторические боты (таск 32.1): рейтинг по партиям с людьми, их число и поправка силы движка. */
    live?: { rating: number; games: number; offset: number } | null;
}

/** Архетип мастерской: имя и описание на языке игрока — в каталоге (archetypes.<id>). */
export interface CatalogArchetype extends BotStrength {
    id: ArchetypeId;
    /** Ползунки характера; ползунки силы уже подстроены самоигрой (src/services/bots/selfplay.py, таск 32.3). */
    config: PersonalityConfig;
}

/** Ответ GET /api/v1/bots/catalog. */
export interface BotCatalog {
    /** Когда и на скольких партиях проведена последняя калибровка; null — её ещё не было. */
    calibration: { date: string; games: number } | null;
    historical: (BotStrength & { id: string })[];
    archetypes: CatalogArchetype[];
}

let cached: Promise<BotCatalog> | null = null;

/** Каталог ботов: один запрос на вкладку (результат кэшируется), после ошибки следующий вызов идёт в сеть заново. */
export function fetchBotCatalog(): Promise<BotCatalog> {
    if (!cached) {
        cached = fetch(`${API_BASE_URL}/api/v1/bots/catalog`)
            .then((res) => {
                if (!res.ok) throw new UiError(uiMessage('workshop.catalogUnavailable'));
                return res.json() as Promise<BotCatalog>;
            })
            .then((catalog) => ({
                ...catalog,
                // Архетип, которого клиент ещё не знает (сервер обновился раньше), не показываем без имени.
                archetypes: catalog.archetypes.filter((a) => isArchetypeId(a.id)),
            }))
            .catch((err) => {
                cached = null; // следующая попытка — снова в сеть
                throw err;
            });
    }
    return cached;
}

/** Для тестов: сбросить закэшированный каталог. */
export function resetBotCatalogCache(): void {
    cached = null;
}

/** «1720 (изм.)» — измеренная сила; иначе — заявленная. */
export function strengthLabel(s: Pick<BotStrength, 'rating' | 'measured'>): string {
    return s.measured ? t('common.measuredShort', {rating: s.rating}) : String(s.rating);
}

/** Кого из исторических ботов игрок уже знает (таск 32.2): партий с ним и очков бота в них. */
export interface BotRival {
    bot_id: string;
    games: number;
    bot_points: number;
    /** Постоянный соперник: бот учитывает партии с игроком при выборе дебюта. */
    remembers: boolean;
}

/** GET /api/v1/bots/rivalry — счёт игрока с историческими ботами; при любой ошибке сервера — пустой список. */
export async function fetchRivalry(token: string): Promise<BotRival[]> {
    const res = await fetch(`${API_BASE_URL}/api/v1/bots/rivalry`, {headers: {Authorization: `Bearer ${token}`}});
    if (!res.ok) return [];
    return ((await res.json()) as { rivals: BotRival[] }).rivals;
}

/** Очки в счёте: 2.5 → «2½», 0.5 → «½». */
export function scorePoints(points: number): string {
    const whole = Math.floor(points);
    const half = points - whole >= 0.5;
    return half ? `${whole || ''}½` : String(whole);
}
