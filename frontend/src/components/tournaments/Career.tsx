// --- FILE: frontend/src/components/tournaments/Career.tsx ---
// Карьера турниров (таск 15.4): лестница готовых турниров нарастающей силы. Основной турнир открывается местом в
// верхней половине предыдущего, скрытые приглашения («???») — местом в тройке в своём турнире.

import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Lock, Medal, Star} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getCareer, startCareerStage} from '../../services/tournaments';
import type {CareerStage} from '../../services/tournaments';
import {ladderOpponentName} from '../../config/players';

const MEDALS = ['', 'text-yellow-400', 'text-slate-300', 'text-amber-600'];

export function Career() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [stages, setStages] = useState<CareerStage[]>([]);
    const [error, setError] = useState<UiMessage | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        getCareer().then((r) => setStages(r.stages)).catch(() => undefined);
    }, []);

    const start = async (key: string) => {
        setBusy(key);
        setError(null);
        try {
            const created = await startCareerStage(key);
            navigate(`/tournaments/${created.id}`);
        } catch (err) {
            setError(errorMessage(err, 'tournaments.createFailed'));
        } finally {
            setBusy(null);
        }
    };

    if (stages.length === 0) return null;
    const passed = stages.filter((s) => s.best_place !== null).length;

    const title = (s: CareerStage) => s.hidden
        ? t('career.hidden')
        : t(s.invitational ? 'career.invitational' : 'career.stage', {n: s.number});

    return (
        <section className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark flex flex-col gap-3" data-testid="career">
            <div>
                <h2 className="text-lg font-bold text-amber-200">{t('career.title')}</h2>
                <p className="text-sm text-boxwood/80">{t('career.intro')}</p>
                <p className="text-xs text-boxwood/70 mt-1" data-testid="career-progress">{t('career.progress', {done: passed, total: stages.length})}</p>
            </div>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <ol className="grid sm:grid-cols-2 gap-2">
                {stages.map((s) => (
                    <li key={s.key} data-testid={`career-${s.key}`}
                        className={`rounded px-3 py-2 border flex flex-col gap-1 ${s.invitational ? 'border-amber-500/70 bg-amber-950/40' : 'border-amber-900/50 bg-black/30'} ${s.unlocked ? '' : 'opacity-60'}`}>
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-bold flex items-center gap-1.5">
                                {s.invitational && <Star size={14} className="text-amber-400"/>}
                                {title(s)}
                            </span>
                            {s.best_place !== null
                                ? <span className="text-xs flex items-center gap-1"><Medal size={14} className={MEDALS[s.best_place] ?? ''}/>{t('career.bestPlace', {place: s.best_place})}</span>
                                : !s.unlocked && <Lock size={14} aria-label={t('career.locked')}/>}
                        </div>
                        {!s.hidden && s.format && (
                            <span className="text-xs text-boxwood/75">
                                {t(`tournaments.formats.${s.format}`)} · {s.size} · {Math.round((s.base_time_ms ?? 0) / 60000)}+{Math.round((s.increment_ms ?? 0) / 1000)} · ≈{s.target}
                            </span>
                        )}
                        {!s.hidden && s.opponents && (
                            <span className="text-xs text-boxwood/60">
                                {s.opponents.map((o) => ladderOpponentName(o.kind === 'bot' ? 'historical' : 'archetype', String(o.id), t)).join(', ')}
                            </span>
                        )}
                        {s.hidden && <span className="text-xs text-boxwood/60">{t('career.hiddenHint')}</span>}
                        {s.unlocked && (
                            <button type="button" onClick={() => void start(s.key)} disabled={busy !== null}
                                    data-testid={`career-start-${s.key}`}
                                    className="self-start mt-1 px-3 py-1 rounded bg-amber-700 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50">
                                {t(s.best_place !== null ? 'career.replay' : 'career.play')}
                            </button>
                        )}
                    </li>
                ))}
            </ol>
        </section>
    );
}
