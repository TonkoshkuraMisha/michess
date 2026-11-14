// --- FILE: frontend/src/config/archetypes.ts ---

/**
 * Соперник из мастерской на доске: профиль, радар стиля и пояснение силы. Сами архетипы
 * (вымышленные персонажи) живут на сервере — src/services/bots/archetypes.py, — фронтенд получает
 * их вместе с измеренной силой через GET /bots/catalog (services/botCatalog.ts).
 */

import {t} from '../i18n';
import type {PersonalityConfig} from '../services/personalities';
import type {HistoricalBotProfile} from './champions';
import {hasMessage} from '../i18n';
import type {Messages} from '../i18n';

/** Соперник из мастерской в партии: имя, конфиг и (если сохранён на сервере) его id. */
export interface CustomOpponent {
    name: string;
    config: PersonalityConfig;
    personalityId?: number;
    bio?: string;
    /**
     * Архетип мастерской без изменений (в том числе соперник лестницы): имя и описание берутся из каталога на
     * языке игрока, а в архив партия уходит с ключом «archetype:<id>».
     */
    archetypeId?: ArchetypeId;
}

/** id архетипа мастерской — ключ раздела archetypes в каталогах (тот же список, что на сервере). */
export type ArchetypeId = keyof Messages['archetypes'];

/** Проверка id, пришедшего с сервера: неизвестный архетип (сервер новее клиента) не показывается. */
export function isArchetypeId(value: unknown): value is ArchetypeId {
    return typeof value === 'string' && hasMessage(`archetypes.${value}.name`);
}

/** Ключ архетипа в архиве партий (games.personality_name) — тот же, что на сервере. */
export const ARCHETYPE_PREFIX = 'archetype:';

export function archetypeKey(id: ArchetypeId): string {
    return `${ARCHETYPE_PREFIX}${id}`;
}

// Аватар соперника из мастерской — силуэт коня (своё изображение, без внешних файлов).
const WORKSHOP_AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#3b2412"/>'
    + '<path d="M22 50h22l-2-6c0-8 4-12 4-20 0-8-6-14-14-14l-2 4-4 2-6 8 2 4 6-2 4 2-10 12z" fill="#e7c38b"/></svg>',
)}`;

/** Профиль для доски и панели — в том же виде, что у исторических ботов. */
export function customBotProfile(opponent: CustomOpponent): HistoricalBotProfile {
    const name = () => (opponent.archetypeId ? t(`archetypes.${opponent.archetypeId}.name`) : opponent.name);
    return {
        id: 'custom',
        get name() {
            return name();
        },
        get shortName() {
            return name();
        },
        get playerLabel() {
            return name();
        },
        get title() {
            return t('bots.workshopTitle');
        },
        get era() {
            return t('bots.workshopEra');
        },
        rating: opponent.config.target_elo,
        get motto() {
            if (opponent.archetypeId) return t(`archetypes.${opponent.archetypeId}.bio`);
            return opponent.bio || t('bots.workshopMotto');
        },
        avatar: WORKSHOP_AVATAR,
        fallbackAvatar: WORKSHOP_AVATAR,
    };
}

/**
 * Наглядная сводка ползунков для радара (0..100). Это иллюстрация характера, а не измерение силы:
 * измеренная сила — таск 10.4.
 */
export type RadarAxis = 'attack' | 'defense' | 'tactics' | 'position' | 'endgame';

export function styleRadar(config: PersonalityConfig): { key: RadarAxis; axis: string; value: number }[] {
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
    const attack = (config.aggression + 100) / 2;
    const precision = 100 - Math.min(config.blunder_guard_cp, 400) / 4;
    const strength = ((config.target_elo - 600) / 2200) * 100;
    const values: Record<RadarAxis, number> = {
        attack: clamp(attack * 0.7 + config.mobility * 0.15),
        defense: clamp((100 - attack) * 0.5 + config.king_safety * 0.25),
        tactics: clamp(attack * 0.3 + precision * 0.3 + strength * 0.4 - config.randomness * 0.2),
        position: clamp(config.center_control * 0.25 + config.pawn_structure * 0.25),
        endgame: clamp(config.pawn_structure * 0.2 + strength * 0.6),
    };
    return (Object.keys(values) as RadarAxis[]).map((key) => ({
        key,
        axis: t(`workshop.radar.${key}`),
        value: values[key],
    }));
}

/**
 * Доля управляемых ошибок по целевой силе — копия ERROR_RATE_CURVE сервера (src/services/bots/personality.py,
 * подобрана по калибровке). Совпадение чисел проверяет tests/test_personality_bot.py.
 */
export const ERROR_RATE_CURVE: readonly (readonly [number, number])[] = [
    [600, 0.40], [700, 0.355], [900, 0.265], [1100, 0.175], [1250, 0.10], [1320, 0.07], [1450, 0.0],
];

export function errorRate(elo: number): number {
    for (let i = 1; i < ERROR_RATE_CURVE.length; i++) {
        const [loElo, loRate] = ERROR_RATE_CURVE[i - 1];
        const [hiElo, hiRate] = ERROR_RATE_CURVE[i];
        if (elo <= hiElo) {
            const share = (Math.max(elo, loElo) - loElo) / (hiElo - loElo);
            return loRate + (hiRate - loRate) * share;
        }
    }
    return 0;
}

/** Пояснение силы: доля ошибок — по той же кривой, что на сервере. */
export function strengthNote(config: PersonalityConfig): string {
    const elo = config.target_elo;
    const errors = Math.round(errorRate(elo) * 100);
    if (errors > 0) return t('workshop.strengthWithErrors', {elo, errors});
    return t('workshop.strengthExact', {elo});
}
