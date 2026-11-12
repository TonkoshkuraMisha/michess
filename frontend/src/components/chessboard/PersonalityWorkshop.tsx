// --- FILE: frontend/src/components/chessboard/PersonalityWorkshop.tsx ---

import {useCallback, useEffect, useState} from 'react';
import {PolarAngleAxis, PolarGrid, Radar, RadarChart} from 'recharts';
import {Pencil, Save, Trash2} from 'lucide-react';
import {strengthNote, styleRadar} from '../../config/archetypes';
import type {CustomOpponent} from '../../config/archetypes';
import {
    DEFAULT_CONFIG,
    createPersonality,
    deleteGuestPersonality,
    deletePersonality,
    listPersonalities,
    readGuestPersonalities,
    saveGuestPersonality,
    updatePersonality,
} from '../../services/personalities';
import type {Personality, PersonalityConfig} from '../../services/personalities';
import {fetchBotCatalog, strengthLabel} from '../../services/botCatalog';
import type {CatalogArchetype} from '../../services/botCatalog';
import {useI18n} from '../../i18n';
import {t as translate} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {renderUiMessage, uiMessage} from '../../i18n';
import type {UiMessage} from '../../i18n';

type SliderKey = 'aggression' | 'center_control' | 'mobility' | 'king_safety' | 'pawn_structure'
    | 'randomness' | 'blunder_guard_cp' | 'target_elo';

interface SliderSpec {
    key: SliderKey;
    readonly label: string;
    min: number;
    max: number;
    step: number;
    readonly hint: string;
}

/** Ползунки с подписью «что это меняет». Границы — как в BotPersonalityConfig на сервере. */
function slider(key: SliderKey, min: number, max: number, step: number): SliderSpec {
    return {
        key,
        min,
        max,
        step,
        get label() {
            return translate(`workshop.sliders.${key}.label`);
        },
        get hint() {
            return translate(`workshop.sliders.${key}.hint`);
        },
    };
}

export const SLIDERS: SliderSpec[] = [
    slider('aggression', -100, 100, 5),
    slider('center_control', 0, 200, 10),
    slider('mobility', 0, 200, 10),
    slider('king_safety', 0, 200, 10),
    slider('pawn_structure', 0, 200, 10),
    slider('randomness', 0, 100, 5),
    slider('blunder_guard_cp', 0, 400, 10),
    slider('target_elo', 600, 2800, 50),
];

export interface PersonalityWorkshopProps {
    /** Токен вошедшего игрока: персоналии на сервере; без него — в этом браузере. */
    token: string | null;
    playDisabled: boolean;
    onPlay: (opponent: CustomOpponent, colorPref: 'white' | 'black' | 'random') => void;
    canStartFromPosition: boolean;
    startFromPosition: boolean;
    onStartFromPositionChange: (value: boolean) => void;
}

interface Draft {
    name: string;
    config: PersonalityConfig;
    bio?: string;
    /** id сохранённой персоналии, которую редактируем (null — новая). */
    savedId: number | string | null;
}

const emptyDraft = (): Draft => ({name: '', config: {...DEFAULT_CONFIG}, savedId: null});

/**
 * Мастерская соперников: «Мои соперники» (сервер или браузер гостя), готовые архетипы и
 * конструктор — ползунки с подсказками, радар стиля, оценка силы, сохранение и игра.
 */
export function PersonalityWorkshop({
    token, playDisabled, onPlay, canStartFromPosition, startFromPosition, onStartFromPositionChange,
}: PersonalityWorkshopProps) {
    const {t} = useI18n();
    const [mine, setMine] = useState<Personality[]>([]);
    const [draft, setDraft] = useState<Draft>(emptyDraft);
    const [error, setError] = useState<UiMessage | null>(null);
    const [notice, setNotice] = useState<'workshop.savedProfile' | 'workshop.savedBrowser' | null>(null);
    const [busy, setBusy] = useState(false);
    const [archetypes, setArchetypes] = useState<CatalogArchetype[]>([]);

    useEffect(() => {
        let alive = true;
        fetchBotCatalog()
            .then((catalog) => alive && setArchetypes(catalog.archetypes))
            .catch(() => alive && setArchetypes([]));
        return () => {
            alive = false;
        };
    }, []);

    const reload = useCallback(async () => {
        setError(null);
        try {
            setMine(token ? await listPersonalities(token) : readGuestPersonalities());
        } catch (err) {
            setError(errorMessage(err, 'workshop.loadFailed'));
        }
    }, [token]);

    useEffect(() => {
        reload();
    }, [reload]);

    // Без мемоизации: подписи осей зависят от языка, а расчёт копеечный.
    const radar = styleRadar(draft.config);

    const setValue = (key: SliderKey, value: number) =>
        setDraft((d) => ({...d, config: {...d.config, [key]: value}}));

    const pick = (name: string, config: PersonalityConfig, savedId: Draft['savedId'], bio?: string) => {
        setDraft({name, config: {...config, piece_values: {...config.piece_values}}, savedId, bio});
        setError(null);
        setNotice(null);
    };

    const save = async () => {
        const name = draft.name.trim();
        if (!name) {
            setError(uiMessage('workshop.nameRequired'));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            let saved: Personality;
            if (token) {
                saved = typeof draft.savedId === 'number'
                    ? await updatePersonality(token, draft.savedId, {name, config: draft.config})
                    : await createPersonality(token, {name, config: draft.config});
            } else {
                saved = saveGuestPersonality(
                    {name, config: draft.config},
                    typeof draft.savedId === 'string' ? draft.savedId : undefined,
                );
            }
            setDraft((d) => ({...d, name: saved.name, savedId: saved.id}));
            setNotice(token ? 'workshop.savedProfile' : 'workshop.savedBrowser');
            await reload();
        } catch (err) {
            setError(errorMessage(err, 'workshop.saveFailed'));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (p: Personality) => {
        if (!window.confirm(t('workshop.deleteConfirm', {name: p.name}))) return;
        try {
            if (token && typeof p.id === 'number') await deletePersonality(token, p.id);
            else deleteGuestPersonality(String(p.id));
            if (draft.savedId === p.id) setDraft(emptyDraft());
            await reload();
        } catch (err) {
            setError(errorMessage(err, 'workshop.deleteFailed'));
        }
    };

    const play = (colorPref: 'white' | 'black' | 'random') => {
        const name = draft.name.trim() || t('workshop.defaultName');
        const savedOnServer = token && typeof draft.savedId === 'number';
        onPlay({
            name,
            config: draft.config,
            bio: draft.bio,
            // Сохранённый на сервере соперник играет по своему id — но только если конфиг не меняли.
            personalityId: savedOnServer && isUnchanged(mine, draft) ? (draft.savedId as number) : undefined,
        }, colorPref);
    };

    return (
        <div className="flex flex-col gap-2 text-xs text-boxwood" data-testid="personality-workshop">
            <section>
                <h3 className="font-bold text-amber-300 mb-1">{t('workshop.myOpponents')}</h3>
                {mine.length === 0 ? (
                    <p className="text-boxwood/70">{t('workshop.noOpponents')}</p>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {mine.map((p) => (
                            <li key={p.id} className="flex items-center gap-1.5 bg-black/35 rounded px-2 py-1 border border-amber-900/40">
                                <span className="font-bold truncate flex-1">{p.name}</span>
                                <span className="font-mono text-amber-300/90">~{p.config.target_elo}</span>
                                <button type="button" title={t('workshop.edit', {name: p.name})} aria-label={t('workshop.edit', {name: p.name})}
                                        onClick={() => pick(p.name, p.config, p.id)}
                                        className="p-1 rounded hover:bg-amber-900/50 cursor-pointer">
                                    <Pencil size={12}/>
                                </button>
                                <button type="button" title={t('workshop.delete', {name: p.name})} aria-label={t('workshop.delete', {name: p.name})}
                                        onClick={() => remove(p)}
                                        className="p-1 rounded hover:bg-red-900/50 cursor-pointer">
                                    <Trash2 size={12}/>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <h3 className="font-bold text-amber-300 mb-1">{t('workshop.archetypes')}</h3>
                {archetypes.length === 0 && <p className="text-boxwood/70">{t('workshop.archetypesLoading')}</p>}
                <div className="flex flex-wrap gap-1">
                    {archetypes.map((a) => (
                        <button key={a.name} type="button" title={a.bio}
                                onClick={() => pick(a.name, a.config, null, a.bio)}
                                className={`px-2 py-0.5 rounded border cursor-pointer ${
                                    draft.name === a.name && draft.savedId === null
                                        ? 'bg-amber-800 border-amber-400 text-white'
                                        : 'bg-black/35 border-amber-900/40 hover:border-amber-600/60'
                                }`}>
                            {a.name} <span className="font-mono text-amber-300/80">{strengthLabel(a)}</span>
                        </button>
                    ))}
                </div>
            </section>

            <section className="flex flex-col gap-1.5 p-2 rounded-md bg-black/40 border border-amber-800/50">
                <label className="flex flex-col gap-0.5">
                    <span className="text-amber-200 font-semibold">{t('workshop.opponentName')}</span>
                    <input value={draft.name} maxLength={30}
                           onChange={(e) => setDraft((d) => ({...d, name: e.target.value}))}
                           placeholder={t('workshop.namePlaceholder')}
                           className="px-2 py-1 rounded bg-black/50 border border-amber-800/60 text-boxwood-light"/>
                </label>
                {draft.bio && <p className="italic text-boxwood/80">{draft.bio}</p>}

                <div className="flex justify-center" aria-label={t('workshop.radar.label')}>
                    <RadarChart width={220} height={150} data={radar} outerRadius={50}>
                        <PolarGrid stroke="#78350f"/>
                        <PolarAngleAxis dataKey="axis" tick={{fill: '#e7c38b', fontSize: 10}}/>
                        <Radar dataKey="value" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.35}
                               isAnimationActive={false}/>
                    </RadarChart>
                </div>

                {SLIDERS.map((s) => (
                    <label key={s.key} className="flex flex-col" title={s.hint}>
                        <span className="flex justify-between">
                            <span>{s.label}</span>
                            <span className="font-mono text-amber-300">{draft.config[s.key]}</span>
                        </span>
                        <input type="range" min={s.min} max={s.max} step={s.step} aria-label={s.label}
                               value={draft.config[s.key]}
                               onChange={(e) => setValue(s.key, Number(e.target.value))}
                               className="accent-amber-600"/>
                        <span className="text-[10px] text-boxwood/60 leading-tight">{s.hint}</span>
                    </label>
                ))}

                <p className="text-amber-200/90" data-testid="strength-note">{strengthNote(draft.config)}</p>
                <p className="text-[10px] text-boxwood/60 leading-tight">
                    {t('workshop.engineNote')}
                </p>

                {error && <p role="alert" className="text-red-300">{renderUiMessage(error, t)}</p>}
                {notice && !error && <p className="text-emerald-300">{t(notice)}</p>}

                <button type="button" onClick={save} disabled={busy}
                        className="flex items-center justify-center gap-1 py-1 rounded bg-amber-900/70 border border-amber-600/50 hover:bg-amber-800 disabled:opacity-40 cursor-pointer">
                    <Save size={12}/> {t('workshop.save')}
                </button>

                {canStartFromPosition && (
                    <label className="flex items-center gap-2 text-amber-200 cursor-pointer select-none">
                        <input type="checkbox" checked={startFromPosition}
                               onChange={(e) => onStartFromPositionChange(e.target.checked)}
                               className="accent-amber-600"/>
                        {t('common.startFromPosition')}
                    </label>
                )}

                <div className="grid grid-cols-3 gap-1.5">
                    <button type="button" disabled={playDisabled} onClick={() => play('white')}
                            className="py-1.5 font-bold rounded-md bg-boxwood text-acacia-dark hover:bg-boxwood-light disabled:opacity-40 cursor-pointer">
                        {t('common.playAsWhite')}
                    </button>
                    <button type="button" disabled={playDisabled} onClick={() => play('random')}
                            className="py-1.5 font-bold rounded-md bg-amber-700 text-white hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
                        {t('common.playRandom')}
                    </button>
                    <button type="button" disabled={playDisabled} onClick={() => play('black')}
                            className="py-1.5 font-bold rounded-md bg-black/70 text-amber-200 border border-amber-700/60 hover:bg-black disabled:opacity-40 cursor-pointer">
                        {t('common.playAsBlack')}
                    </button>
                </div>
            </section>
        </div>
    );
}

function isUnchanged(mine: Personality[], draft: Draft): boolean {
    const saved = mine.find((p) => p.id === draft.savedId);
    return !!saved && saved.name === draft.name.trim() && JSON.stringify(saved.config) === JSON.stringify(draft.config);
}
