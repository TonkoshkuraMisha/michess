// Программы тренировок (таск 22.3): маршруты по уже готовым разделам — азбуке, урокам, курсу матов, эндшпилю, темам
// задач, тренажёрам, репертуару, экзамену. 8 недель × 5 занятий; занятие — 1–2 упражнения. Названия программ — в
// каталогах (programs.<id>.*), подписи упражнений — из каталогов самих разделов. Все id сверяет тест
// (content/__tests__/programs.test.ts).

export type Activity =
    | { kind: 'basics'; id: string }
    | { kind: 'lesson'; id: string }
    | { kind: 'mates'; id: string }
    | { kind: 'endgame'; id: string }
    | { kind: 'theme'; id: string }
    | { kind: 'trainer'; id: string }
    | { kind: 'mini'; id: string }
    | { kind: 'exam'; id: string }
    /** Библиотека партий (27.1), с фильтром по пешечной структуре (27.5) — для модулей Большого курса. */
    | { kind: 'library'; structure?: string; moves?: string }
    | { kind: 'workout' | 'repertoire' | 'classics' | 'guess' | 'play' };

export type Session = Activity[];

export interface Program {
    id: 'first_steps' | 'to_1200' | 'club' | 'advanced';
    /** Ориентир по рейтингу: [от, до]. */
    range: [number, number];
    weeks: Session[][];
}

const b = (id: string): Activity => ({kind: 'basics', id});
const l = (id: string): Activity => ({kind: 'lesson', id});
const m = (id: string): Activity => ({kind: 'mates', id});
const e = (id: string): Activity => ({kind: 'endgame', id});
const th = (id: string): Activity => ({kind: 'theme', id});
const tr = (id: string): Activity => ({kind: 'trainer', id});
const mini = (id: string): Activity => ({kind: 'mini', id});
const ex = (id: string): Activity => ({kind: 'exam', id});
const WORKOUT: Activity = {kind: 'workout'};
const REPERTOIRE: Activity = {kind: 'repertoire'};
const CLASSICS: Activity = {kind: 'classics'};
const GUESS: Activity = {kind: 'guess'};
const PLAY: Activity = {kind: 'play'};

export const PROGRAMS: Program[] = [
    {
        id: 'first_steps', range: [0, 800], weeks: [
            [[b('rook')], [b('bishop')], [b('queen')], [b('knight')], [b('kingPawn')]],
            [[b('capture')], [b('checkMate')], [b('special')], [mini('pawn_war')], [tr('coord_find')]],
            [[m('back_rank_mate')], [e('kq_center')], [e('kr_edge')], [tr('coord_name')], [l('king-back-rank')]],
            [[l('tactics-double-attack')], [th('fork')], [th('fork_knight')], [tr('knight_route')], [mini('king_pawns')]],
            [[l('tactics-pin')], [th('pin')], [th('hanging_piece')], [l('king-f7-weakness')], [th('f7_f2_attack')]],
            [[e('square_win')], [e('kp_key_square')], [l('endgame-square')], [l('endgame-opposition')], [th('opening_trap')]],
            [[th('early_queen')], [th('trap_scholars_mate')], [PLAY], [tr('calc_checks')], [WORKOUT]],
            [[l('tactics-review')], [l('king-review')], [l('endgame-review')], [ex('F')], [ex('A')]],
        ],
    },
    {
        id: 'to_1200', range: [800, 1200], weeks: [
            [[l('tactics-double-attack'), th('fork')], [th('double_attack')], [tr('double_strike')], [WORKOUT], [PLAY]],
            [[l('tactics-pin'), th('pin')], [l('tactics-skewer'), th('skewer')], [tr('calc_exchange')], [WORKOUT], [PLAY]],
            [[l('tactics-discovered-attack')], [th('discovered_attack')], [th('discovered_check')], [m('smothered_mate')], [m('arabian_mate')]],
            [[l('tactics-deflection'), th('deflection')], [th('decoy')], [th('remove_defender')], [tr('blind_move')], [WORKOUT]],
            [[e('bb_corner')], [e('kr_center'), e('kr_box')], [l('endgame-active-king')], [th('opposition')], [PLAY]],
            [[REPERTOIRE], [th('opening_trap')], [th('development_lag')], [GUESS], [CLASSICS]],
            [[m('anastasia_mate')], [m('hook_mate')], [th('back_rank_mate')], [th('defensive_move')], [th('find_the_threat')]],
            [[ex('A')], [ex('B')], [ex('C')], [ex('F')], [PLAY]],
        ],
    },
    {
        id: 'club', range: [1200, 1600], weeks: [
            [[th('intermezzo')], [th('quiet_move')], [th('overload')], [th('interference')], [th('clearance')]],
            [[th('greek_gift')], [th('kingside_attack')], [th('exposed_king')], [th('rook_lift')], [th('sacrifice')]],
            [[e('lucena')], [e('philidor')], [th('rook_behind_passer')], [l('endgame-passed-pawn')], [e('q_vs_pawn')]],
            [[th('outpost')], [th('open_file')], [th('seventh_rank')], [th('bad_bishop')], [th('weak_squares')]],
            [[REPERTOIRE], [th('combination')], [th('long_calculation')], [tr('calc_square')], [tr('blind_where')]],
            [[th('trapped_piece')], [th('domination')], [th('zugzwang')], [th('perpetual_check')], [th('stalemate_trick')]],
            [[th('pawn_breakthrough')], [th('pawn_race')], [th('promotion')], [th('underpromotion')], [e('two_pawns_connected')]],
            [[ex('D')], [ex('E')], [ex('G')], [ex('J')], [ex('endgame')]],
        ],
    },
    {
        id: 'advanced', range: [1600, 2000], weeks: [
            [[th('combination')], [th('long_calculation')], [th('candidate_moves')], [th('x_ray')], [th('windmill')]],
            [[th('double_bishop_sacrifice')], [th('pawn_storm')], [th('queenside_attack')], [m('boden_mate')], [m('double_bishop_mate')]],
            [[th('isolated_pawn')], [th('minority_attack')], [th('piece_improvement')], [th('prophylaxis')], [th('exchange_choice')]],
            [[e('q_vs_rook')], [e('q_vs_knight')], [e('rook_vs_bishop_def')], [e('rook_vs_knight_def')], [e('wrong_bishop')]],
            [[th('fortress')], [th('save_by_perpetual')], [th('save_by_stalemate')], [th('counterattack')], [th('desperado')]],
            [[CLASSICS], [GUESS], [REPERTOIRE], [tr('memory_game')], [tr('calc_eval')]],
            [[th('triangulation')], [th('outflanking')], [th('shouldering')], [th('key_squares')], [e('kp_opposition_def')]],
            [[ex('H')], [ex('I')], [ex('J')], [ex('endgame')], [PLAY]],
        ],
    },
];

export const SESSIONS_PER_PROGRAM = 40;

export function sessionsOf(program: Program): Session[] {
    return program.weeks.flat();
}

export function programById(id: string): Program | undefined {
    return PROGRAMS.find((p) => p.id === id);
}

/** Куда ведёт упражнение. Тема задач открывается сразу тренировкой (PuzzlesPage читает состояние перехода). */
export function activityLink(activity: Activity): { to: string; state?: unknown } {
    switch (activity.kind) {
        case 'basics': return {to: `/learn/basics/${activity.id}`};
        case 'lesson': return {to: `/learn/${activity.id}`};
        case 'mates': return {to: `/learn/mates/${activity.id}`};
        case 'endgame': return {to: `/learn/endgames/${activity.id}`};
        case 'theme': return {to: '/puzzles', state: {train: {theme: activity.id, blind: false}}};
        case 'trainer': return {to: `/train/${activity.id}`};
        case 'mini': return {to: `/train/games/${activity.id}`};
        case 'exam': return {to: `/exam?test=${activity.id}`};
        case 'library': {
            const query = new URLSearchParams();
            if (activity.structure) query.set('structure', activity.structure);
            if (activity.moves) query.set('moves', activity.moves);
            const text = query.toString();
            return {to: text ? `/library?${text}` : '/library'};
        }
        case 'workout': return {to: '/workout'};
        case 'repertoire': return {to: '/repertoire'};
        case 'classics': return {to: '/learn/classics'};
        case 'guess': return {to: '/guess'};
        case 'play': return {to: '/'};
    }
}
