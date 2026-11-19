// --- FILE: frontend/src/components/chessboard/GameSummaryPanel.tsx ---
// Окно итога партии — с ботом (таск 11.5) и с человеком (после конца партии): разбор запускается сам после сохранения партии, затем — тип партии,
// точность, ключевые ходы с объяснением наставника и рекомендуемый следующий соперник. Разбор — POST
// /analysis/game/{id} (движок оценивает каждый ход; готовый разбор сервер отдаёт из базы). Тип партии и ключевые
// ходы — поле summary ответа (src/services/game_summary.py), подписи — каталог summary.*. Рекомендацию соперника
// считает Chessboard (services/gameSummary.ts) и передаёт пропсом. Когда разбор готов — карточки «Клубного тренера»
// (CoachCards: задача из своей ошибки, отклонение от репертуара, урок по теме ошибки). В партии с человеком
// рекомендации соперника нет; разбор просится только после конца партии — во время своей партии с человеком сервер
// его не даст (честная игра, forbid_engine_help_during_game).

import {useEffect, useState} from 'react';
import {Trophy} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {analysisApi} from '../../services/analysis';
import {coachText} from '../../services/coach';
import type {CoachComment} from '../../services/coach';
import {isSummaryKind} from '../../services/gameSummary';
import type {GameSummary} from '../../services/gameSummary';
import {CoachCards} from './CoachCards';

// Части ответа разбора, которые нужны этой панели (полный ответ — FullGameAnalysisResponse на сервере).
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
    /** id партии: с ботом — ответ /bots/save-game (пока партия не сохранена, панели нет), с человеком — id партии. */
    gameId: number;
    playerColor: 'white' | 'black';
    /** Имя и сила рекомендуемого соперника (уже на языке игрока); null — рекомендовать некого. */
    recommendation: { name: string; rating: number } | null;
    /** «Сыграть» с рекомендованным соперником; без рекомендации не нужен. */
    onPlayRecommended?: () => void;
}

/** Ход с номером: «12. Nf3» у белых, «12… Nf6» у чёрных. */
function moveLabel(move: ReportMove): string {
    return `${move.move_number}${move.color === 'white' ? '.' : '…'} ${move.san}`;
}

/** Итог партии: сам запрашивает разбор сохранённой партии и показывает его главное. */
export function GameSummaryPanel({gameId, playerColor, recommendation, onPlayRecommended}: Props) {
    const {t} = useI18n();
    const [report, setReport] = useState<Report | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);

    // Разбор запрашивается при появлении панели и при смене партии. Флаг cancelled отбрасывает ответ, пришедший
    // после закрытия панели или к уже другой партии. Отказ сервера (движок занят, исчерпан лимит разборов)
    // показывается текстом по коду ошибки.
    useEffect(() => {
        let cancelled = false;
        setReport(null);
        setError(null);
        analysisApi.run<Report>('played', gameId, 'summary.failed')
            .then((data) => !cancelled && setReport(data))
            .catch((err) => !cancelled && setError(errorMessage(err, 'summary.failed')));
        return () => {
            cancelled = true;
        };
    }, [gameId]);

    const opponentColor = playerColor === 'white' ? 'black' : 'white';
    // Незнакомый тип партии (сервер новее клиента) — итог без типа и ключевых ходов, только точность.
    const summary = report?.summary && isSummaryKind(report.summary.kind) ? report.summary : null;
    // Сервер называет ключевые ходы номером полухода с единицы; в массиве moves они лежат с нуля.
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
                    <CoachCards gameId={gameId}/>
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
