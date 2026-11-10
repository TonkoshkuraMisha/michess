// --- FILE: frontend/src/config/timeControls.ts ---
// Программы шахматных часов DGT 2500 (вынесено из Chessboard.tsx).

export type DgtTimingMode =
    | 'time'
    | 'fischer'
    | 'delay'
    | 'us_delay'
    | 'byo_yomi'
    | 'canadian_byo'
    | 'scrabble'
    | 'hourglass'
    | 'gong'
    | 'move_timer';

export interface Dgt2500Option {
    optionNumber: string;
    mode: DgtTimingMode;
    base: number;
    blackBase?: number;
    inc: number;
    label: string;
    details: string;
    isManual?: boolean;
    periods?: Array<{ moves?: number; extraMinutes: number; extraIncSeconds?: number }>;
    incrementFromMove?: number;
}

export interface Dgt2500Group {
    group: string;
    options: Dgt2500Option[];
}

export const TIME_CONTROLS: Dgt2500Group[] = [
    {
        group: '01–08 • Time (Контроль времени и Гильотина)',
        options: [
            {
                optionNumber: '01',
                mode: 'time',
                base: 5,
                inc: 0,
                label: '5 мин',
                details: 'Блиц 5 минут до конца партии'
            },
            {
                optionNumber: '02',
                mode: 'time',
                base: 25,
                inc: 0,
                label: '25 мин',
                details: 'Рапид 25 минут до конца партии'
            },
            {
                optionNumber: '03',
                mode: 'time',
                base: 60,
                inc: 0,
                label: '60 мин (1 час)',
                details: 'Классика 60 минут до конца партии'
            },
            {
                optionNumber: '04',
                mode: 'time',
                base: 120,
                inc: 0,
                label: '120 мин/40 + 30 мин',
                details: '2 часа на 40 ходов + 30 мин до конца',
                periods: [{moves: 40, extraMinutes: 30}]
            },
            {
                optionNumber: '05',
                mode: 'time',
                base: 120,
                inc: 0,
                label: '120 мин/40 + 60 мин',
                details: '2 часа на 40 ходов + 60 мин до конца',
                periods: [{moves: 40, extraMinutes: 60}]
            },
            {
                optionNumber: '06',
                mode: 'time',
                base: 120,
                inc: 0,
                label: '120м/40 + 60м/20 + 30м',
                details: '2ч/40 ходов + 1ч/20 ходов + 30 мин до конца',
                periods: [{moves: 40, extraMinutes: 60}, {moves: 60, extraMinutes: 30}]
            },
            {
                optionNumber: '07',
                mode: 'time',
                base: 5,
                blackBase: 4,
                inc: 0,
                label: '5 мин vs 4 мин (Armageddon)',
                details: 'Армагеддон без добавления: 5 мин Белые / 4 мин Черные'
            },
            {
                optionNumber: '08',
                mode: 'time',
                base: 10,
                inc: 0,
                isManual: true,
                label: 'Ручная настройка (Time)',
                details: 'Произвольное стартовое время без добавления'
            }
        ]
    },
    {
        group: '09–21 • Fischer Bonus (Фишер с добавлением)',
        options: [
            {
                optionNumber: '09',
                mode: 'fischer',
                base: 3,
                inc: 2,
                label: '3 мин + 2 сек/ход',
                details: 'Стандартный блиц FIDE (3+2)'
            },
            {
                optionNumber: '10',
                mode: 'fischer',
                base: 5,
                inc: 3,
                label: '5 мин + 3 сек/ход',
                details: 'Блиц с добавлением Фишера (5+3)'
            },
            {
                optionNumber: '11',
                mode: 'fischer',
                base: 10,
                inc: 10,
                label: '10 мин + 10 сек/ход',
                details: 'Быстрые шахматы (10+10)'
            },
            {
                optionNumber: '12',
                mode: 'fischer',
                base: 15,
                inc: 5,
                label: '15 мин + 5 сек/ход',
                details: 'Рапид с добавлением (15+5)'
            },
            {
                optionNumber: '13',
                mode: 'fischer',
                base: 15,
                inc: 10,
                label: '15 мин + 10 сек/ход',
                details: 'Стандартный рапид FIDE (15+10)'
            },
            {
                optionNumber: '14',
                mode: 'fischer',
                base: 25,
                inc: 10,
                label: '25 мин + 10 сек/ход',
                details: 'Удлинённый рапид (25+10)'
            },
            {
                optionNumber: '15',
                mode: 'fischer',
                base: 90,
                inc: 30,
                label: '90 мин + 30 сек/ход',
                details: 'Стандартная классика (90+30 с 1-го хода)'
            },
            {
                optionNumber: '16',
                mode: 'fischer',
                base: 90,
                inc: 30,
                label: '90м/40 + 30м + 30с/ход',
                details: 'Турнирный FIDE: 90 мин/40 ходов + 30 мин до конца (+30с с 1-го хода)',
                periods: [{moves: 40, extraMinutes: 30}]
            },
            {
                optionNumber: '17',
                mode: 'fischer',
                base: 100,
                inc: 30,
                label: '100м/40 + 50м + 30с/ход',
                details: '100 мин/40 ходов + 50 мин до конца (+30с с 1-го хода)',
                periods: [{moves: 40, extraMinutes: 50}]
            },
            {
                optionNumber: '18',
                mode: 'fischer',
                base: 100,
                inc: 30,
                label: '100м/40 + 50м/20 + 15м + 30с',
                details: '100м/40 + 50м/20 + 15м до конца (+30с с 1-го хода)',
                periods: [{moves: 40, extraMinutes: 50}, {moves: 60, extraMinutes: 15}]
            },
            {
                optionNumber: '19',
                mode: 'fischer',
                base: 120,
                inc: 0,
                label: '120м/40 + 60м/20 + 15м (+30с с 61 х.)',
                details: 'Классика с добавлением 30 сек/ход начиная с 61-го хода (#)',
                periods: [{moves: 40, extraMinutes: 60}, {moves: 60, extraMinutes: 15, extraIncSeconds: 30}],
                incrementFromMove: 61
            },
            {
                optionNumber: '20',
                mode: 'fischer',
                base: 5,
                blackBase: 4,
                inc: 0,
                label: '5м vs 4м (+2с с 61 х., Armageddon)',
                details: 'Армагеддон FIDE: 5 мин vs 4 мин + 2 сек/ход с 61-го хода (#)',
                periods: [{moves: 60, extraMinutes: 0, extraIncSeconds: 2}],
                incrementFromMove: 61
            },
            {
                optionNumber: '21',
                mode: 'fischer',
                base: 3,
                inc: 2,
                isManual: true,
                label: 'Ручная настройка (Fischer)',
                details: 'Произвольное время и бонус Фишера за каждый ход'
            }
        ]
    },
    {
        group: '22–25 • Delay (Задержка Бронштейна и US Delay)',
        options: [
            {
                optionNumber: '22',
                mode: 'delay',
                base: 90,
                inc: 5,
                label: '90 мин + 5 сек Delay (Bronstein)',
                details: 'Задержка Бронштейна 5 сек на каждый ход'
            },
            {
                optionNumber: '23',
                mode: 'delay',
                base: 5,
                inc: 3,
                isManual: true,
                label: 'Ручная настройка (Bronstein Delay)',
                details: 'Произвольное время с задержкой Бронштейна'
            },
            {
                optionNumber: '24',
                mode: 'us_delay',
                base: 25,
                inc: 5,
                label: '25 мин + 5 сек US Delay',
                details: 'Американская задержка (US Delay) 5 сек перед отсчётом'
            },
            {
                optionNumber: '25',
                mode: 'us_delay',
                base: 5,
                inc: 5,
                isManual: true,
                label: 'Ручная настройка (US Delay)',
                details: 'Произвольное время с американской задержкой'
            }
        ]
    },
    {
        group: '26–29 • Byo-Yomi (Японское и Канадское Бё-ёми)',
        options: [
            {
                optionNumber: '26',
                mode: 'byo_yomi',
                base: 60,
                inc: 20,
                label: '60 мин + 3×20 сек Byo-Yomi',
                details: 'Японское Бё-ёми: 60 мин + 3 периода по 20 сек'
            },
            {
                optionNumber: '27',
                mode: 'byo_yomi',
                base: 30,
                inc: 20,
                isManual: true,
                label: 'Ручная настройка (Byo-Yomi)',
                details: 'Произвольная настройка японского Бё-ёми'
            },
            {
                optionNumber: '28',
                mode: 'canadian_byo',
                base: 60,
                inc: 0,
                label: '60 мин + 5 мин Canadian Byo-Yomi',
                details: 'Канадское Бё-ёми: 60 мин + 5 мин на серию ходов',
                periods: [{extraMinutes: 5}]
            },
            {
                optionNumber: '29',
                mode: 'canadian_byo',
                base: 30,
                inc: 0,
                isManual: true,
                label: 'Ручная настройка (Canadian Byo-Yomi)',
                details: 'Произвольная настройка канадского Бё-ёми'
            }
        ]
    },
    {
        group: '30–36 • Специальные режимы (Scrabble, Hourglass, Gong, Move Timer)',
        options: [
            {
                optionNumber: '30',
                mode: 'scrabble',
                base: 25,
                inc: 0,
                label: '25 мин + Upcount (Scrabble™)',
                details: 'После достижения 0:00 таймер считает штрафное время вверх'
            },
            {
                optionNumber: '31',
                mode: 'scrabble',
                base: 15,
                inc: 0,
                isManual: true,
                label: 'Ручная настройка (Scrabble™)',
                details: 'Произвольное время с отсчётом вверх после 0:00'
            },
            {
                optionNumber: '32',
                mode: 'hourglass',
                base: 1,
                inc: 0,
                label: '1 мин (Hourglass / Песочные часы)',
                details: 'Пока у одного игрока время убывает, у соперника оно прибавляется'
            },
            {
                optionNumber: '33',
                mode: 'hourglass',
                base: 2,
                inc: 0,
                isManual: true,
                label: 'Ручная настройка (Hourglass)',
                details: 'Песочные часы с произвольным стартовым временем'
            },
            {
                optionNumber: '34',
                mode: 'gong',
                base: 10 / 60,
                inc: 0,
                label: '10 сек на ход (Gong)',
                details: 'Фиксированные 10 секунд на каждый ход со сбросом таймера'
            },
            {
                optionNumber: '35',
                mode: 'gong',
                base: 15 / 60,
                inc: 0,
                isManual: true,
                label: 'Ручная настройка (Gong)',
                details: 'Произвольное фиксированное время на каждый ход (Гонг)'
            },
            {
                optionNumber: '36',
                mode: 'move_timer',
                base: 30 / 60,
                inc: 0,
                isManual: true,
                label: 'Ручная настройка (Move Timer)',
                details: 'Таймер на ход со сбросом после каждого сделанного хода'
            }
        ]
    }
];

export const ALL_DGT_OPTIONS: Dgt2500Option[] = TIME_CONTROLS.flatMap(g => g.options);
export const DEFAULT_DGT_OPTION: Dgt2500Option = ALL_DGT_OPTIONS.find(o => o.optionNumber === '09') || ALL_DGT_OPTIONS[0];
