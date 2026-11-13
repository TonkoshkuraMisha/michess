// --- FILE: frontend/src/config/timeControls.ts ---
// Контроли времени для онлайн-игры: 4 категории (как на chess.com и lichess.org), в каждой —
// самые популярные пресеты. Раньше здесь был полный список программ часов DGT 2500 (36 штук,
// включая задержку Бронштейна/US Delay, бё-ёми, песочные часы, гонг, Scrabble) — но сервер
// для сетевых партий понимает только простое время + добавление за ход (Fischer), так что
// все эти экзотические режимы для онлайн-игры были чисто декоративными и только путали выбор.
//
// Подписи и описания — в каталогах сообщений (геттеры), здесь только числа.

import {t} from '../i18n';

export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export type TimeControlId =
    | 'bullet-1+0' | 'bullet-1+1' | 'bullet-2+1' | 'bullet-manual'
    | 'blitz-3+0' | 'blitz-3+2' | 'blitz-5+0' | 'blitz-5+3' | 'blitz-manual'
    | 'rapid-10+0' | 'rapid-10+5' | 'rapid-15+10' | 'rapid-manual'
    | 'classical-30+0' | 'classical-30+20' | 'classical-60+30' | 'classical-manual';

export interface TimeControlOption {
    id: TimeControlId;
    category: TimeControlCategory;
    base: number; // минут на старте
    inc: number; // секунд добавления за ход (Fischer); 0 — без добавления
    readonly label: string;
    readonly details: string;
    isManual?: boolean;
}

export interface TimeControlGroup {
    category: TimeControlCategory;
    readonly title: string;
    options: TimeControlOption[];
}

/** Подпись пресета: «3 мин + 2 сек/ход» на текущем языке. */
export function timeControlLabel(base: number, inc: number): string {
    return inc > 0 ? t('timeControl.minutesIncrement', {base, inc}) : t('timeControl.minutes', {base});
}

function option(category: TimeControlCategory, base: number, inc: number, manual = false): TimeControlOption {
    const id = (manual ? `${category}-manual` : `${category}-${base}+${inc}`) as TimeControlId;
    return {
        id,
        category,
        base,
        inc,
        ...(manual ? {isManual: true} : {}),
        get label() {
            return manual
                ? t('timeControl.manual', {category: t(`ratingCategory.${category}`)})
                : timeControlLabel(base, inc);
        },
        get details() {
            return t(`timeControl.details.${id}`);
        },
    };
}

function group(category: TimeControlCategory, options: TimeControlOption[]): TimeControlGroup {
    return {
        category,
        options,
        get title() {
            return t(`ratingCategory.${category}`);
        },
    };
}

export const TIME_CONTROLS: TimeControlGroup[] = [
    group('bullet', [
        option('bullet', 1, 0),
        option('bullet', 1, 1),
        option('bullet', 2, 1),
        option('bullet', 1, 0, true),
    ]),
    group('blitz', [
        option('blitz', 3, 0),
        option('blitz', 3, 2),
        option('blitz', 5, 0),
        option('blitz', 5, 3),
        option('blitz', 5, 0, true),
    ]),
    group('rapid', [
        option('rapid', 10, 0),
        option('rapid', 10, 5),
        option('rapid', 15, 10),
        option('rapid', 15, 10, true),
    ]),
    group('classical', [
        // 30 минут без добавления — уже классика: сервер (classify_time_control) относит партию
        // к категории по оценке «база + 40 × добавление», порог классики — 25 минут.
        option('classical', 30, 0),
        option('classical', 30, 20),
        option('classical', 60, 30),
        option('classical', 60, 30, true),
    ]),
];

export const ALL_TIME_CONTROLS: TimeControlOption[] = TIME_CONTROLS.flatMap(g => g.options);
export const DEFAULT_TIME_CONTROL: TimeControlOption =
    ALL_TIME_CONTROLS.find(o => o.id === 'blitz-3+2') || ALL_TIME_CONTROLS[0];

/**
 * Категория контроля — то же правило, что на сервере (src/services/rating.classify_time_control): оценка длительности
 * «база + 40 × добавление»; пуля — до 3 минут, блиц — до 8, рапид — до 25, дальше классика.
 */
export function timeControlCategory(baseMs: number, incrementMs: number): TimeControlCategory {
    const estimatedS = baseMs / 1000 + 40 * (incrementMs / 1000);
    if (estimatedS < 180) return 'bullet';
    if (estimatedS < 480) return 'blitz';
    if (estimatedS < 1500) return 'rapid';
    return 'classical';
}
