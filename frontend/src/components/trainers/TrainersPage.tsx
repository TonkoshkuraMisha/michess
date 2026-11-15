// --- FILE: frontend/src/components/trainers/TrainersPage.tsx ---
// Тренажёры (таск 19.1): /train — все тренажёры с личными рекордами; /train/:trainerId — выбор уровня, попытка,
// результат (очки, время, ошибки, рекорд) и график последних попыток.

import {useEffect, useRef, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {ArrowLeft, Dumbbell, Trophy} from 'lucide-react';
import {useI18n} from '../../i18n';
import {getToken} from '../../services/authToken';
import {TRAINER_IDS, trainersApi} from '../../services/trainers';
import type {TrainerId, TrainerRecord} from '../../services/trainers';
import {ForkGame, PathGame, TailGame} from './VisionGames';
import {CoordOptionsPicker, CoordinateGame} from './CoordinateGames';
import {RecallGame, RestoreGame} from './MemoryGames';
import {COORD_TRAINERS, levelToOptions, optionsToLevel} from '../../trainers/coordinates';
import type {CoordTrainer} from '../../trainers/coordinates';

const LEVELS = 10;

function useRecords(): Partial<Record<TrainerId, TrainerRecord>> {
    const [records, setRecords] = useState<Partial<Record<TrainerId, TrainerRecord>>>({});
    useEffect(() => {
        if (getToken()) trainersApi.records().then((r) => setRecords(r.records)).catch(() => undefined);
    }, []);
    return records;
}

export function TrainersPage() {
    const {t} = useI18n();
    const records = useRecords();
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="trainers-page">
            <header className="flex items-center gap-2">
                <Dumbbell className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('trainers.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('trainers.intro')}</p>
            {!getToken() && <p className="text-sm text-amber-300">{t('trainers.loginToSave')}</p>}
            <div className="grid sm:grid-cols-2 gap-3">
                {TRAINER_IDS.map((id) => (
                    <Link key={id} to={`/train/${id}`} data-testid={`trainer-${id}`}
                          className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark hover:border-amber-500 flex flex-col gap-1">
                        <span className="font-bold text-amber-200">{t(`trainers.${id}.title`)}</span>
                        <span className="text-sm text-boxwood/80">{t(`trainers.${id}.rules`)}</span>
                        {records[id] && (
                            <span className="text-xs text-amber-300 flex items-center gap-1">
                                <Trophy size={12}/> {t('trainers.recordLine', {best: records[id]!.best, level: records[id]!.max_level})}
                            </span>
                        )}
                    </Link>
                ))}
            </div>
        </div>
    );
}

function Sparkline({values}: { values: number[] }) {
    if (values.length < 2) return null;
    const max = Math.max(...values, 1);
    const points = values.map((v, i) => `${(i / (values.length - 1)) * 200},${40 - (v / max) * 36}`).join(' ');
    return (
        <svg viewBox="0 0 200 42" className="w-full max-w-xs h-12" role="img" data-testid="trainer-chart">
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400"/>
        </svg>
    );
}

type Outcome = { score: number; mistakes: number; timeMs: number; record: boolean | null };

export function TrainerPage() {
    const {t} = useI18n();
    const {trainerId = ''} = useParams<{ trainerId: string }>();
    const id = (TRAINER_IDS as readonly string[]).includes(trainerId) ? trainerId as TrainerId : null;
    const [level, setLevel] = useState(1);
    const [seed, setSeed] = useState<number | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [history, setHistory] = useState<number[]>([]);
    const startedAt = useRef(0);

    useEffect(() => {
        if (id && getToken()) trainersApi.history(id).then((r) => setHistory(r.results.map((x) => x.score))).catch(() => undefined);
    }, [id]);

    if (!id) return <p className="p-4 text-rose-300">{t('trainers.notFound')}</p>;
    const isCoord = (COORD_TRAINERS as readonly string[]).includes(id);

    const start = () => {
        setOutcome(null);
        startedAt.current = Date.now();
        setSeed(Date.now() % 1_000_000);
    };

    const finish = (score: number, mistakes: number) => {
        const timeMs = Date.now() - startedAt.current;
        setSeed(null);
        setOutcome({score, mistakes, timeMs, record: null});
        if (!getToken()) return;
        trainersApi.save({trainer: id, level, score, time_ms: timeMs, mistakes})
            .then((r) => {
                setOutcome({score, mistakes, timeMs, record: r.record});
                setHistory((h) => [...h, score].slice(-50));
            })
            .catch(() => undefined);
    };

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="trainer-page">
            <Link to="/train" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('trainers.title')}</Link>
            <div>
                <h1 className="text-2xl font-bold text-amber-200">{t(`trainers.${id}.title`)}</h1>
                <p className="text-boxwood/85">{t(`trainers.${id}.rules`)}</p>
            </div>
            {seed === null && (
                <div className="flex flex-wrap items-center gap-3">
                    {isCoord ? (
                        <CoordOptionsPicker value={levelToOptions(level)} onChange={(o) => setLevel(optionsToLevel(o))}/>
                    ) : (
                    <label className="flex items-center gap-2 text-sm">
                        {t('trainers.level')}
                        <select value={level} onChange={(e) => setLevel(Number(e.target.value))} data-testid="trainer-level"
                                className="bg-black/40 rounded px-2 py-1">
                            {Array.from({length: LEVELS}, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </label>
                    )}
                    <button type="button" onClick={start} data-testid="trainer-start"
                            className="px-4 py-2 rounded bg-amber-700 text-white font-bold">
                        {t(outcome ? 'trainers.again' : 'trainers.start')}
                    </button>
                </div>
            )}
            {outcome && (
                <div className="bg-black/40 rounded p-3 flex flex-wrap items-center gap-4" data-testid="trainer-result">
                    <span className="text-2xl font-bold text-amber-300">{outcome.score}</span>
                    <span className="text-sm">{t('trainers.resultLine', {seconds: Math.round(outcome.timeMs / 1000), mistakes: outcome.mistakes})}</span>
                    {outcome.record && <span className="text-emerald-300 flex items-center gap-1"><Trophy size={14}/> {t('trainers.newRecord')}</span>}
                </div>
            )}
            {seed !== null && id === 'double_strike' && <ForkGame level={level} seed={seed} onFinish={finish}/>}
            {seed !== null && id === 'tail' && <TailGame level={level} seed={seed} onFinish={finish}/>}
            {seed !== null && isCoord && <CoordinateGame trainer={id as CoordTrainer} level={level} seed={seed} onFinish={finish}/>}
            {seed !== null && id === 'memory_position' && <RestoreGame level={level} seed={seed} onFinish={finish}/>}
            {seed !== null && id === 'memory_game' && <RecallGame level={level} seed={seed} onFinish={finish}/>}
            {seed !== null && (id === 'quiet_path' || id === 'knight_route') && (
                <PathGame kind={id === 'knight_route' ? 'knight' : 'quiet'} level={level} seed={seed} onFinish={finish}/>
            )}
            {history.length > 1 && (
                <section className="flex flex-col gap-1">
                    <h2 className="text-sm text-boxwood/75">{t('trainers.history')}</h2>
                    <Sparkline values={history}/>
                </section>
            )}
        </div>
    );
}
