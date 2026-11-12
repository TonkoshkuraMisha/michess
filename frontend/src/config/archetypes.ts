// --- FILE: frontend/src/config/archetypes.ts ---

/**
 * Готовые архетипы мастерской соперников: вымышленные персонажи с короткими биографиями — не
 * реальные люди и не герои чужих программ. Это стартовые точки для конструктора: игрок может
 * сыграть с архетипом как есть или взять его за основу своего соперника.
 *
 * Рейтинг — целевая сила (target_elo), а не измеренная: калибровка матчами ботов — таск 10.4.
 */

import type {PersonalityConfig} from '../services/personalities';
import {DEFAULT_CONFIG} from '../services/personalities';
import type {HistoricalBotProfile} from './champions';

export interface Archetype {
    name: string;
    bio: string;
    config: PersonalityConfig;
}

const cfg = (overrides: Partial<PersonalityConfig>): PersonalityConfig => ({
    ...DEFAULT_CONFIG,
    ...overrides,
    piece_values: {...DEFAULT_CONFIG.piece_values, ...(overrides.piece_values ?? {})},
});

export const ARCHETYPES: Archetype[] = [
    {
        name: 'Торопыга',
        bio: 'Выводит ферзя на третьем ходу и ищет мат в два хода. Иногда находит.',
        config: cfg({aggression: 70, king_safety: 30, mobility: 60, randomness: 80, blunder_guard_cp: 320, target_elo: 700}),
    },
    {
        name: 'Тихоня',
        bio: 'Никуда не спешит, размены любит больше атак и ждёт, пока соперник ошибётся сам.',
        config: cfg({aggression: -70, king_safety: 160, randomness: 40, blunder_guard_cp: 220, target_elo: 900}),
    },
    {
        name: 'Пешечник',
        bio: 'Считает каждую пешку и строит цепи, о которые разбиваются любые наскоки.',
        config: cfg({pawn_structure: 200, center_control: 140, piece_values: {pawn: 1.4, knight: 3, bishop: 3, rook: 5, queen: 9}, target_elo: 1100}),
    },
    {
        name: 'Кавалерист',
        bio: 'Обожает коней и не меняет их даже на слонов: «конь на краю — и тот полезен».',
        config: cfg({mobility: 160, piece_values: {pawn: 1, knight: 4, bishop: 2.6, rook: 5, queen: 9}, aggression: 30, target_elo: 1250}),
    },
    {
        name: 'Центровик',
        bio: 'Весь дебют — борьба за четыре центральных поля, а потом посмотрим.',
        config: cfg({center_control: 200, mobility: 120, randomness: 15, target_elo: 1400}),
    },
    {
        name: 'Крепость',
        bio: 'Рокируется при первой возможности и не трогает пешки перед королём.',
        config: cfg({aggression: -60, king_safety: 200, pawn_structure: 140, randomness: 10, target_elo: 1550}),
    },
    {
        name: 'Авантюрист',
        bio: 'Жертвует фигуру «на интуицию» и верит, что инициатива дороже материала.',
        config: cfg({aggression: 95, king_safety: 60, randomness: 60, blunder_guard_cp: 260, target_elo: 1650}),
    },
    {
        name: 'Стратег',
        bio: 'Медленно улучшает позицию фигур и душит соперника нехваткой пространства.',
        config: cfg({aggression: -30, center_control: 150, pawn_structure: 160, randomness: 10, blunder_guard_cp: 90, target_elo: 1800}),
    },
    {
        name: 'Охотник',
        bio: 'Ведёт все фигуры к чужому королю, о своём вспоминает в последний момент.',
        config: cfg({aggression: 100, king_safety: 50, mobility: 150, blunder_guard_cp: 180, target_elo: 2000}),
    },
    {
        name: 'Комбинатор',
        bio: 'Видит удары на несколько ходов вперёд и почти не ошибается в расчёте.',
        config: cfg({aggression: 80, mobility: 160, randomness: 10, blunder_guard_cp: 150, target_elo: 2200}),
    },
];

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
