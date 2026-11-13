// --- FILE: frontend/src/components/chessboard/CoachPanel.tsx ---
// Панель игры с наставником (таск 11.3): включение, уровень, «Совет», предупреждение о плохом ходе
// («Почему?», «Переходить», «Оставить»), объяснение и совет текстом.

import {GraduationCap} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import {coachText} from '../../services/coach';
import {COACH_LEVELS} from './hooks/useCoachMode';
import type {CoachLevel, UseCoachModeResult} from './hooks/useCoachMode';

interface Props {
    coach: UseCoachModeResult;
    /** Партия лестницы: наставник недоступен (партия не была бы засчитана). */
    locked: boolean;
    /** Партия с ботом идёт (не завершена) — показываем отметку «учебная». */
    inBotGame: boolean;
    canAdvise: boolean;
    onAdvice: () => void;
    onTakeBack: () => void;
}

const VERDICT_KEYS: Record<string, 'coachMode.verdictBlunder' | 'coachMode.verdictMistake' | 'coachMode.verdictInaccuracy'> = {
    Blunder: 'coachMode.verdictBlunder',
    Mistake: 'coachMode.verdictMistake',
    Inaccuracy: 'coachMode.verdictInaccuracy',
};

export function CoachPanel({coach, locked, inBotGame, canAdvise, onAdvice, onTakeBack}: Props) {
    const {t} = useI18n();
    const warning = coach.pending?.status === 'warning' ? coach.pending.check : undefined;
    const shownText = coachText(coach.explanation ?? coach.advice, t);

    return (
        <section aria-label={t('coachMode.title')} data-testid="coach-panel"
                 className="bg-acacia-dark p-2.5 rounded-md border border-amber-700/40 text-xs text-boxwood-light flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 font-bold text-amber-400 cursor-pointer">
                    <GraduationCap size={14}/>
                    <input type="checkbox" className="accent-amber-600" data-testid="coach-toggle"
                           checked={coach.enabled && !locked} disabled={locked}
                           onChange={(e) => coach.setEnabled(e.target.checked)}/>
                    {t('coachMode.title')}
                </label>
                {coach.enabled && !locked && (
                    <select aria-label={t('coachMode.levelLabel')} value={coach.level} data-testid="coach-level"
                            onChange={(e) => coach.setLevel(e.target.value as CoachLevel)}
                            className="bg-black/40 border border-amber-900/50 rounded px-1 py-0.5 text-boxwood-light">
                        {COACH_LEVELS.map((level) => (
                            <option key={level} value={level}>{t(`coachMode.levels.${level}`)}</option>
                        ))}
                    </select>
                )}
            </div>

            {locked && <p className="text-boxwood/70">{t('coachMode.lockedLadder')}</p>}
            {!locked && !coach.enabled && <p className="text-boxwood/70">{t('coachMode.hint')}</p>}

            {coach.enabled && !locked && (
                <>
                    <div className="flex items-center justify-between gap-2">
                        <button type="button" onClick={onAdvice} disabled={!canAdvise || coach.adviceLoading}
                                data-testid="coach-advice"
                                className="px-2 py-1 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                            {coach.adviceLoading ? t('coachMode.thinking') : t('coachMode.advice')}
                        </button>
                        <span className="text-boxwood/70" data-testid="coach-hints-used">
                            {t('coachMode.hintsUsed', {count: coach.hintsUsed})}
                        </span>
                    </div>
                    {inBotGame && coach.assisted && (
                        <p className="text-amber-300/80" data-testid="coach-assisted">{t('coachMode.assistedGame')}</p>
                    )}
                    {coach.pending?.status === 'checking' && (
                        <p className="animate-pulse text-amber-300" data-testid="coach-checking">{t('coachMode.checking')}</p>
                    )}
                </>
            )}

            {warning && (
                <div role="alert" data-testid="coach-warning"
                     className="p-2 rounded bg-rose-950/60 border border-rose-500/50 flex flex-col gap-1.5">
                    <p className="font-bold text-rose-200">
                        {warning.classification && VERDICT_KEYS[warning.classification]
                            ? t(VERDICT_KEYS[warning.classification])
                            : t('coachMode.verdictMissed')}
                        {warning.missed_tactic && warning.classification !== 'Blunder' && ` ${t('coachMode.missedTactic')}`}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={coach.showWhy} data-testid="coach-why"
                                className="px-2 py-0.5 rounded bg-black/40 border border-amber-700/50 hover:border-amber-500 cursor-pointer">
                            {t('coachMode.why')}
                        </button>
                        <button type="button" onClick={onTakeBack} data-testid="coach-takeback"
                                className="px-2 py-0.5 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold cursor-pointer">
                            {t('coachMode.takeBack')}
                        </button>
                        <button type="button" onClick={coach.keepMove} data-testid="coach-keep"
                                className="px-2 py-0.5 rounded bg-black/40 border border-amber-700/50 hover:border-amber-500 cursor-pointer">
                            {t('coachMode.keep')}
                        </button>
                    </div>
                </div>
            )}

            {shownText && (
                <p className="leading-snug" data-testid="coach-text">{shownText}</p>
            )}
            {(coach.explanation || coach.advice) && (
                <p className="text-[10px] text-boxwood/60">{t('coachMode.legend')}</p>
            )}
            {coach.error && <p className="text-rose-300" role="status">{renderUiMessage(coach.error, t)}</p>}
        </section>
    );
}
