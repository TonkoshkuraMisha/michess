// Большой курс (таск 27.6, docs/research/supercourse.md): уровни 0–5 по разрядам × ветви Т/М/Э/С/Д/Р/П, модули с
// неизменными кодами и шагами-ячейками. Шаг ведёт в готовый раздел (те же упражнения, что у программ 22.3); модуль
// без шагов — место в каркасе под будущее наполнение (игроку не показывается, виден в режиме «покрытие»).
// Названия модулей — в каталогах i18n: supercourse.modules.<код, точка заменена на «_»>.

import type {Activity} from './programs';
import {MUST_KNOW, STUDIES} from './mustKnow';

export const BRANCHES = ['T', 'M', 'E', 'S', 'O', 'C', 'G'] as const;  // тактика, мат, эндшпиль, стратегия, дебют, расчёт, партии
export type Branch = typeof BRANCHES[number];

export interface CourseModule {
    code: string;
    level: number;
    branch: Branch;
    steps: Activity[];
}

const b = (id: string): Activity => ({kind: 'basics', id});
const l = (id: string): Activity => ({kind: 'lesson', id});
const m = (id: string): Activity => ({kind: 'mates', id});
const e = (id: string): Activity => ({kind: 'endgame', id});
const th = (id: string): Activity => ({kind: 'theme', id});
const tr = (id: string): Activity => ({kind: 'trainer', id});
const mini = (id: string): Activity => ({kind: 'mini', id});
const ex = (id: string): Activity => ({kind: 'exam', id});
const lib = (structure: string): Activity => ({kind: 'library', structure});
const games = (moves: string): Activity => ({kind: 'library', moves});
const REPERTOIRE: Activity = {kind: 'repertoire'};
const CLASSICS: Activity = {kind: 'classics'};
const GUESS: Activity = {kind: 'guess'};

function mod(code: string, branch: Branch, steps: Activity[] = []): CourseModule {
    return {code, level: Number(code.slice(1).split('.')[0]), branch, steps};
}

export const COURSE: CourseModule[] = [
    // --- Уровень 0. Азбука ---
    mod('T0.0', 'T', [b('rook'), b('bishop'), b('queen'), b('knight'), b('kingPawn'), b('capture')]),
    mod('T0.1', 'T', [b('checkMate')]),
    mod('M0.1', 'M', [b('checkMate'), m('back_rank_mate')]),
    mod('E0.1', 'E', [e('kq_center'), e('kq_far'), e('kr_edge'), e('kr_center')]),
    mod('T0.2', 'T', [th('hanging_piece')]),
    mod('O0.1', 'O', [b('special'), th('early_queen')]),
    mod('G0.1', 'G', [mini('pawn_war'), mini('king_pawns'), mini('capture_flag')]),
    mod('X0', 'G', [ex('F')]),
    // --- Уровень 1. Новичок ---
    mod('T1.1', 'T', [l('tactics-double-attack'), th('fork'), th('fork_knight'), th('fork_pawn')]),
    mod('T1.2', 'T', [l('tactics-pin'), th('pin')]),
    mod('T1.3', 'T', [l('tactics-discovered-attack'), th('discovered_attack'), th('discovered_check')]),
    mod('T1.4', 'T', [l('tactics-skewer'), th('skewer')]),
    mod('T1.5', 'T', [th('find_the_threat'), th('defensive_move')]),
    mod('M1.1', 'M', [th('back_rank_mate')]),
    mod('M1.2', 'M', [l('king-back-rank'), m('back_rank_mate'), l('king-smothered-mate'), m('smothered_mate')]),
    mod('M1.3', 'M', [l('king-f7-weakness'), th('f7_f2_attack')]),
    mod('E1.1', 'E', [l('endgame-square'), e('square_win'), e('square_race'), e('kp_key_square'), l('endgame-opposition'), e('kp_opposition_def')]),
    mod('E1.2', 'E', [l('endgame-queen-vs-pawn'), e('q_vs_pawn')]),
    mod('E1.3', 'E', [l('endgame-simplify'), l('endgame-active-king')]),
    mod('O1.1', 'O', [th('development_lag')]),
    mod('O1.2', 'O', [th('opening_trap'), th('trap_scholars_mate'), th('trap_noahs_ark')]),
    mod('O1.3', 'O', [REPERTOIRE]),
    mod('C1.1', 'C', [tr('coord_find'), tr('coord_name'), tr('coord_color'), tr('quiet_path')]),
    mod('C1.2', 'C', [tr('calc_checks')]),
    mod('C1.3', 'C', [tr('calc_distance'), tr('knight_route')]),
    mod('G1.1', 'G', [tr('miniatures')]),
    mod('X1', 'G', [ex('A'), ex('B')]),
    // --- Уровень 2. IV–III разряд ---
    mod('T2.1', 'T', [l('tactics-double-check'), th('double_check'), th('windmill')]),
    mod('T2.2', 'T', [l('tactics-intermezzo'), th('intermezzo')]),
    mod('T2.3', 'T', [l('tactics-x-ray'), th('x_ray'), th('battery')]),
    mod('T2.4', 'T', [l('tactics-deflection'), th('deflection')]),
    mod('T2.5', 'T', [l('tactics-decoy'), th('decoy')]),
    mod('T2.6', 'T', [th('remove_defender'), th('overload')]),
    mod('T2.7', 'T', [l('tactics-unstoppable-threat'), th('counterattack'), th('unstoppable_threat')]),
    mod('T2.8', 'T', [th('tempo_gain'), th('seventh_rank')]),
    mod('T2.9', 'T', [l('tactics-trapped-piece'), th('trapped_piece'), th('domination')]),
    mod('T2.10', 'T', [l('tactics-pawn-breakthrough'), th('pawn_breakthrough'), th('promotion'), th('underpromotion'), th('advanced_pawn')]),
    mod('M2.1', 'M', [m('anastasia_mate'), m('arabian_mate'), m('boden_mate'), m('double_bishop_mate'), m('epaulette_mate'), m('hook_mate')]),
    mod('M2.2', 'M', [l('king-rook-knight-mates'), l('king-bishop-mates')]),
    mod('M2.3', 'M', [l('king-exposed'), th('exposed_king')]),
    mod('E2.1', 'E', [l('endgame-key-squares'), th('triangulation'), th('outflanking'), th('shouldering'), e('two_pawns'), e('two_pawns_connected')]),
    mod('E2.2', 'E', [e('lucena'), e('philidor'), th('rook_behind_passer')]),
    mod('E2.3', 'E', [e('wrong_bishop'), e('rook_pawn_def')]),
    mod('E2.4', 'E', MUST_KNOW[0].map(e)),
    mod('S2.1', 'S', [th('open_file'), th('seventh_rank')]),
    mod('S2.2', 'S', [th('outpost')]),
    mod('S2.3', 'S', [th('bad_bishop')]),
    mod('S2.4', 'S', [th('weak_squares'), th('isolated_pawn')]),
    mod('S2.5', 'S', [lib('symmetry'), lib('french_chain'), lib('kid_chain'), tr('structure_quiz')]),
    mod('O2.1', 'O', [REPERTOIRE]),
    mod('O2.2', 'O', [REPERTOIRE]),
    mod('C2.1', 'C', [tr('blind_move'), tr('blind_where')]),
    mod('C2.2', 'C', [tr('calc_exchange')]),
    mod('C2.3', 'C', [th('candidate_moves')]),
    mod('G2.1', 'G', [CLASSICS]),
    mod('G2.2', 'G', [GUESS]),
    mod('G2.3', 'G', [{kind: 'library'}]),
    mod('X2', 'G', [ex('C'), ex('D'), ex('E')]),
    // --- Уровень 3. III–II разряд ---
    mod('T3.1', 'T', [th('clearance')]),
    mod('T3.2', 'T', [l('tactics-square-conquest'), th('remove_defender'), th('decoy')]),
    mod('T3.3', 'T', [th('clearance')]),
    mod('T3.4', 'T', [th('interference')]),
    mod('T3.5', 'T', [th('blockade')]),
    mod('T3.6', 'T', [th('quiet_move')]),
    mod('T3.7', 'T', [th('combination')]),
    mod('T3.8', 'T', [th('equality'), th('save_by_perpetual'), th('save_by_stalemate'), th('perpetual_check'), th('stalemate_trick'), th('fortress'), th('desperado')]),
    mod('M3.1', 'M', [th('greek_gift'), th('double_bishop_sacrifice')]),
    mod('M3.2', 'M', [th('pawn_storm'), th('rook_lift')]),
    mod('M3.3', 'M', [th('kingside_attack'), th('queenside_attack')]),
    mod('M3.4', 'M', [th('sacrifice')]),
    mod('E3.1', 'E', [l('endgame-bishop-vs-knight'), e('bishop_vs_knight')]),
    mod('E3.2', 'E', [e('opposite_bishops_def')]),
    mod('E3.3', 'E', [e('q_vs_knight'), e('q_vs_rook')]),
    mod('E3.4', 'E', [l('endgame-rook-vs-pawn'), e('rook_vs_pawn'), l('endgame-passed-pawn')]),
    mod('E3.5', 'E', MUST_KNOW[1].map(e)),
    mod('S3.1', 'S', [lib('spanish')]),
    mod('S3.2', 'S', [lib('french_chain')]),
    mod('S3.3', 'S', [lib('symmetry')]),
    mod('S3.4', 'S', [lib('french_exchange')]),
    mod('S3.5', 'S', [lib('saw')]),
    mod('S3.6', 'S', [lib('maroczy')]),
    mod('S3.7', 'S', [th('isolated_pawn'), lib('isolated_pawn')]),
    mod('S3.10', 'S', [tr('structure_quiz'), tr('plan_quiz')]),
    mod('S3.8', 'S', [th('blockade'), th('overprotection'), th('centralization'), th('pawn_chain')]),
    mod('S3.9', 'S', [th('minority_attack'), th('bishop_pair')]),
    mod('O3.1', 'O', [REPERTOIRE]),
    mod('O3.2', 'O', [games('e2e4 c7c5'), lib('maroczy'), lib('hedgehog'), REPERTOIRE]),
    mod('O3.3', 'O', [REPERTOIRE]),
    mod('C3.1', 'C', [th('long_calculation')]),
    mod('C3.2', 'C', [tr('calc_checks'), tr('calc_square')]),
    mod('C3.3', 'C', [tr('blind_move'), tr('memory_game')]),
    mod('G3.1', 'G', [{kind: 'library'}]),
    mod('X3', 'G', [ex('G'), ex('H'), ex('I')]),
    // --- Уровень 4. II–I разряд ---
    mod('T4.1', 'T', [th('combination'), th('long_calculation')]),
    mod('T4.2', 'T', [th('promotion'), th('pawn_race')]),
    mod('T4.3', 'T', [th('defensive_move'), th('blunder_check')]),
    mod('M4.1', 'M', [th('exposed_king')]),
    mod('M4.2', 'M', [th('kingside_attack')]),
    mod('M4.3', 'M', [th('counterattack')]),
    mod('E4.1', 'E', [l('endgame-active-king')]),
    mod('E4.2', 'E', [th('exchange_choice')]),
    mod('E4.3', 'E', [e('rook_vs_bishop_def'), e('rook_vs_knight_def'), e('q_vs_rook')]),
    mod('E4.4', 'E', STUDIES.map(e)),
    mod('S4.1', 'S', [lib('hanging_pawns')]),
    mod('S4.2', 'S', [lib('carlsbad')]),
    mod('S4.3', 'S', [lib('stonewall')]),
    mod('S4.4', 'S', [lib('kid_chain')]),
    mod('S4.5', 'S', [lib('wedge')]),
    mod('S4.6', 'S', [lib('modern_benoni')]),
    mod('S4.7', 'S', [lib('hedgehog')]),
    mod('S4.8', 'S', [th('restriction')]),
    mod('S4.9', 'S', [th('piece_improvement'), th('prophylaxis')]),
    mod('S4.10', 'S', [th('exchange_choice')]),
    mod('S4.11', 'S', [tr('plan_quiz')]),
    mod('O4.1', 'O', [tr('plan_quiz'), tr('structure_quiz'), lib('isolated_pawn')]),
    mod('O4.2', 'O', [REPERTOIRE]),
    mod('C4.1', 'C', [tr('calc_eval')]),
    mod('C4.2', 'C', [tr('calc_compare')]),
    mod('G4.1', 'G', [{kind: 'library'}]),
    mod('G4.2', 'G', [{kind: 'workout'}]),
    mod('X4', 'G', [ex('J'), ex('endgame')]),
    // --- Уровень 5. I разряд — КМС ---
    mod('T5.1', 'T', [th('combination')]),
    mod('T5.2', 'T', [th('equality'), th('fortress'), th('save_by_perpetual')]),
    mod('M5.1', 'M', [th('sacrifice')]),
    mod('E5.1', 'E', [e('vancura'), e('lucena'), e('philidor'), th('philidor_position'), th('rook_behind_passer')]),
    mod('E5.2', 'E', [{kind: 'library'}]),
    mod('E5.3', 'E', MUST_KNOW[2].map(e)),
    mod('S5.1', 'S', [th('critical_position')]),
    mod('S5.2', 'S', [th('sacrifice'), th('development_lag'), CLASSICS]),
    mod('S5.3', 'S', [th('greek_gift'), th('double_bishop_sacrifice'), th('sacrifice')]),
    mod('S5.4', 'S', [CLASSICS, GUESS]),
    mod('O5.1', 'O', [{kind: 'library'}, REPERTOIRE]),
    mod('O5.2', 'O', [REPERTOIRE]),
    mod('C5.1', 'C', [th('prophylaxis')]),
    mod('C5.2', 'C', [tr('calc_checks'), tr('calc_exchange')]),
    mod('G5.1', 'G', [CLASSICS]),
    mod('G5.2', 'G', [{kind: 'workout'}, GUESS]),
    mod('X5', 'G', [ex('F'), ex('J'), ex('endgame')]),
];

export const LEVEL_COUNT = 6;

// Экзамен уровня (таск 27.12): модуль X<n> — разделы диагностики 22.0; уровень пройден, когда по каждому разделу
// последняя оценка не ниже порога разряда уровня (азбука — 800, IV разряд — 1000 … КМС — 1800).
export const LEVEL_EXAM_TARGET = [800, 1000, 1200, 1400, 1600, 1800] as const;

export function examSections(level: number): string[] {
    const module = COURSE.find((m) => m.code === `X${level}`);
    return (module?.steps ?? []).flatMap((s) => (s.kind === 'exam' ? [s.id] : []));
}

export function levelExamPassed(level: number, results: Record<string, { estimate: number }>): boolean {
    const sections = examSections(level);
    return sections.length > 0 && sections.every((s) => (results[s]?.estimate ?? 0) >= LEVEL_EXAM_TARGET[level]);
}

export const moduleTitleKey = (code: string) => `supercourse.modules.${code.replace('.', '_')}`;

export const courseProgressId = (code: string) => `course-${code.toLowerCase().replace('.', '-')}`;
