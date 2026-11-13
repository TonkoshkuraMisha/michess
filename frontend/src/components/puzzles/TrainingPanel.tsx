// --- FILE: frontend/src/components/puzzles/TrainingPanel.tsx ---
// Тренировка по приёмам (таск 13.4): темы по разделам каталога с прогрессом, карточка темы (объяснение тренера и
// показ на доске), «Тренировать», смешанные подборки по разделу и режим «без названия темы».

import {useEffect, useMemo, useState} from 'react';
import {Chess} from 'chess.js';
import {BookOpen, CheckCircle2, Dumbbell, Shuffle} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {UiError} from '../../services/apiErrors';
import {DEFENSE_DRILL_THEMES, THEME_DRILLS, puzzlesApi} from '../../services/puzzles';
import type {DrillKind} from '../../services/puzzles';
import type {DemoExample, ThemeOverview, TrainingOverview, TrainingTarget} from '../../services/puzzles';
import {themeText} from '../../services/themes';
import type {ThemeSection} from '../../services/themes';
import {PuzzleBoard} from './PuzzleBoard';

interface Props {
    onTrain: (target: TrainingTarget) => void;
    /** Упражнение-генератор по теме (таск 13.7): вилка, связка, незащищённая фигура, мат. */
    onDrill?: (kind: DrillKind) => void;
    /** Новые данные прогресса после решённой задачи — список обновляется. */
    refreshKey: number;
}

function cleanCount(recent: string): number {
    return recent.split('').filter((c) => c === '1').length;
}

/** Показ приёма: задачи темы с решением, ход за ходом. */
export function DemoViewer({examples}: { examples: DemoExample[] }) {
    const {t} = useI18n();
    const [index, setIndex] = useState(0);
    const [ply, setPly] = useState(0);
    const example = examples[index];
    const position = useMemo(() => {
        const game = new Chess(example.fen);
        let last: { from: string; to: string } | null = null;
        for (const uci of example.moves.slice(0, ply)) {
            const move = game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
            last = {from: move.from, to: move.to};
        }
        return {fen: game.fen(), last};
    }, [example, ply]);
    const caption = ply === 0
        ? t('puzzles.training.demoStart')
        : t(ply % 2 === 1 ? 'puzzles.training.demoOpponent' : 'puzzles.training.demoSolution');
    return (
        <div className="flex flex-col gap-1.5" data-testid="demo-viewer">
            <div className="max-w-[360px] w-full">
                <PuzzleBoard fen={position.fen} orientation={example.color} interactive={false}
                             lastMove={position.last} sound={false} onMove={() => undefined}/>
            </div>
            <p className="text-xs" data-testid="demo-caption">
                {caption} · {t('puzzles.training.demoStep', {n: ply, total: example.moves.length})}
            </p>
            <div className="flex flex-wrap gap-1.5">
                <button type="button" disabled={ply === 0} onClick={() => setPly(ply - 1)} data-testid="demo-prev"
                        className="px-2 py-0.5 rounded bg-black/40 border border-amber-900/50 disabled:opacity-40 cursor-pointer">
                    {t('puzzles.training.demoPrev')}
                </button>
                <button type="button" disabled={ply >= example.moves.length} onClick={() => setPly(ply + 1)}
                        data-testid="demo-next"
                        className="px-2 py-0.5 rounded bg-amber-800 text-white font-bold disabled:opacity-40 cursor-pointer">
                    {t('puzzles.training.demoNext')}
                </button>
                {examples.length > 1 && (
                    <button type="button" data-testid="demo-other"
                            onClick={() => {
                                setIndex((index + 1) % examples.length);
                                setPly(0);
                            }}
                            className="px-2 py-0.5 rounded bg-black/40 border border-amber-900/50 cursor-pointer">
                        {t('puzzles.training.demoOther', {n: ((index + 1) % examples.length) + 1, total: examples.length})}
                    </button>
                )}
            </div>
        </div>
    );
}

function StageBadge({theme, overview}: { theme: ThemeOverview; overview: TrainingOverview }) {
    const {t} = useI18n();
    if (theme.mastered) {
        return <span className="text-emerald-400 flex items-center gap-0.5"><CheckCircle2 size={12}/>{t('puzzles.training.mastered')}</span>;
    }
    return (
        <span className="text-boxwood/70 font-mono text-[11px]">
            {t('puzzles.training.stageShort', {stage: theme.stage, clean: cleanCount(theme.recent), pass: overview.pass})}
        </span>
    );
}

export function TrainingPanel({onTrain, onDrill, refreshKey}: Props) {
    const {t} = useI18n();
    const [overview, setOverview] = useState<TrainingOverview | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [blind, setBlind] = useState(false);
    const [demo, setDemo] = useState<DemoExample[] | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        puzzlesApi.training().then(setOverview).catch((err) => setError(err instanceof UiError ? err.ui : {key: 'common.networkError'}));
    }, [refreshKey]);

    const sections = useMemo(() => {
        const map = new Map<string, ThemeOverview[]>();
        for (const theme of overview?.themes ?? []) {
            const list = map.get(theme.section) ?? [];
            list.push(theme);
            map.set(theme.section, list);
        }
        return [...map.entries()];
    }, [overview]);

    const current = overview?.themes.find((th) => th.code === selected) ?? null;
    const showDemo = async (code: string) => {
        try {
            setDemo((await puzzlesApi.demo(code)).examples);
        } catch (err) {
            setError(err instanceof UiError ? err.ui : {key: 'common.networkError'});
        }
    };

    if (error) return <p className="text-rose-300" role="alert">{renderUiMessage(error, t)}</p>;
    if (!overview) return <p className="animate-pulse">{t('puzzles.training.loading')}</p>;

    return (
        <div className="flex flex-col gap-2" data-testid="training-panel">
            <label className="flex items-center gap-1.5 cursor-pointer" title={t('puzzles.training.blindHint')}>
                <input type="checkbox" className="accent-amber-600" checked={blind} data-testid="training-blind"
                       onChange={(e) => setBlind(e.target.checked)}/>
                {t('puzzles.training.blind')}
            </label>

            {current && (
                <article className="p-2 rounded bg-black/30 border border-amber-800/50 flex flex-col gap-1.5"
                         data-testid="theme-card">
                    <h3 className="font-bold text-amber-300">{themeText(current.code, 'name', t)}</h3>
                    <p className="leading-snug">{themeText(current.code, 'explain', t)}</p>
                    <p className="text-xs text-boxwood/70">
                        {current.mastered
                            ? t('puzzles.training.masteredLong')
                            : t('puzzles.training.stageLong', {
                                stage: current.stage, name: t(`puzzles.training.stageNames.s${current.stage as 1 | 2 | 3 | 4}`),
                                clean: cleanCount(current.recent), window: overview.window, pass: overview.pass,
                            })}
                    </p>
                    {current.available.every((n) => n === 0) ? (
                        <p className="text-xs text-amber-200/80">{t('puzzles.training.noPuzzles')}</p>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {!DEFENSE_DRILL_THEMES[current.code] && (
                                <button type="button" onClick={() => void showDemo(current.code)} data-testid="theme-demo"
                                        className="flex items-center gap-1 px-2 py-1 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 cursor-pointer">
                                    <BookOpen size={14}/> {t('puzzles.training.demo')}
                                </button>
                            )}
                            <button type="button" onClick={() => onTrain({theme: current.code, blind})}
                                    data-testid="theme-train"
                                    className="flex items-center gap-1 px-2 py-1 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold cursor-pointer">
                                <Dumbbell size={14}/> {t('puzzles.training.train')}
                            </button>
                            {onDrill && THEME_DRILLS[current.code] && (
                                <button type="button" onClick={() => onDrill(THEME_DRILLS[current.code])}
                                        data-testid="theme-drill"
                                        className="flex items-center gap-1 px-2 py-1 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 cursor-pointer">
                                    <Shuffle size={14}/> {t('puzzles.drills.fromTheme')}
                                </button>
                            )}
                        </div>
                    )}
                    {demo && demo.length > 0 && <DemoViewer key={current.code} examples={demo}/>}
                </article>
            )}

            <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto pr-1">
                {sections.map(([section, themes]) => (
                    <section key={section} data-testid={`training-section-${section}`}>
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="font-bold text-amber-400">{t(`puzzles.sections.${section as ThemeSection}`)}</h3>
                            <button type="button" onClick={() => onTrain({section, blind})}
                                    data-testid={`training-mixed-${section}`}
                                    className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-black/40 border border-amber-900/50 hover:border-amber-500 cursor-pointer">
                                <Shuffle size={12}/> {t('puzzles.training.mixed')}
                            </button>
                        </div>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                            {themes.map((theme) => (
                                <li key={theme.code}>
                                    <button type="button" data-testid={`training-theme-${theme.code}`}
                                            onClick={() => {
                                                setSelected(theme.code);
                                                setDemo(null);
                                            }}
                                            className={`w-full text-left flex items-center justify-between gap-2 py-0.5 cursor-pointer hover:text-amber-300 ${
                                                theme.available.every((n) => n === 0) ? 'opacity-50' : ''} ${selected === theme.code ? 'text-amber-300' : ''}`}>
                                        <span className="truncate">{themeText(theme.code, 'name', t)}</span>
                                        <StageBadge theme={theme} overview={overview}/>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
