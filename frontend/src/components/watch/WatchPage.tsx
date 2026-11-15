// --- FILE: frontend/src/components/watch/WatchPage.tsx ---
// «Просмотр» (таск 16.3): «Партия дня», идущие сейчас партии (смотреть — режим зрителя на главной доске), архив
// мастеров с фильтрами по игроку, годам, дебюту и результату, «забавные подборки».

import {useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {Eye, Radio, Star} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {COLLECTIONS, PAGE_SIZE, watchApi} from '../../services/watch';
import type {ArchiveFilters, ArchiveGame, CollectionKey} from '../../services/watch';
import type {LiveGameItem} from '../chessboard/types';

type Tab = 'live' | 'archive' | 'collections';

function GameLine({game, extra}: { game: ArchiveGame; extra?: string }) {
    return (
        <Link to={`/game/${game.id}`} className="flex justify-between gap-3 px-2 py-1.5 rounded hover:bg-black/30 text-sm">
            <span className="truncate">{game.white} — {game.black}</span>
            <span className="shrink-0 font-mono text-boxwood/75">
                {[game.result, game.eco, game.year, extra].filter(Boolean).join(' · ')}
            </span>
        </Link>
    );
}

function Live() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [games, setGames] = useState<LiveGameItem[] | null>(null);
    useEffect(() => {
        watchApi.live().then(setGames).catch(() => setGames([]));
    }, []);
    if (games === null) return null;
    if (games.length === 0) return <p className="text-sm text-boxwood/70" data-testid="watch-live-empty">{t('watch.noLive')}</p>;
    return (
        <ul className="flex flex-col gap-1" data-testid="watch-live">
            {games.map((g) => (
                <li key={g.game_id} className="flex flex-wrap items-center justify-between gap-2 bg-black/30 rounded px-3 py-2 text-sm">
                    <span>{g.white_username} ({g.white_rating}) — {g.black_username} ({g.black_rating})</span>
                    <span className="flex items-center gap-3">
                        <span className="text-xs text-boxwood/70">{Math.round(g.base_time_ms / 60000)}+{Math.round(g.increment_ms / 1000)} · <Eye size={12} className="inline"/> {g.spectators_count}</span>
                        <button type="button" onClick={() => navigate('/', {state: {spectate: g.game_id}})}
                                className="px-2 py-1 rounded bg-amber-700 text-white font-bold">{t('watch.spectate')}</button>
                    </span>
                </li>
            ))}
        </ul>
    );
}

function Archive() {
    const {t} = useI18n();
    const [draft, setDraft] = useState<ArchiveFilters>({});
    const [filters, setFilters] = useState<ArchiveFilters>({});
    const [page, setPage] = useState<{ total: number; items: ArchiveGame[] } | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        setError(null);
        watchApi.archive(filters).then(setPage).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, [filters]);

    const set = (key: keyof ArchiveFilters, value: string) => setDraft((d) => ({
        ...d, [key]: key === 'year_from' || key === 'year_to' ? (value ? Number(value) : undefined) : (value || undefined),
    }));
    const offset = filters.offset ?? 0;

    return (
        <div className="flex flex-col gap-3">
            <form className="flex flex-wrap gap-2 items-end text-sm" data-testid="watch-filters"
                  onSubmit={(e) => {
                      e.preventDefault();
                      setFilters({...draft, offset: 0});
                  }}>
                <label className="flex flex-col gap-1">{t('watch.player')}
                    <input value={draft.player ?? ''} onChange={(e) => set('player', e.target.value)} maxLength={60}
                           className="bg-black/40 rounded px-2 py-1 w-44" data-testid="filter-player"/>
                </label>
                <label className="flex flex-col gap-1">{t('watch.yearFrom')}
                    <input type="number" value={draft.year_from ?? ''} onChange={(e) => set('year_from', e.target.value)}
                           className="bg-black/40 rounded px-2 py-1 w-24" data-testid="filter-year-from"/>
                </label>
                <label className="flex flex-col gap-1">{t('watch.yearTo')}
                    <input type="number" value={draft.year_to ?? ''} onChange={(e) => set('year_to', e.target.value)}
                           className="bg-black/40 rounded px-2 py-1 w-24"/>
                </label>
                <label className="flex flex-col gap-1">{t('watch.eco')}
                    <input value={draft.eco ?? ''} onChange={(e) => set('eco', e.target.value.trim())} maxLength={3} placeholder="C60"
                           className="bg-black/40 rounded px-2 py-1 w-20" data-testid="filter-eco"/>
                </label>
                <label className="flex flex-col gap-1">{t('watch.result')}
                    <select value={draft.result ?? ''} onChange={(e) => set('result', e.target.value)} className="bg-black/40 rounded px-2 py-1">
                        <option value="">{t('watch.anyResult')}</option>
                        <option value="1-0">1-0</option>
                        <option value="0-1">0-1</option>
                        <option value="1/2-1/2">½-½</option>
                    </select>
                </label>
                <button type="submit" className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold">{t('watch.search')}</button>
            </form>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {page && (
                <>
                    <p className="text-xs text-boxwood/70" data-testid="watch-total">{t('watch.found', {count: page.total})}</p>
                    <div className="flex flex-col" data-testid="watch-archive">
                        {page.items.map((g) => <GameLine key={g.id} game={g}/>)}
                    </div>
                    <div className="flex gap-2 text-sm">
                        <button type="button" disabled={offset === 0} onClick={() => setFilters((f) => ({...f, offset: Math.max(0, offset - PAGE_SIZE)}))}
                                className="px-2 py-1 rounded bg-black/30 disabled:opacity-40">{t('watch.prev')}</button>
                        <button type="button" disabled={offset + PAGE_SIZE >= page.total} data-testid="watch-next"
                                onClick={() => setFilters((f) => ({...f, offset: offset + PAGE_SIZE}))}
                                className="px-2 py-1 rounded bg-black/30 disabled:opacity-40">{t('watch.next')}</button>
                    </div>
                </>
            )}
        </div>
    );
}

function Collections() {
    const {t} = useI18n();
    const [data, setData] = useState<Record<CollectionKey, (ArchiveGame & { value: number })[]> | null>(null);
    useEffect(() => {
        watchApi.collections().then((r) => setData(r.collections)).catch(() => setData(null));
    }, []);
    if (!data) return null;
    return (
        <div className="grid md:grid-cols-2 gap-3" data-testid="watch-collections">
            {COLLECTIONS.filter((key) => data[key]?.length).map((key) => (
                <section key={key} className="bg-black/20 rounded p-2" data-testid={`collection-${key}`}>
                    <h3 className="font-bold text-amber-200 text-sm">{t(`watch.collections.${key}.title`)}</h3>
                    <p className="text-xs text-boxwood/70 mb-1">{t(`watch.collections.${key}.hint`)}</p>
                    {data[key].map((g) => <GameLine key={g.id} game={g} extra={t(`watch.collections.${key}.value`, {n: g.value})}/>)}
                </section>
            ))}
        </div>
    );
}

export function WatchPage() {
    const {t} = useI18n();
    const [tab, setTab] = useState<Tab>('live');
    const [daily, setDaily] = useState<ArchiveGame | null>(null);
    useEffect(() => {
        watchApi.gameOfTheDay().then((r) => setDaily(r.game)).catch(() => undefined);
    }, []);

    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="watch-page">
            <header className="flex items-center gap-2">
                <Eye className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('watch.title')}</h1>
            </header>
            {daily && (
                <Link to={`/game/${daily.id}`} data-testid="watch-daily"
                      className="bg-amber-900/30 border border-amber-600 rounded-lg p-3 flex flex-wrap items-center gap-2 hover:bg-amber-900/50">
                    <Star size={16} className="text-amber-400"/>
                    <span className="font-bold text-amber-200">{t('watch.gameOfTheDay')}:</span>
                    <span>{daily.white} — {daily.black}</span>
                    <span className="text-sm text-boxwood/75">{[daily.site, daily.year, daily.result].filter(Boolean).join(', ')}</span>
                </Link>
            )}
            <div className="flex gap-1.5" role="tablist">
                {(['live', 'archive', 'collections'] as const).map((key) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                            data-testid={`watch-tab-${key}`}
                            className={`px-3 py-1.5 rounded text-sm border flex items-center gap-1.5 ${tab === key ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`}>
                        {key === 'live' && <Radio size={13}/>}{t(`watch.tabs.${key}`)}
                    </button>
                ))}
            </div>
            <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark">
                {tab === 'live' && <Live/>}
                {tab === 'archive' && <Archive/>}
                {tab === 'collections' && <Collections/>}
            </section>
        </div>
    );
}
