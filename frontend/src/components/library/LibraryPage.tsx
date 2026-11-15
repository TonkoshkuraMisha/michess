// Библиотека партий (таск 27.1): /library — дерево коллекций слева, партии выбранной коллекции или результаты поиска
// справа; партия открывается в обычном просмотре (/library/game/:id, GameViewer в режиме библиотеки).

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {ChevronDown, ChevronRight, Library, Lock} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {childrenOf, LIBRARY_PAGE, libraryApi, totalGames} from '../../services/library';
import type {LibraryCollection, LibraryPage as Page, LibrarySearch} from '../../services/library';

type View = { kind: 'collection'; id: number; name: string } | { kind: 'search'; search: LibrarySearch };

function Tree({list, parent, open, selected, onToggle, onSelect}: {
    list: LibraryCollection[];
    parent: number | null;
    open: Set<number>;
    selected: number | null;
    onToggle: (id: number) => void;
    onSelect: (c: LibraryCollection) => void;
}) {
    const nodes = childrenOf(list, parent);
    if (nodes.length === 0) return null;
    return (
        <ul className={parent === null ? 'flex flex-col' : 'flex flex-col pl-4 border-l border-amber-900/40 ml-2'}>
            {nodes.map((c) => {
                const hasChildren = childrenOf(list, c.id).length > 0;
                const expanded = open.has(c.id);
                return (
                    <li key={c.id}>
                        <div className={`flex items-center gap-1 rounded ${selected === c.id ? 'bg-amber-800/60' : 'hover:bg-black/25'}`}>
                            <button type="button" onClick={() => onToggle(c.id)} disabled={!hasChildren} aria-expanded={hasChildren ? expanded : undefined}
                                    aria-label={c.name} className="w-5 shrink-0 flex justify-center disabled:opacity-0">
                                {expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                            </button>
                            <button type="button" onClick={() => onSelect(c)} data-testid={`library-collection-${c.id}`}
                                    className="flex-1 min-w-0 text-left py-1 pr-1 flex items-center gap-1.5 text-sm">
                                <span className="truncate">{c.name}</span>
                                {c.visibility !== 'public' && <Lock size={12} className="text-amber-400 shrink-0"/>}
                                <span className="ml-auto text-xs font-mono text-boxwood/60 shrink-0">{totalGames(list, c.id)}</span>
                            </button>
                        </div>
                        {expanded && <Tree list={list} parent={c.id} open={open} selected={selected} onToggle={onToggle} onSelect={onSelect}/>}
                    </li>
                );
            })}
        </ul>
    );
}

export function LibraryPage() {
    const {t} = useI18n();
    const [collections, setCollections] = useState<LibraryCollection[]>([]);
    const [open, setOpen] = useState<Set<number>>(new Set());
    const [view, setView] = useState<View | null>(null);
    const [offset, setOffset] = useState(0);
    const [page, setPage] = useState<Page | null>(null);
    const [draft, setDraft] = useState<LibrarySearch>({});
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        libraryApi.collections().then((r) => setCollections(r.collections))
            .catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, []);

    useEffect(() => {
        if (!view) return;
        let alive = true;
        setError(null);
        const request = view.kind === 'collection'
            ? libraryApi.collectionGames(view.id, offset)
            : libraryApi.search({...view.search, offset});
        request.then((r) => alive && setPage(r)).catch((err) => alive && setError(errorMessage(err, 'common.networkError')));
        return () => {
            alive = false;
        };
    }, [view, offset]);

    const toggle = (id: number) => setOpen((set) => {
        const next = new Set(set);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const select = (c: LibraryCollection) => {
        setView({kind: 'collection', id: c.id, name: c.name});
        setOffset(0);
        if (childrenOf(collections, c.id).length > 0) setOpen((set) => new Set(set).add(c.id));
    };
    const set = (key: keyof LibrarySearch, value: string) => setDraft((d) => ({
        ...d, [key]: key === 'year_from' || key === 'year_to' ? (value ? Number(value) : undefined) : (value || undefined),
    }));

    return (
        <div className="w-full max-w-6xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="library-page">
            <header className="flex items-center gap-2">
                <Library className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('library.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('library.intro')}</p>

            <form className="flex flex-wrap gap-2 items-end text-sm bg-black/30 rounded-lg p-3" data-testid="library-search"
                  onSubmit={(e) => {
                      e.preventDefault();
                      setView({kind: 'search', search: {...draft}});
                      setOffset(0);
                  }}>
                <label className="flex flex-col gap-1">{t('watch.player')}
                    <input value={draft.player ?? ''} onChange={(e) => set('player', e.target.value)} maxLength={60}
                           className="bg-black/40 rounded px-2 py-1 w-44" data-testid="library-player"/>
                </label>
                <label className="flex flex-col gap-1">{t('watch.yearFrom')}
                    <input type="number" value={draft.year_from ?? ''} onChange={(e) => set('year_from', e.target.value)}
                           className="bg-black/40 rounded px-2 py-1 w-24" data-testid="library-year-from"/>
                </label>
                <label className="flex flex-col gap-1">{t('watch.yearTo')}
                    <input type="number" value={draft.year_to ?? ''} onChange={(e) => set('year_to', e.target.value)}
                           className="bg-black/40 rounded px-2 py-1 w-24"/>
                </label>
                <label className="flex flex-col gap-1">{t('watch.eco')}
                    <input value={draft.eco ?? ''} onChange={(e) => set('eco', e.target.value.trim())} maxLength={3} placeholder="C60"
                           className="bg-black/40 rounded px-2 py-1 w-20" data-testid="library-eco"/>
                </label>
                <label className="flex flex-col gap-1">{t('watch.result')}
                    <select value={draft.result ?? ''} onChange={(e) => set('result', e.target.value)} className="bg-black/40 rounded px-2 py-1">
                        <option value="">{t('watch.anyResult')}</option>
                        <option value="1-0">1-0</option>
                        <option value="0-1">0-1</option>
                        <option value="1/2-1/2">½-½</option>
                    </select>
                </label>
                <button type="submit" className="px-3 py-1.5 rounded bg-amber-700 text-white font-bold" data-testid="library-search-submit">
                    {t('watch.search')}
                </button>
            </form>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}

            <div className="flex flex-col lg:flex-row gap-4 items-start">
                <aside className="w-full lg:w-80 shrink-0 bg-acacia rounded-lg border-2 border-acacia-dark p-2" data-testid="library-tree">
                    <h2 className="font-bold text-amber-200 px-1 pb-1">{t('library.collections')}</h2>
                    {collections.length === 0
                        ? <p className="text-sm text-boxwood/70 px-1">{t('library.empty')}</p>
                        : <Tree list={collections} parent={null} open={open} selected={view?.kind === 'collection' ? view.id : null}
                                onToggle={toggle} onSelect={select}/>}
                </aside>

                <section className="flex-1 min-w-0 w-full flex flex-col gap-2" data-testid="library-games">
                    {!view && <p className="text-sm text-boxwood/70">{t('library.pick')}</p>}
                    {view && page && (
                        <>
                            <h2 className="font-bold text-amber-200 break-words">
                                {view.kind === 'collection' ? view.name : t('library.searchResults')}
                                <span className="ml-2 text-xs font-normal text-boxwood/70" data-testid="library-total">{t('watch.found', {count: page.total})}</span>
                            </h2>
                            {page.games.length === 0 && <p className="text-sm text-boxwood/70">{t('library.noGames')}</p>}
                            <ul className="flex flex-col">
                                {page.games.map((g) => (
                                    <li key={g.id}>
                                        <Link to={`/library/game/${g.id}`} data-testid={`library-game-${g.id}`}
                                              className="flex flex-wrap justify-between gap-x-3 px-2 py-1.5 rounded hover:bg-black/30 text-sm">
                                            <span className="min-w-0 break-words">{g.white || '?'} — {g.black || '?'}</span>
                                            <span className="text-xs text-boxwood/70 font-mono shrink-0">
                                                {[g.eco, g.year, g.result].filter(Boolean).join(' · ')}
                                            </span>
                                            {(g.event || g.opening) && (
                                                <span className="w-full text-xs text-boxwood/60 truncate">{[g.event, g.opening].filter(Boolean).join(' · ')}</span>
                                            )}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                            {page.total > LIBRARY_PAGE && (
                                <div className="flex gap-2 text-sm">
                                    <button type="button" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIBRARY_PAGE))}
                                            className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 disabled:opacity-40">{t('library.prev')}</button>
                                    <button type="button" disabled={offset + LIBRARY_PAGE >= page.total} onClick={() => setOffset((o) => o + LIBRARY_PAGE)}
                                            data-testid="library-next" className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 disabled:opacity-40">{t('library.next')}</button>
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
