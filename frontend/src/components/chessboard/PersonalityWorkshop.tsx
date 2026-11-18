// --- FILE: frontend/src/components/chessboard/PersonalityWorkshop.tsx ---
// Мастерская соперников: игрок собирает бота из ползунков характера и силы, выбирает ему дебюты, сохраняет и играет
// с ним. Как ползунки превращаются в стиль игры — src/services/bots/personality.py; хранение —
// services/personalities.ts: у вошедшего игрока — сервер (GET, POST, PUT, DELETE /bots/personalities), без токена —
// localStorage этого браузера (ключ michess_guest_personalities). Готовые архетипы и их сила — GET /bots/catalog.
// Радар стиля, оценка силы и метки стиля считаются на клиенте (config/archetypes.ts). Сейчас мастерскую показывает
// только Chessboard, а он без входа выводит заглушку — гостевая ветка с главной доски недостижима.

import {useCallback, useEffect, useState} from 'react';
import {PolarAngleAxis, PolarGrid, Radar, RadarChart} from 'recharts';
import {Pencil, Save, Trash2} from 'lucide-react';
import {STRENGTH_BUCKETS, STYLE_TAGS, strengthBucket, strengthNote, styleRadar, styleTags} from '../../config/archetypes';
import type {ArchetypeId, CustomOpponent, StrengthBucket, StyleTag} from '../../config/archetypes';
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
import {HABITS, MAX_HABITS, OPENING_STYLES} from '../../services/personalities';
import type {Habit, OpeningStyle, Personality, PersonalityConfig} from '../../services/personalities';
import {fetchBotCatalog, strengthLabel} from '../../services/botCatalog';
import {FavoriteOpeningsPicker, OpeningsLine} from './FavoriteOpeningsPicker';
import type {CatalogArchetype} from '../../services/botCatalog';
import {useI18n} from '../../i18n';
import {t as translate} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {renderUiMessage, uiMessage} from '../../i18n';
import type {UiMessage} from '../../i18n';

type SliderKey = 'aggression' | 'center_control' | 'mobility' | 'king_safety' | 'pawn_structure'
    | 'randomness' | 'blunder_guard_cp' | 'target_elo' | 'draw_attitude' | 'passed_pawns';

/** Значения новых ползунков у соперников, сохранённых до них (таск 21.4). */
const SLIDER_FALLBACK: Partial<Record<SliderKey, number>> = {draw_attitude: 0, passed_pawns: 100};

interface SliderSpec {
    key: SliderKey;
    readonly label: string;
    min: number;
    max: number;
    step: number;
    readonly hint: string;
}

// Описание ползунка; подпись и подсказка «что это меняет» читаются из каталога при показе (геттеры), поэтому
// меняются вместе с языком.
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

/**
 * Ползунки конструктора. Границы — те же, что в BotPersonalityConfig на сервере (src/services/bots/personality.py):
 * значение вне границ сервер не примет.
 */
export const SLIDERS: SliderSpec[] = [
    slider('aggression', -100, 100, 5),
    slider('center_control', 0, 200, 10),
    slider('mobility', 0, 200, 10),
    slider('king_safety', 0, 200, 10),
    slider('pawn_structure', 0, 200, 10),
    slider('randomness', 0, 100, 5),
    slider('blunder_guard_cp', 0, 400, 10),
    slider('draw_attitude', -100, 100, 10),
    slider('passed_pawns', 0, 200, 10),
    slider('target_elo', 300, 2800, 50),
];

export interface PersonalityWorkshopProps {
    /** Токен вошедшего игрока: персоналии на сервере; без него — в этом браузере. */
    token: string | null;
    playDisabled: boolean;
    /** Начать партию с соперником из черновика; партию ведёт вызывающий (useBotGame, /bots/custom-move). */
    onPlay: (opponent: CustomOpponent, colorPref: 'white' | 'black' | 'random') => void;
    /** На свободной доске стоит своя позиция — партию можно начать с неё (флажок под кнопкой сохранения). */
    canStartFromPosition: boolean;
    startFromPosition: boolean;
    onStartFromPositionChange: (value: boolean) => void;
}

/** Соперник в конструкторе: то, что сейчас на ползунках; до сохранения живёт только в памяти компонента. */
interface Draft {
    name: string;
    config: PersonalityConfig;
    bio?: string;
    /** id сохранённой персоналии, которую редактируем (null — новая). */
    savedId: number | string | null;
    /** Черновик начат с архетипа: пока имя и ползунки не тронуты, играем именно этим архетипом. */
    archetypeId?: ArchetypeId;
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
    // Фильтры выбора соперника (таск 21.4).
    const [show, setShow] = useState<'all' | 'archetypes' | 'mine'>('all');
    const [bucket, setBucket] = useState<StrengthBucket | 'any'>('any');
    const [styleTag, setStyleTag] = useState<StyleTag | 'any'>('any');
    const fits = (rating: number, config: PersonalityConfig) =>
        (bucket === 'any' || strengthBucket(rating) === bucket) && (styleTag === 'any' || styleTags(config).includes(styleTag));
    const shownMine = mine.filter((p) => fits(p.config.target_elo, p.config));
    const shownArchetypes = archetypes.filter((a) => fits(a.rating, a.config));

    // Архетипы — из каталога ботов (GET /bots/catalog; services/botCatalog.ts держит ответ в памяти).
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

    // Берёт соперника (своего или архетип) в конструктор. Конфиг копируется, чтобы правки черновика не меняли
    // сохранённого соперника и архетип из каталога.
    const pick = (
        name: string, config: PersonalityConfig, savedId: Draft['savedId'], bio?: string, archetypeId?: ArchetypeId,
    ) => {
        setDraft({
            name, savedId, bio, archetypeId,
            config: {
                ...config, piece_values: {...config.piece_values},
                openings_white: [...(config.openings_white ?? [])], openings_black: [...(config.openings_black ?? [])],
            },
        });
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

    // Играть можно и несохранённым черновиком: тогда на сервер с каждым ходом уходят сами ползунки (config).
    // Архетип без правок играет как архетип (в архив — его ключ, имя на языке игрока).
    const play = (colorPref: 'white' | 'black' | 'random') => {
        const name = draft.name.trim() || t('workshop.defaultName');
        const savedOnServer = token && typeof draft.savedId === 'number';
        const archetype = archetypes.find((a) => a.id === draft.archetypeId);
        const pristineArchetype = archetype && draft.savedId === null
            && name === t(`archetypes.${archetype.id}.name`)
            && sameConfig(draft.config, archetype.config);
        onPlay({
            name,
            config: draft.config,
            bio: draft.bio,
            ...(pristineArchetype ? {archetypeId: archetype.id} : {}),
            // Сохранённый на сервере соперник играет по своему id — но только если конфиг не меняли.
            personalityId: savedOnServer && isUnchanged(mine, draft) ? (draft.savedId as number) : undefined,
        }, colorPref);
    };

    return (
        <div className="flex flex-col gap-2 text-xs text-boxwood" data-testid="personality-workshop">
            <div className="flex flex-wrap items-center gap-1.5" data-testid="opponent-filters">
                <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label={t('workshop.filters.label')}
                        data-testid="filter-show" className="bg-black/40 rounded px-1 py-0.5">
                    <option value="all">{t('workshop.filters.label')}: {t('workshop.filters.any')}</option>
                    <option value="archetypes">{t('workshop.archetypes')}</option>
                    <option value="mine">{t('workshop.myOpponents')}</option>
                </select>
                <select value={bucket} onChange={(e) => setBucket(e.target.value as typeof bucket)} aria-label={t('workshop.filters.strength')}
                        data-testid="filter-strength" className="bg-black/40 rounded px-1 py-0.5">
                    <option value="any">{t('workshop.filters.strength')}: {t('workshop.filters.any')}</option>
                    {STRENGTH_BUCKETS.map((b) => <option key={b} value={b}>{t(`workshop.filters.strengths.${b}`)}</option>)}
                </select>
                <select value={styleTag} onChange={(e) => setStyleTag(e.target.value as typeof styleTag)} aria-label={t('workshop.filters.style')}
                        data-testid="filter-style" className="bg-black/40 rounded px-1 py-0.5">
                    <option value="any">{t('workshop.filters.style')}: {t('workshop.filters.any')}</option>
                    {STYLE_TAGS.map((tag) => <option key={tag} value={tag}>{t(`workshop.filters.styles.${tag}`)}</option>)}
                </select>
            </div>
            {show !== 'archetypes' && (
            <section>
                <h3 className="font-bold text-amber-300 mb-1">{t('workshop.myOpponents')}</h3>
                {mine.length === 0 ? (
                    <p className="text-boxwood/70">{t('workshop.noOpponents')}</p>
                ) : shownMine.length === 0 ? (
                    <p className="text-boxwood/70">{t('workshop.filters.nothing')}</p>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {shownMine.map((p) => (
                            <li key={p.id} className="flex items-center gap-1.5 bg-black/35 rounded px-2 py-1 border border-amber-900/40">
                                <span className="flex-1 min-w-0">
                                    <span className="font-bold truncate block">{p.name}</span>
                                    <OpeningsLine white={p.config.openings_white} black={p.config.openings_black}/>
                                </span>
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
            )}

            {show !== 'mine' && (
            <section>
                <h3 className="font-bold text-amber-300 mb-1">{t('workshop.archetypes')}</h3>
                {archetypes.length === 0 && <p className="text-boxwood/70">{t('workshop.archetypesLoading')}</p>}
                {archetypes.length > 0 && shownArchetypes.length === 0 && <p className="text-boxwood/70">{t('workshop.filters.nothing')}</p>}
                <div className="flex flex-wrap gap-1" data-testid="archetype-list">
                    {shownArchetypes.map((a) => (
                        <button key={a.id} type="button" title={t(`archetypes.${a.id}.bio`)}
                                onClick={() => pick(
                                    t(`archetypes.${a.id}.name`), a.config, null, t(`archetypes.${a.id}.bio`), a.id,
                                )}
                                className={`px-2 py-0.5 rounded border cursor-pointer ${
                                    draft.archetypeId === a.id && draft.savedId === null
                                        ? 'bg-amber-800 border-amber-400 text-white'
                                        : 'bg-black/35 border-amber-900/40 hover:border-amber-600/60'
                                }`}>
                            {t(`archetypes.${a.id}.name`)} <span className="font-mono text-amber-300/80">{strengthLabel(a)}</span>
                        </button>
                    ))}
                </div>
            </section>
            )}

            <section className="flex flex-col gap-1.5 p-2 rounded-md bg-black/40 border border-amber-800/50">
                <label className="flex flex-col gap-0.5">
                    <span className="text-amber-200 font-semibold">{t('workshop.opponentName')}</span>
                    <input value={draft.name} maxLength={30}
                           onChange={(e) => setDraft((d) => ({...d, name: e.target.value}))}
                           placeholder={t('workshop.namePlaceholder')}
                           className="px-2 py-1 rounded bg-black/50 border border-amber-800/60 text-boxwood-light"/>
                </label>
                {(draft.archetypeId || draft.bio) && (
                    <p className="italic text-boxwood/80">
                        {draft.archetypeId ? t(`archetypes.${draft.archetypeId}.bio`) : draft.bio}
                    </p>
                )}

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
                            <span className="font-mono text-amber-300">{draft.config[s.key] ?? SLIDER_FALLBACK[s.key]}</span>
                        </span>
                        <input type="range" min={s.min} max={s.max} step={s.step} aria-label={s.label}
                               value={draft.config[s.key] ?? SLIDER_FALLBACK[s.key] ?? 0}
                               onChange={(e) => setValue(s.key, Number(e.target.value))}
                               className="accent-amber-600"/>
                        <span className="text-[10px] text-boxwood/60 leading-tight">{s.hint}</span>
                    </label>
                ))}

                <fieldset className="flex flex-col gap-1" data-testid="habits">
                    <legend className="text-amber-200 font-semibold">{t('workshop.habits.label')}</legend>
                    <span className="text-[10px] text-boxwood/60 leading-tight">{t('workshop.habits.hint')}</span>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {HABITS.map((habit) => {
                            const chosen = (draft.config.habits ?? []).includes(habit);
                            const full = (draft.config.habits ?? []).length >= MAX_HABITS;
                            return (
                                <label key={habit} className="flex items-center gap-1 cursor-pointer">
                                    <input type="checkbox" checked={chosen} disabled={!chosen && full} className="accent-amber-600"
                                           data-testid={`habit-${habit}`}
                                           onChange={() => setDraft((d) => {
                                               const current = d.config.habits ?? [];
                                               const next: Habit[] = chosen ? current.filter((h) => h !== habit) : [...current, habit];
                                               return {...d, config: {...d.config, habits: next}};
                                           })}/>
                                    {t(`workshop.habits.items.${habit}`)}
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
                <label className="flex flex-col gap-0.5">
                    <span className="text-amber-200 font-semibold">{t('workshop.openingStyle.label')}</span>
                    <select value={draft.config.opening_style ?? 'normal'} data-testid="opening-style"
                            onChange={(e) => setDraft((d) => ({...d, config: {...d.config, opening_style: e.target.value as OpeningStyle}}))}
                            className="bg-black/50 rounded px-1 py-1 border border-amber-800/60">
                        {OPENING_STYLES.map((style) => <option key={style} value={style}>{t(`workshop.openingStyle.items.${style}`)}</option>)}
                    </select>
                </label>

                <FavoriteOpeningsPicker white={draft.config.openings_white ?? []} black={draft.config.openings_black ?? []}
                                        onChange={(side, epds) => setDraft((d) => ({
                                            ...d, config: {...d.config, [side === 'white' ? 'openings_white' : 'openings_black']: epds},
                                        }))}/>

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

/** Черновик совпадает с сохранённым соперником (имя и все ползунки) — можно играть по его id. */
function isUnchanged(mine: Personality[], draft: Draft): boolean {
    const saved = mine.find((p) => p.id === draft.savedId);
    return !!saved && saved.name === draft.name.trim() && sameConfig(saved.config, draft.config);
}

/** Сравнение конфигов: у соперников, сохранённых до любимых дебютов (таск 21.2), этих полей нет — это пустые списки. */
function sameConfig(a: PersonalityConfig, b: PersonalityConfig): boolean {
    const normal = (c: PersonalityConfig) => JSON.stringify({
        ...c, openings_white: c.openings_white ?? [], openings_black: c.openings_black ?? [], habits: c.habits ?? [],
        opening_style: c.opening_style ?? 'normal', draw_attitude: c.draw_attitude ?? 0, passed_pawns: c.passed_pawns ?? 100,
    });
    return normal(a) === normal(b);
}
