// Ежедневная разминка (таск 22.2): /workout — 5 задач по слабым темам, тренажёр, повторение дебютов и «ваша ошибка».
// Шаги засчитывает сервер по самим тренировкам за сегодня; страница показывает план, отметки и серию дней.

import {useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {CheckCircle2, Circle, Flame, Sunrise} from 'lucide-react';
import {hasMessage, renderUiMessage, useI18n} from '../i18n';
import type {UiMessage} from '../i18n';
import {API_BASE_URL} from '../config/api';
import {getToken} from '../services/authToken';
import {errorMessage, readApiErrorOr, UiError} from '../services/apiErrors';

export type WorkoutStep =
    | { kind: 'puzzles'; themes: string[]; target: number; done: number }
    | { kind: 'trainer'; trainer: string; done: boolean }
    | { kind: 'repertoire'; due: number; repertoire_id: number | null; done: boolean }
    | { kind: 'mistake'; due: number; done: boolean };

export interface WorkoutPlan {
    date: string;
    complete: boolean;
    streak: number;
    steps: WorkoutStep[];
}

async function fetchPlan(): Promise<WorkoutPlan> {
    const token = getToken();
    const res = await fetch(`${API_BASE_URL}/api/v1/workout`, {headers: token ? {Authorization: `Bearer ${token}`} : {}});
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<WorkoutPlan>;
}

const stepDone = (step: WorkoutStep) => (step.kind === 'puzzles' ? step.done >= step.target : step.done);

export function WorkoutPage() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const logged = Boolean(getToken());
    const [plan, setPlan] = useState<WorkoutPlan | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        if (!logged) return;
        fetchPlan().then(setPlan).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [logged]);

    const themeName = (code: string) => {
        const key = `themes.${code}.name`;
        return hasMessage(key) ? t(key) : code;
    };
    const trainerName = (id: string) => {
        const key = `trainers.${id}.title`;
        return hasMessage(key) ? t(key) : id;
    };

    return (
        <div className="w-full max-w-3xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="workout-page">
            <header className="flex items-center gap-2">
                <Sunrise className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('workout.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('workout.intro')}</p>
            {!logged && <p className="text-amber-300" data-testid="workout-login">{t('workout.loginRequired')}</p>}
            {error && <p role="alert" className="text-rose-300">{renderUiMessage(error, t)}</p>}
            {plan && (
                <>
                    <div className="flex flex-wrap items-center gap-3 bg-black/30 rounded-lg p-3" data-testid="workout-status">
                        <span className="flex items-center gap-1 font-bold text-amber-300"><Flame size={18}/> {t('workout.streak', {n: plan.streak})}</span>
                        <span className={plan.complete ? 'text-emerald-300 font-bold' : 'text-boxwood/80'}>
                            {t(plan.complete ? 'workout.complete' : 'workout.notYet')}
                        </span>
                    </div>
                    <ol className="flex flex-col gap-2">
                        {plan.steps.map((step) => (
                            <li key={step.kind} data-testid={`workout-${step.kind}`}
                                className="bg-acacia rounded-lg border-2 border-acacia-dark p-3 flex gap-3 items-start">
                                {stepDone(step)
                                    ? <CheckCircle2 className="text-emerald-400 shrink-0" size={20}/>
                                    : <Circle className="text-amber-700 shrink-0" size={20}/>}
                                <div className="flex-1 min-w-0 flex flex-col gap-1.5 text-sm">
                                    {step.kind === 'puzzles' && (
                                        <>
                                            <span className="font-bold text-amber-200">{t('workout.puzzles', {done: step.done, target: step.target})}</span>
                                            <div className="flex flex-wrap gap-1.5">
                                                {step.themes.map((theme) => (
                                                    <button key={theme} type="button" data-testid={`workout-theme-${theme}`}
                                                            onClick={() => navigate('/puzzles', {state: {train: {theme, blind: false}}})}
                                                            className="px-2 py-1 rounded bg-amber-700 text-white text-xs font-bold">
                                                        {themeName(theme)}
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    {step.kind === 'trainer' && (
                                        <>
                                            <span className="font-bold text-amber-200">{t('workout.trainer')}</span>
                                            <Link to={`/train/${step.trainer}`} className="self-start px-2 py-1 rounded bg-amber-700 text-white text-xs font-bold">
                                                {trainerName(step.trainer)}
                                            </Link>
                                        </>
                                    )}
                                    {step.kind === 'repertoire' && (
                                        <>
                                            <span className="font-bold text-amber-200">{t('workout.repertoire')}</span>
                                            {step.repertoire_id
                                                ? <Link to={`/repertoire/${step.repertoire_id}/drill`} className="self-start px-2 py-1 rounded bg-amber-700 text-white text-xs font-bold">
                                                    {t('workout.repertoireDue', {n: step.due})}
                                                </Link>
                                                : <span className="text-boxwood/70">{t('workout.repertoireNothing')}</span>}
                                        </>
                                    )}
                                    {step.kind === 'mistake' && (
                                        <>
                                            <span className="font-bold text-amber-200">{t('workout.mistake')}</span>
                                            {step.due > 0
                                                ? <button type="button" onClick={() => navigate('/puzzles', {state: {mode: 'personal'}})}
                                                          className="self-start px-2 py-1 rounded bg-amber-700 text-white text-xs font-bold">
                                                    {t('workout.mistakeDue', {n: step.due})}
                                                </button>
                                                : <span className="text-boxwood/70">{t('workout.mistakeNothing')}</span>}
                                        </>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                </>
            )}
        </div>
    );
}
