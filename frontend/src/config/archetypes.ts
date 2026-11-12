// --- FILE: frontend/src/config/archetypes.ts ---

/**
 * Соперник из мастерской на доске: профиль, радар стиля и пояснение силы. Сами архетипы
 * (вымышленные персонажи) живут на сервере — src/services/bots/archetypes.py, — фронтенд получает
 * их вместе с измеренной силой через GET /bots/catalog (services/botCatalog.ts).
 */

import type {PersonalityConfig} from '../services/personalities';
import type {HistoricalBotProfile} from './champions';

/** Соперник из мастерской в партии: имя, конфиг и (если сохранён на сервере) его id. */
export interface CustomOpponent {
    name: string;
    config: PersonalityConfig;
    personalityId?: number;
    bio?: string;
}

// Аватар соперника из мастерской — силуэт коня (своё изображение, без внешних файлов).
const WORKSHOP_AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#3b2412"/>'
    + '<path d="M22 50h22l-2-6c0-8 4-12 4-20 0-8-6-14-14-14l-2 4-4 2-6 8 2 4 6-2 4 2-10 12z" fill="#e7c38b"/></svg>',
)}`;

/** Профиль для доски и панели — в том же виде, что у исторических ботов. */
export function customBotProfile(opponent: CustomOpponent): HistoricalBotProfile {
    return {
        id: 'custom',
        name: opponent.name,
        shortName: opponent.name,
        playerLabel: opponent.name,
        title: 'Соперник из мастерской',
        era: 'Собран игроком',
        rating: opponent.config.target_elo,
        motto: opponent.bio || 'Сыграем — и посмотрим, чей характер сильнее.',
        avatar: WORKSHOP_AVATAR,
        fallbackAvatar: WORKSHOP_AVATAR,
    };
}

/**
 * Наглядная сводка ползунков для радара (0..100). Это иллюстрация характера, а не измерение силы:
 * измеренная сила — таск 10.4.
 */
export function styleRadar(config: PersonalityConfig): { axis: string; value: number }[] {
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
    const attack = (config.aggression + 100) / 2;
    const precision = 100 - Math.min(config.blunder_guard_cp, 400) / 4;
    const strength = ((config.target_elo - 600) / 2200) * 100;
    return [
        {axis: 'Атака', value: clamp(attack * 0.7 + config.mobility * 0.15)},
        {axis: 'Защита', value: clamp((100 - attack) * 0.5 + config.king_safety * 0.25)},
        {axis: 'Тактика', value: clamp(attack * 0.3 + precision * 0.3 + strength * 0.4 - config.randomness * 0.2)},
        {axis: 'Позиция', value: clamp(config.center_control * 0.25 + config.pawn_structure * 0.25)},
        {axis: 'Эндшпиль', value: clamp(config.pawn_structure * 0.2 + strength * 0.6)},
    ];
}

const STOCKFISH_MIN_ELO = 1320;

/** Пояснение силы — та же формула, что на сервере (src/services/bots/personality.py). */
export function strengthNote(config: PersonalityConfig): string {
    const elo = config.target_elo;
    if (elo < STOCKFISH_MIN_ELO) {
        const errors = Math.round((0.5 * (STOCKFISH_MIN_ELO - elo) / (STOCKFISH_MIN_ELO - 600)) * 100);
        return `Целевая сила ~${elo}. Движок слабее 1320 не играет, поэтому примерно в ${errors}% ходов соперник намеренно выберет ход похуже.`;
    }
    return `Целевая сила ~${elo}: движок ограничен этим рейтингом, ошибок «нарочно» нет.`;
}
