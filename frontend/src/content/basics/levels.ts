// --- FILE: frontend/src/content/basics/levels.ts ---
// Азбука (таск 14.5): 8 разделов по 6–8 уровней. Тексты разделов — в каталогах i18n (basics.sections.<id>),
// здесь только позиции. Корректность каждого уровня (решаемость, достижимость цели) проверяет тест levels.test.ts.

import type {BasicsSection} from './rules';

const K = '7k/8/8/8/8/8/8/'; // начало позиции «чёрный король в углу h8»

export const BASICS: BasicsSection[] = [
    {
        id: 'rook', levels: [
            {kind: 'stars', fen: `${K}R6K w - - 0 1`, hero: 'a1', stars: ['a5']},
            {kind: 'stars', fen: `${K}R6K w - - 0 1`, hero: 'a1', stars: ['a6', 'f6']},
            {kind: 'stars', fen: '7k/8/8/8/3R4/8/8/7K w - - 0 1', hero: 'd4', stars: ['d7', 'b7', 'b2']},
            {kind: 'stars', fen: `${K}R6K w - - 0 1`, hero: 'a1', stars: ['c3', 'f5', 'b8']},
            {kind: 'stars', fen: '7k/8/8/4b3/8/8/8/R6K w - - 0 1', hero: 'a1', stars: ['a6', 'd7', 'd2']},
            {kind: 'stars', fen: '7k/8/8/3n4/8/8/8/R6K w - - 0 1', hero: 'a1', stars: ['b8', 'e6', 'g2']},
            {kind: 'stars', fen: '7k/8/8/2b5/5n2/8/8/R6K w - - 0 1', hero: 'a1', stars: ['c1', 'd8', 'h4']},
        ],
    },
    {
        id: 'bishop', levels: [
            {kind: 'stars', fen: `${K}2B4K w - - 0 1`, hero: 'c1', stars: ['g5']},
            {kind: 'stars', fen: `${K}2B4K w - - 0 1`, hero: 'c1', stars: ['a3', 'e7']},
            {kind: 'stars', fen: `${K}2B4K w - - 0 1`, hero: 'c1', stars: ['h6', 'f8', 'a3']},
            {kind: 'stars', fen: `${K}2B4K w - - 0 1`, hero: 'c1', stars: ['e3', 'b6', 'f2']},
            {kind: 'stars', fen: '7k/8/8/8/3r4/8/8/2B4K w - - 0 1', hero: 'c1', stars: ['e3', 'b6', 'g5']},
            {kind: 'stars', fen: '7k/8/8/2p5/8/5n2/8/2B4K w - - 0 1', hero: 'c1', stars: ['a3', 'e7', 'h6']},
        ],
    },
    {
        id: 'queen', levels: [
            {kind: 'stars', fen: `${K}3Q3K w - - 0 1`, hero: 'd1', stars: ['d7']},
            {kind: 'stars', fen: `${K}3Q3K w - - 0 1`, hero: 'd1', stars: ['a4', 'e8']},
            {kind: 'stars', fen: `${K}3Q3K w - - 0 1`, hero: 'd1', stars: ['b3', 'f7', 'h3']},
            {kind: 'stars', fen: '7k/8/1n6/8/5b2/8/8/3Q3K w - - 0 1', hero: 'd1', stars: ['a5', 'e8', 'g4']},
            {kind: 'stars', fen: '7k/8/8/2r5/8/6b1/8/3Q3K w - - 0 1', hero: 'd1', stars: ['a2', 'e8', 'g4']},
            {kind: 'stars', fen: '7k/2n5/8/8/4r3/8/8/3Q3K w - - 0 1', hero: 'd1', stars: ['b8', 'b2', 'g6', 'f1']},
        ],
    },
    {
        id: 'knight', levels: [
            {kind: 'stars', fen: `${K}1N5K w - - 0 1`, hero: 'b1', stars: ['c3']},
            {kind: 'stars', fen: `${K}1N5K w - - 0 1`, hero: 'b1', stars: ['c3', 'e4']},
            {kind: 'stars', fen: `${K}1N5K w - - 0 1`, hero: 'b1', stars: ['d2', 'b3', 'd4']},
            {kind: 'stars', fen: `${K}1N5K w - - 0 1`, hero: 'b1', stars: ['b2']},
            {kind: 'stars', fen: '7k/8/8/8/8/8/8/N6K w - - 0 1', hero: 'a1', stars: ['g6', 'c7']},
            {kind: 'stars', fen: '7k/8/8/2b5/8/8/8/1N5K w - - 0 1', hero: 'b1', stars: ['e5', 'a6']},
            {kind: 'stars', fen: '7k/8/8/8/2r5/8/8/1N5K w - - 0 1', hero: 'b1', stars: ['d5', 'f3', 'b6']},
        ],
    },
    {
        id: 'kingPawn', levels: [
            {kind: 'stars', fen: '7k/8/8/8/8/8/8/4K3 w - - 0 1', hero: 'e1', stars: ['e3']},
            {kind: 'stars', fen: '7k/8/8/8/8/8/8/4K3 w - - 0 1', hero: 'e1', stars: ['c2', 'c4', 'f4']},
            {kind: 'stars', fen: '7k/8/r7/8/8/8/8/4K3 w - - 0 1', hero: 'e1', stars: ['c3', 'f5']},
            {kind: 'stars', fen: '7k/8/8/8/8/8/4P3/K7 w - - 0 1', hero: 'e2', stars: ['e4']},
            {kind: 'stars', fen: '7k/8/8/8/8/8/4P3/K7 w - - 0 1', hero: 'e2', stars: ['e5']},
            {kind: 'stars', fen: '7k/8/8/8/8/8/4P3/K7 w - - 0 1', hero: 'e2', stars: ['e8']},
            {kind: 'stars', fen: '7k/4P3/8/8/8/8/8/K7 w - - 0 1', hero: 'e7', stars: ['e8', 'a4']},
        ],
    },
    {
        id: 'capture', levels: [
            {kind: 'stars', fen: '7k/8/8/8/3p4/8/8/3R3K w - - 0 1', hero: 'd1', stars: ['d4']},
            {kind: 'stars', fen: '3n3k/8/8/6p1/8/8/8/2B4K w - - 0 1', hero: 'c1', stars: ['g5', 'd8']},
            {kind: 'stars', fen: '7k/8/5p2/8/4N3/2p5/8/7K w - - 0 1', hero: 'e4', stars: ['f6', 'c3']},
            {kind: 'stars', fen: '7k/8/8/8/2p3p1/8/8/4K3 w - - 0 1', hero: 'e1', stars: ['c4', 'g4']},
            {kind: 'stars', fen: '7k/1p6/8/8/5n2/8/8/3Q3K w - - 0 1', hero: 'd1', stars: ['f4', 'b7']},
            {kind: 'stars', fen: '7k/8/8/8/2n5/8/3p4/R6K w - - 0 1', hero: 'a1', stars: ['c4', 'd2']},
        ],
    },
    {
        id: 'checkMate', levels: [
            {kind: 'goal', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', goal: 'check'},
            {kind: 'goal', fen: '4k3/8/8/8/4N3/8/8/4K3 w - - 0 1', goal: 'check'},
            {kind: 'goal', fen: '4k3/8/8/8/8/8/8/4KB2 w - - 0 1', goal: 'check'},
            {kind: 'question', fen: '4k3/8/8/8/8/8/8/R3K3 b - - 0 1'},
            {kind: 'goal', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', goal: 'mate'},
            {kind: 'goal', fen: 'k7/8/1K6/8/8/8/8/7R w - - 0 1', goal: 'mate'},
            {kind: 'goal', fen: '7k/8/6K1/8/8/8/8/Q7 w - - 0 1', goal: 'mate'},
            {kind: 'goal', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', goal: 'mate'},
        ],
    },
    {
        id: 'special', levels: [
            {kind: 'goal', fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1', goal: 'castle'},
            {kind: 'goal', fen: '4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1', goal: 'castle'},
            {kind: 'goal', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', goal: 'enpassant'},
            {kind: 'goal', fen: '4k3/8/8/5Pp1/8/8/8/4K3 w - g6 0 1', goal: 'enpassant'},
            {kind: 'goal', fen: '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', goal: 'promote'},
            {kind: 'goal', fen: '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', goal: 'promote'},
            {kind: 'question', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'},
            {kind: 'question', fen: '7k/7Q/6K1/8/8/8/8/8 b - - 0 1'},
        ],
    },
];

export function sectionById(id: string): BasicsSection | undefined {
    return BASICS.find((section) => section.id === id);
}

/** id прогресса раздела на сервере (тот же формат, что у уроков школы). */
export function progressId(sectionId: string): string {
    return `basics-${sectionId.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}
