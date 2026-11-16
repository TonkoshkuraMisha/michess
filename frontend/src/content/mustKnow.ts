// «Обязательные позиции» эндшпиля (таск 27.9): три ступени из упражнений тренажёра 14.4 (content/endgames.json),
// каждое проверяется эндшпильными таблицами. Отметка «освоено» — пройденное упражнение (запись endgame-<id>).
// Ступени встают в Большой курс модулями E2.4, E3.5 и E5.3.

export const MUST_KNOW: readonly (readonly string[])[] = [
    // I — уровень 2: элементарные маты, король и пешка, оппозиция, крайняя пешка, ферзь против пешки.
    ['kq_center', 'kr_edge', 'square_win', 'kp_key_square', 'kp_sixth', 'kp_opposition_def', 'rook_pawn_def', 'q_vs_pawn'],
    // II — уровень 3: Лусена, Филидор, ладья сзади проходной, «не тот» слон, ферзь против пешки на c- и a-линии.
    ['lucena', 'philidor', 'rook_behind_pawn', 'rook_vs_pawn', 'wrong_bishop', 'two_pawns', 'q_vs_c_pawn_def',
        'q_vs_a_pawn_def', 'bb_center'],
    // III — уровень 5: слон и конь, ферзь против ладьи и коня, защиты против ладьи, разноцветные слоны, Ванчура.
    ['bn_corner', 'q_vs_rook', 'q_vs_knight', 'rook_vs_bishop_def', 'rook_vs_knight_def', 'opposite_bishops_def', 'vancura'],
];

// Этюды (27.9) — только давно умерших составителей, каждый с записью в ATTRIBUTION.md; модуль курса E4.4.
export const STUDIES: readonly string[] = ['study_saavedra', 'study_reti'];
