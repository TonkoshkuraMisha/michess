// --- FILE: frontend/src/components/gameViewer/viewerModel.ts ---
// Данные и чистые функции просмотра партии (вынесено из GameViewer.tsx, таск 17.6): типы отчёта разбора, оценка
// позиции по материалу без движка, шкала оценки, критические моменты, точки графика.

import type {Chess} from 'chess.js';
import type {CoachArrowKind, CoachComment} from '../../services/coach';
import type {GameSummary} from '../../services/gameSummary';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export interface MoveEvaluationItem {
    ply: number;
    move_number: number;
    color: string;
    san: string;
    uci: string;
    eval_cp: number;
    eval_display: string;
    mate: number | null;
    best_move_uci: string | null;
    cp_loss: number;
    classification: string;
    symbol: string;
    /** Комментарий наставника (формат разбора 2+); null — сказать нечего или движок был недоступен. */
    coach?: CoachComment | null;
}

export type GamePhase = 'opening' | 'middlegame' | 'endgame';
export const GAME_PHASES: GamePhase[] = ['opening', 'middlegame', 'endgame'];

export interface SideSummaryStats {
    accuracy: number;
    best: number;
    good: number;
    inaccuracies: number;
    mistakes: number;
    blunders: number;
    avg_cp_loss: number;
    /** Точность по фазам (таск B.5); null — в этой фазе ходов не было; нет поля — старый разбор. */
    phases?: Partial<Record<GamePhase, number | null>>;
}

export interface FullGameAnalysisReport {
    game_id: number;
    engine: string;
    white: SideSummaryStats;
    black: SideSummaryStats;
    moves: MoveEvaluationItem[];
    /** Итог партии (таск 11.5): тип партии по графику оценки. */
    summary?: GameSummary | null;
}

/** Цвета стрелок наставника: зелёная — лучший ход, красная — угроза соперника, синяя — идея. */
export const COACH_ARROW_COLORS: Record<CoachArrowKind, string> = {
    best: 'rgba(16, 185, 129, 0.88)',
    threat: 'rgba(244, 63, 94, 0.88)',
    idea: 'rgba(56, 189, 248, 0.88)',
};

const PIECE_MAT_VALUES: Record<string, number> = {p: 100, n: 320, b: 330, r: 500, q: 900, k: 0};

/** Оценка за белых по материалу — пока нет разбора движком. */
export function computeStaticWhiteEvalCp(gameInstance: Chess): { cp: number; display: string } {
    if (gameInstance.isCheckmate()) {
        const whiteMated = gameInstance.turn() === 'w';
        return {cp: whiteMated ? -1000 : 1000, display: whiteMated ? '-M1' : 'M1'};
    }
    if (gameInstance.isDraw()) return {cp: 0, display: '0.0'};
    let score = 0;
    for (const row of gameInstance.board()) {
        for (const cell of row) {
            if (!cell) continue;
            const v = PIECE_MAT_VALUES[cell.type] || 0;
            score += cell.color === 'w' ? v : -v;
        }
    }
    const pawns = score / 100;
    const sign = pawns > 0 ? '+' : '';
    return {cp: score, display: `${sign}${pawns.toFixed(1)}`};
}

/** Доля белых на шкале оценки, 4–96%. */
export function evalCpToWhitePercentage(evalCp: number): number {
    const clamped = Math.max(-1000, Math.min(1000, evalCp));
    const pct = 50 + (clamped / 1000) * 46;
    return Math.max(4, Math.min(96, Math.round(pct)));
}

export function classificationBadgeClass(classification?: string): string {
    switch (classification) {
        case 'Best':
            return 'text-emerald-400 font-extrabold';
        case 'Inaccuracy':
            return 'text-sky-400 font-bold';
        case 'Mistake':
            return 'text-amber-400 font-bold';
        case 'Blunder':
            return 'text-rose-400 font-extrabold';
        default:
            return 'text-boxwood/70';
    }
}

export type MomentKey = 'turning' | 'worstWhite' | 'worstBlack' | 'missed';

/** Критические моменты (таск B.5): перелом, худшие ходы сторон, упущенные удары — по одному на ход, по порядку. */
export function criticalMoments(report: FullGameAnalysisReport): { ply: number; key: MomentKey }[] {
    const summary = report.summary;
    if (!summary) return [];
    const moments: { ply: number; key: MomentKey }[] = [];
    if (summary.turning_point_ply) moments.push({ply: summary.turning_point_ply, key: 'turning'});
    if (summary.white.worst_ply) moments.push({ply: summary.white.worst_ply, key: 'worstWhite'});
    if (summary.black.worst_ply) moments.push({ply: summary.black.worst_ply, key: 'worstBlack'});
    for (const item of summary.missed ?? []) moments.push({ply: item.ply, key: 'missed'});
    return moments
        .filter((m, i) => moments.findIndex((o) => o.ply === m.ply) === i)
        .filter((m) => report.moves[m.ply - 1])
        .sort((a, b) => a.ply - b.ply);
}

export interface ChartPoint {
    idx: number;
    ply: number;
    label: string;
    evalPawns: number;
    display: string;
    classification: string;
}

/** Точки графика оценки: пешки за белых, ±10. */
export function chartPoints(report: FullGameAnalysisReport | null): ChartPoint[] {
    if (!report) return [];
    return report.moves.map((m, idx) => ({
        idx,
        ply: m.ply,
        label: `${m.move_number}${m.color === 'white' ? '.' : '...'} ${m.san}`,
        evalPawns: Number((Math.max(-1000, Math.min(1000, m.eval_cp)) / 100).toFixed(2)),
        display: m.eval_display,
        classification: m.classification,
    }));
}

/** Ходы для PGN с разбором: оценка в комментарии `[%eval …]`, текст наставника и символ хода («!» не пишется). */
export function annotatedMoves(history: { san: string }[], report: FullGameAnalysisReport,
                               coachTextOf: (coach: CoachComment | null | undefined) => string | null):
    { san: string; symbol: string; comment: string | null }[] {
    return history.map((m, i) => {
        const a = report.moves[i];
        const note = a ? [`[%eval ${a.mate !== null ? `#${a.mate}` : (a.eval_cp / 100).toFixed(2)}]`, coachTextOf(a.coach)]
            .filter(Boolean).join(' ') : null;
        return {san: m.san, symbol: a?.symbol && a.symbol !== '!' ? a.symbol : '', comment: note};
    });
}
