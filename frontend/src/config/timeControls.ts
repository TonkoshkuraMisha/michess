// --- FILE: frontend/src/config/timeControls.ts ---
// Контроли времени для онлайн-игры: 4 категории (как на chess.com и lichess.org), в каждой —
// самые популярные пресеты. Раньше здесь был полный список программ часов DGT 2500 (36 штук,
// включая задержку Бронштейна/US Delay, бё-ёми, песочные часы, гонг, Scrabble) — но сервер
// для сетевых партий понимает только простое время + добавление за ход (Fischer), так что
// все эти экзотические режимы для онлайн-игры были чисто декоративными и только путали выбор.

export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface TimeControlOption {
    id: string;
    category: TimeControlCategory;
    base: number; // минут на старте
    inc: number; // секунд добавления за ход (Fischer); 0 — без добавления
    label: string;
    details: string;
    isManual?: boolean;
}

export interface TimeControlGroup {
    category: TimeControlCategory;
    title: string;
    options: TimeControlOption[];
}

export const TIME_CONTROLS: TimeControlGroup[] = [
    {
        category: 'bullet',
        title: 'Пуля',
        options: [
            {
                id: 'bullet-1+0',
                category: 'bullet',
                base: 1,
                inc: 0,
                label: '1 мин',
                details: 'Самый быстрый формат — чистая пуля без добавления'
            },
            {
                id: 'bullet-1+1',
                category: 'bullet',
                base: 1,
                inc: 1,
                label: '1 мин + 1 сек/ход',
                details: 'Популярная пуля с добавлением Фишера'
            },
            {
                id: 'bullet-2+1',
                category: 'bullet',
                base: 2,
                inc: 1,
                label: '2 мин + 1 сек/ход',
                details: 'Самая популярная пуля на lichess.org'
            },
            {
                id: 'bullet-manual',
                category: 'bullet',
                base: 1,
                inc: 0,
                isManual: true,
                label: 'Ручная настройка (Пуля)',
                details: 'Своё время и добавление в диапазоне пули'
            }
        ]
    },
    {
        category: 'blitz',
        title: 'Блиц',
        options: [
            {
                id: 'blitz-3+0',
                category: 'blitz',
                base: 3,
                inc: 0,
                label: '3 мин',
                details: 'Классический быстрый блиц без добавления'
            },
            {
                id: 'blitz-3+2',
                category: 'blitz',
                base: 3,
                inc: 2,
                label: '3 мин + 2 сек/ход',
                details: 'Стандартный блиц FIDE (3+2)'
            },
            {
                id: 'blitz-5+0',
                category: 'blitz',
                base: 5,
                inc: 0,
                label: '5 мин',
                details: 'Самый популярный блиц на chess.com'
            },
            {
                id: 'blitz-5+3',
                category: 'blitz',
                base: 5,
                inc: 3,
                label: '5 мин + 3 сек/ход',
                details: 'Блиц с добавлением — популярный выбор на lichess.org'
            },
            {
                id: 'blitz-manual',
                category: 'blitz',
                base: 5,
                inc: 0,
                isManual: true,
                label: 'Ручная настройка (Блиц)',
                details: 'Своё время и добавление в диапазоне блица'
            }
        ]
    },
    {
        category: 'rapid',
        title: 'Рапид',
        options: [
            {
                id: 'rapid-10+0',
                category: 'rapid',
                base: 10,
                inc: 0,
                label: '10 мин',
                details: 'Самый популярный рапид на chess.com'
            },
            {
                id: 'rapid-10+5',
                category: 'rapid',
                base: 10,
                inc: 5,
                label: '10 мин + 5 сек/ход',
                details: 'Рапид с добавлением — популярный выбор на lichess.org'
            },
            {
                id: 'rapid-15+10',
                category: 'rapid',
                base: 15,
                inc: 10,
                label: '15 мин + 10 сек/ход',
                details: 'Стандартный рапид FIDE (15+10)'
            },
            {
                id: 'rapid-manual',
                category: 'rapid',
                base: 15,
                inc: 10,
                isManual: true,
                label: 'Ручная настройка (Рапид)',
                details: 'Своё время и добавление в диапазоне рапида'
            }
        ]
    },
    {
        category: 'classical',
        title: 'Классика',
        options: [
            {
                // 30 минут без добавления — уже классика: сервер (classify_time_control) относит партию
                // к категории по оценке «база + 40 × добавление», порог классики — 25 минут.
                id: 'classical-30+0',
                category: 'classical',
                base: 30,
                inc: 0,
                label: '30 мин',
                details: 'Партия на полчаса без добавления'
            },
            {
                id: 'classical-30+20',
                category: 'classical',
                base: 30,
                inc: 20,
                label: '30 мин + 20 сек/ход',
                details: 'Классика lichess.org — развёрнутая игра без цейтнота'
            },
            {
                id: 'classical-60+30',
                category: 'classical',
                base: 60,
                inc: 30,
                label: '60 мин + 30 сек/ход',
                details: 'Длинная классика, близкая к турнирному темпу'
            },
            {
                id: 'classical-manual',
                category: 'classical',
                base: 60,
                inc: 30,
                isManual: true,
                label: 'Ручная настройка (Классика)',
                details: 'Своё время и добавление в диапазоне классики'
            }
        ]
    }
];

export const ALL_TIME_CONTROLS: TimeControlOption[] = TIME_CONTROLS.flatMap(g => g.options);
export const DEFAULT_TIME_CONTROL: TimeControlOption =
    ALL_TIME_CONTROLS.find(o => o.id === 'blitz-3+2') || ALL_TIME_CONTROLS[0];
