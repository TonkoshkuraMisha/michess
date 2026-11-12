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

export interface BotStrength {
    declared_rating: number;
    rating: number;
    measured: boolean;
    games: number;
    ci95: number | null;
}

/** Архетип мастерской: имя и описание на языке игрока — в каталоге (archetypes.<id>). */
export interface CatalogArchetype extends BotStrength {
    id: ArchetypeId;
    config: PersonalityConfig;
}

export interface BotCatalog {
    calibration: { date: string; games: number } | null;
    historical: (BotStrength & { id: string })[];
    archetypes: CatalogArchetype[];
}

let cached: Promise<BotCatalog> | null = null;

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
