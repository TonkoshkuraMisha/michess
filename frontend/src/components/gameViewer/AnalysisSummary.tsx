// --- FILE: frontend/src/components/gameViewer/AnalysisSummary.tsx ---
// Части панели разбора партии (вынесено из GameViewer.tsx, таск 17.6): критические моменты, карточка стороны,
// график оценки и комментарий наставника. Чистые вычисления — viewerModel.ts; данные приходят пропсами
// из GameViewer.tsx (отчёт разбора сервера и текст наставника, собранный клиентом из кодов coach.*).

import {Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {GraduationCap} from 'lucide-react';
import {useI18n} from '../../i18n';
import {GAME_PHASES, criticalMoments} from './viewerModel';
import type {ChartPoint, FullGameAnalysisReport, SideSummaryStats} from './viewerModel';

/** Список критических моментов партии (перелом, худшие ходы, упущенное); щелчок переходит к ходу. */
export function CriticalMoments({report, viewIndex, onSelect}: {
    report: FullGameAnalysisReport; viewIndex: number; onSelect: (index: number) => void;
}) {
    const {t} = useI18n();
    const shown = criticalMoments(report);
    if (shown.length === 0) return null;
    return (
        <div className="text-xs p-2 rounded bg-black/40 border border-amber-900/40 flex flex-col gap-1" data-testid="viewer-moments">
            <span className="font-bold text-amber-200">{t('viewer.moments.title')}</span>
            {shown.map((moment) => {
                const move = report.moves[moment.ply - 1];
                const label = `${move.move_number}${move.color === 'white' ? '.' : '…'} ${move.san}`;
                return (
                    <button key={moment.ply} type="button" data-testid={`moment-${moment.ply}`}
                            onClick={() => onSelect(moment.ply - 1)}
                            className={`text-left px-1.5 py-0.5 rounded hover:bg-black/40 cursor-pointer ${viewIndex === moment.ply - 1 ? 'bg-amber-900/50' : ''}`}>
                        <span className="text-boxwood/70">{t(`viewer.moments.${moment.key}`)}</span>
                        {' '}<b className="font-mono text-amber-100">{label}</b>
                    </button>
                );
            })}
        </div>
    );
}

/** Точность, счёт оценок ходов и точность по фазам одной стороны. */
export function SideStatsCard({symbol, name, stats, side}: {
    symbol: string; name: string; stats: SideSummaryStats; side: 'white' | 'black';
}) {
    const {t} = useI18n();
    return (
        <div className="p-2 rounded bg-black/40 border border-amber-900/40 flex flex-col gap-1">
            <div className="flex justify-between items-center">
                <span className="font-bold text-amber-200 truncate">{symbol} {name}</span>
                <span className="font-mono font-extrabold text-sm text-emerald-400">{stats.accuracy}%</span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-boxwood/80">
                <span className="text-emerald-400" title={t('viewer.bestMoves')}>! {stats.best}</span>
                <span className="text-sky-400" title={t('viewer.inaccuracies')}>?! {stats.inaccuracies}</span>
                <span className="text-amber-400" title={t('viewer.mistakes')}>? {stats.mistakes}</span>
                <span className="text-rose-400 font-bold" title={t('viewer.blunders')}>?? {stats.blunders}</span>
            </div>
            {stats.phases && (
                <div className="flex justify-between text-[11px] text-boxwood/80" data-testid={`viewer-phases-${side}`}>
                    {GAME_PHASES.map((phase) => (
                        <span key={phase} title={t(`viewer.phases.${phase}`)}>
                            {t(`viewer.phasesShort.${phase}`)}{' '}
                            <b className="font-mono">{stats.phases?.[phase] != null ? `${stats.phases?.[phase]}%` : '—'}</b>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

/** График оценки по ходам; щелчок по точке — к этому ходу. */
export function EvalChart({data, onSelect}: { data: ChartPoint[]; onSelect: (index: number) => void }) {
    return (
        <div className="h-24 w-full bg-room-dark rounded border border-amber-900/50 p-1">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={data}
                    onClick={(state: { activeTooltipIndex?: unknown } | null) => {
                        if (!state || typeof state.activeTooltipIndex !== 'number') return;
                        onSelect(state.activeTooltipIndex);
                    }}
                >
                    <XAxis dataKey="ply" hide/>
                    <YAxis domain={[-10, 10]} hide/>
                    <ReferenceLine y={0} stroke="#7A4B31" strokeDasharray="3 3"/>
                    <Tooltip
                        contentStyle={{backgroundColor: '#1A120B', borderColor: '#7A4B31', fontSize: '12px', padding: '4px 8px'}}
                        formatter={(_val: unknown, _name: unknown, props: { payload?: ChartPoint }) => [
                            `${props.payload?.display} (${props.payload?.classification})`,
                            props.payload?.label,
                        ]}
                        labelFormatter={() => ''}
                    />
                    <Area type="monotone" dataKey="evalPawns" stroke="#f59e0b" fill="#E6C998" fillOpacity={0.35} strokeWidth={2}/>
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

/** Комментарий наставника к текущему ходу; флажок включает показ его стрелок на доске (если они есть). */
export function CoachCommentBox({text, hasArrows, showArrows, onShowArrowsChange}: {
    text: string; hasArrows: boolean; showArrows: boolean; onShowArrowsChange: (value: boolean) => void;
}) {
    const {t} = useI18n();
    return (
        <section aria-label={t('viewer.coachTitle')} data-testid="coach-comment"
                 className="text-xs bg-black/35 border border-amber-800/50 rounded px-2.5 py-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-amber-300 flex items-center gap-1.5">
                    <GraduationCap size={14} className="text-amber-400"/> {t('viewer.coachTitle')}
                </span>
                {hasArrows && (
                    <label className="flex items-center gap-1 text-boxwood/75 cursor-pointer select-none" title={t('viewer.coachLegend')}>
                        <input type="checkbox" checked={showArrows} className="accent-amber-600"
                               onChange={(e) => onShowArrowsChange(e.target.checked)}/>
                        {t('viewer.coachArrows')}
                    </label>
                )}
            </div>
            <p className="text-boxwood-light leading-snug">{text}</p>
        </section>
    );
}
