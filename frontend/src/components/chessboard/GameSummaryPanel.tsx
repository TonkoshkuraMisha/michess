// --- FILE: frontend/src/components/chessboard/GameSummaryPanel.tsx ---
// Окно итога партии с ботом (таск 11.5): разбор запускается сам после сохранения партии, затем — тип партии,
// точность, ключевые ходы с объяснением наставника и рекомендуемый следующий соперник.

import {useEffect, useState} from 'react';
import {Trophy} from 'lucide-react';
import {API_BASE_URL} from '../../config/api';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {readApiError} from '../../services/apiErrors';
import {coachText} from '../../services/coach';
import type {CoachComment} from '../../services/coach';
import {isSummaryKind} from '../../services/gameSummary';
import type {GameSummary} from '../../services/gameSummary';

interface ReportMove {
    ply: number;
    move_number: number;
    color: 'white' | 'black';
    san: string;
    coach?: CoachComment | null;
}

interface Report {
    white: { accuracy: number };
    black: { accuracy: number };
    moves: ReportMove[];
    summary?: GameSummary | null;
}

interface Props {
    gameId: number;
    playerColor: 'white' | 'black';
    /** Имя и сила рекомендуемого соперника (уже на языке игрока); null — рекомендовать некого. */
    recommendation: { name: string; rating: number } | null;
    onPlayRecommended: () => void;
}

function moveLabel(move: ReportMove): string {
    return `${move.move_number}${move.color === 'white' ? '.' : '…'} ${move.san}`;
}

export function GameSummaryPanel({gameId, playerColor, recommendation, onPlayRecommended}: Props) {
    const {t} = useI18n();
    const [report, setReport] = useState<Report | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        let cancelled = false;
        setReport(null);
        setError(null);
        const token = localStorage.getItem('token');
        fetch(`${API_BASE_URL}/api/v1/analysis/game/${gameId}`, {
            method: 'POST', headers: token ? {Authorization: `Bearer ${token}`} : {},
        })
            .then(async (res) => {
                if (cancelled) return;
                if (res.ok) setReport(await res.json());
                else setError(await readApiError(res));
            })
            .catch(() => !cancelled && setError({key: 'summary.failed'}));
        return () => {
            cancelled = true;
        };
    }, [gameId]);

    const opponentColor = playerColor === 'white' ? 'black' : 'white';
    const summary = report?.summary && isSummaryKind(report.summary.kind) ? report.summary : null;
    const moveAt = (ply: number | null | undefined) => (ply ? report?.moves[ply - 1] ?? null : null);
    const moments: { label: 'summary.turningPoint' | 'summary.yourBest' | 'summary.yourWorst'; move: ReportMove }[] = [];
    if (summary) {
        const turning = moveAt(summary.turning_point_ply);
        if (turning) moments.push({label: 'summary.turningPoint', move: turning});
        const best = moveAt(summary[playerColor].best_ply);
        if (best) moments.push({label: 'summary.yourBest', move: best});
        const worst = moveAt(summary[playerColor].worst_ply);
        if (worst && worst !== turning) moments.push({label: 'summary.yourWorst', move: worst});
    }

    return (
        <section aria-label={t('summary.title')} data-testid="game-summary"
                 className="bg-acacia-dark p-2.5 rounded-md border border-amber-600/50 text-xs text-boxwood-light flex flex-col gap-2">
            <div className="flex items-center gap-1.5 font-bold text-amber-400">
                <Trophy size={14}/> {t('summary.title')}
            </div>
            {!report && !error && <p className="animate-pulse text-amber-300">{t('summary.loading')}</p>}
            {error && <p className="text-rose-300" role="status">{renderUiMessage(error, t)}</p>}
            {report && (
                <>
                    {summary && (
                        <div data-testid="summary-kind">
                            <p className="font-bold text-amber-200">{t(`summary.kinds.${summary.kind}.name`)}</p>
                            <p className="text-boxwood/80 leading-snug">{t(`summary.kinds.${summary.kind}.text`)}</p>
                        </div>
                    )}
                    <p data-testid="summary-accuracy">
                        {t('summary.accuracy', {
                            mine: report[playerColor].accuracy, theirs: report[opponentColor].accuracy,
                        })}
                    </p>
                    {moments.map(({label, move}) => (
                        <div key={`${label}-${move.ply}`} data-testid={`summary-moment-${move.ply}`}>
                            <p className="font-bold">{t(label, {move: moveLabel(move)})}</p>
                            {move.coach && <p className="text-boxwood/80 leading-snug">{coachText(move.coach, t)}</p>}
                        </div>
                    ))}
                </>
            )}
            {recommendation && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-900/40">
                    <span data-testid="summary-recommendation">
                        {t('summary.recommend', {name: recommendation.name, rating: recommendation.rating})}
                    </span>
                    <button type="button" onClick={onPlayRecommended} data-testid="summary-play"
                            className="px-2 py-1 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold cursor-pointer">
                        {t('summary.play')}
                    </button>
                </div>
            )}
        </section>
    );
}
