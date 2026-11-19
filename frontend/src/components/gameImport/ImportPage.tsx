// --- FILE: frontend/src/components/gameImport/ImportPage.tsx ---
// «Мои партии с других сайтов» (таск 24.1): /import — импорт последних партий с lichess и chess.com по нику или
// вставкой PGN. Сервер разбирает их в фоне, промахи игрока становятся задачами «Мои ошибки»; партия открывается
// в разборе с наставником (/import/game/:id). Только для вошедших. Данные — services/gameImport.ts
// (/api/v1/imports, src/api/game_import.py); ник сайта запоминается в localStorage (rememberNick/savedNick).
// Маршрут — App.tsx.

import {useCallback, useEffect, useState} from 'react';
import type {FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {format, parseISO} from 'date-fns';
import {CloudDownload, Puzzle, Trash2} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {IMPORT_COUNTS, IMPORT_PAGE, importApi, opponentOf, outcome, rememberNick, savedNick} from '../../services/gameImport';
import type {ImportedGameView, ImportedList, ImportResult, ImportSource} from '../../services/gameImport';

// Вкладка источника: сайт по нику или вставка PGN.
type Tab = ImportSource | 'pgn';
const TABS: Tab[] = ['lichess', 'chesscom', 'pgn'];
// Цвет исхода партии для самого игрока (победа / поражение / ничья / исход неизвестен).
const OUTCOME_STYLE = {win: 'text-emerald-400', loss: 'text-red-400', draw: 'text-boxwood/80', unknown: 'text-boxwood/60'};

/** Строка списка: соперник, исход, источник и дата, состояние разбора (число задач) и удаление. */
function GameRow({game, onDelete}: { game: ImportedGameView; onDelete: (game: ImportedGameView) => void }) {
    const {t, tp, dateLocale} = useI18n();
    const opponent = opponentOf(game);
    const result = outcome(game);
    return (
        <li className="flex flex-wrap items-center justify-between gap-2 bg-black/30 rounded px-3 py-2 text-sm"
            data-testid="imported-game">
            <Link to={`/import/game/${game.id}`} className="flex flex-col min-w-0 hover:text-amber-300">
                <span className="truncate">
                    <span className={`font-bold ${OUTCOME_STYLE[result]}`}>{t(`gameImport.outcome.${result}`)}</span>
                    {' · '}{t(game.color === 'white' ? 'gameImport.vsWhite' : 'gameImport.vsBlack', {
                        opponent: opponent.name, rating: opponent.rating ?? '—',
                    })}
                </span>
                <span className="text-xs text-boxwood/70">
                    {[t(`gameImport.source.${game.source}`), game.speed ? t(`gameImport.speed.${game.speed}`) : null,
                        game.played_at ? format(parseISO(game.played_at), 'd MMM yyyy', {locale: dateLocale}) : null]
                        .filter(Boolean).join(' · ')}
                </span>
            </Link>
            <span className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-boxwood/80" data-testid="imported-status">
                    {game.analyzed
                        ? <span className="flex items-center gap-1"><Puzzle size={12}/> {tp('gameImport.puzzles', game.puzzles)}</span>
                        : t('gameImport.analyzing')}
                </span>
                <button type="button" onClick={() => onDelete(game)} aria-label={t('gameImport.delete')}
                        title={t('gameImport.delete')} data-testid="imported-delete"
                        className="p-1 rounded text-boxwood/70 hover:text-red-400 cursor-pointer">
                    <Trash2 size={14}/>
                </button>
            </span>
        </li>
    );
}

/** Страница импорта: форма трёх вкладок и список сохранённых партий с постраничным показом (IMPORT_PAGE). */
export function ImportPage() {
    const {t, tp} = useI18n();
    const loggedIn = Boolean(getToken());
    const [tab, setTab] = useState<Tab>('lichess');
    const [nick, setNick] = useState(() => savedNick('lichess'));
    const [pgn, setPgn] = useState('');
    const [player, setPlayer] = useState('');
    const [count, setCount] = useState<number>(10);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [list, setList] = useState<ImportedList | null>(null);
    const [offset, setOffset] = useState(0);

    const reload = useCallback((from: number) => {
        importApi.list(from).then(setList).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, []);
    useEffect(() => {
        if (loggedIn) reload(offset);
    }, [loggedIn, offset, reload]);

    // Разбор идёт в фоне: пока есть неразобранные партии, список перечитывается каждые 8 секунд.
    const pending = list?.games.some((game) => !game.analyzed) ?? false;
    useEffect(() => {
        if (!pending) return;
        const timer = window.setTimeout(() => reload(offset), 8000);
        return () => window.clearTimeout(timer);
    }, [pending, list, offset, reload]);

    const chooseTab = (next: Tab) => {
        setTab(next);
        setError(null);
        setResult(null);
        if (next !== 'pgn') setNick(savedNick(next));
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const body = tab === 'pgn'
                ? await importApi.pastePgn(pgn, player.trim(), count)
                : await importApi.fetchSite(tab, nick.trim(), count);
            if (tab !== 'pgn') rememberNick(tab, nick.trim());
            setResult(body);
            if (tab === 'pgn' && body.added.length) setPgn('');
            setOffset(0);
            reload(0);
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (game: ImportedGameView) => {
        if (!window.confirm(t('gameImport.deleteConfirm'))) return;
        try {
            await importApi.remove(game.id);
            reload(offset);
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        }
    };

    if (!loggedIn) {
        return (
            <div className="w-full max-w-3xl mx-auto p-3 text-boxwood-light" data-testid="import-page">
                <h1 className="text-2xl font-bold text-amber-200 mb-2">{t('gameImport.title')}</h1>
                <p data-testid="import-login">{t('gameImport.loginFirst')}</p>
            </div>
        );
    }

    const canSubmit = tab === 'pgn' ? pgn.trim().length > 0 : /^[A-Za-z0-9_-]{2,30}$/.test(nick.trim());
    return (
        <div className="w-full max-w-3xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="import-page">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-amber-200 flex items-center gap-2">
                    <CloudDownload className="text-amber-400"/> {t('gameImport.title')}
                </h1>
                <p className="text-sm text-boxwood/85">{t('gameImport.intro')}</p>
            </header>

            <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5" role="tablist">
                    {TABS.map((key) => (
                        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => chooseTab(key)}
                                data-testid={`import-tab-${key}`}
                                className={`px-3 py-1.5 rounded text-sm border cursor-pointer ${tab === key ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`}>
                            {t(`gameImport.tab.${key}`)}
                        </button>
                    ))}
                </div>
                <form onSubmit={submit} className="flex flex-col gap-2">
                    {tab === 'pgn' ? (
                        <>
                            <textarea value={pgn} onChange={(e) => setPgn(e.target.value)} rows={7}
                                      placeholder={t('gameImport.pgnPlaceholder')} data-testid="import-pgn"
                                      aria-label={t('gameImport.pgnPlaceholder')}
                                      className="w-full bg-black/40 border border-amber-900/60 rounded p-2 font-mono text-xs"/>
                            <label className="flex flex-col gap-1 text-sm">
                                {t('gameImport.playerName')}
                                <input value={player} onChange={(e) => setPlayer(e.target.value)} maxLength={60}
                                       placeholder={t('gameImport.playerNameHint')} data-testid="import-player"
                                       className="bg-black/40 border border-amber-900/60 rounded px-2 py-1.5"/>
                            </label>
                        </>
                    ) : (
                        <label className="flex flex-col gap-1 text-sm">
                            {t('gameImport.nick', {site: t(`gameImport.source.${tab}`)})}
                            <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={30}
                                   autoComplete="off" spellCheck={false} data-testid="import-nick"
                                   className="bg-black/40 border border-amber-900/60 rounded px-2 py-1.5"/>
                        </label>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span>{t('gameImport.count')}</span>
                        {IMPORT_COUNTS.map((value) => (
                            <button key={value} type="button" onClick={() => setCount(value)} aria-pressed={count === value}
                                    className={`px-2 py-1 rounded border cursor-pointer ${count === value ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50'}`}>
                                {value}
                            </button>
                        ))}
                        <button type="submit" disabled={busy || !canSubmit} data-testid="import-submit"
                                className="ml-auto px-4 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white font-bold disabled:opacity-40 cursor-pointer">
                            {t(busy ? 'gameImport.importing' : 'gameImport.submit')}
                        </button>
                    </div>
                    <p className="text-xs text-boxwood/70">{t(tab === 'pgn' ? 'gameImport.pgnNote' : 'gameImport.privacy')}</p>
                </form>
                {error && <p className="text-sm text-red-300" role="alert" data-testid="import-error">{renderUiMessage(error, t)}</p>}
                {result && (
                    <p className="text-sm text-amber-200" data-testid="import-result">
                        {result.added.length === 0
                            ? t('gameImport.nothing')
                            : tp('gameImport.done', result.added.length)}
                        {result.skipped > 0 && ` ${tp('gameImport.skipped', result.skipped)}`}
                    </p>
                )}
            </section>

            <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-amber-200">{t('gameImport.listTitle')}</h2>
                    {list && <span className="text-xs text-boxwood/70">{t('gameImport.stored', {total: list.total, max: list.max})}</span>}
                </div>
                {list && list.total === 0 && <p className="text-sm text-boxwood/80" data-testid="import-empty">{t('gameImport.empty')}</p>}
                {list && list.games.length > 0 && (
                    <>
                        <ul className="flex flex-col gap-1">
                            {list.games.map((game) => <GameRow key={game.id} game={game} onDelete={(g) => void remove(g)}/>)}
                        </ul>
                        <p className="text-xs text-boxwood/75">
                            {t('gameImport.puzzlesHint')} <Link to="/puzzles" className="underline hover:text-amber-300">{t('nav.puzzles')}</Link>
                        </p>
                    </>
                )}
                {list && list.total > IMPORT_PAGE && (
                    <div className="flex gap-2 text-sm">
                        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - IMPORT_PAGE))}
                                className="px-3 py-1 rounded bg-black/30 border border-amber-900/50 disabled:opacity-40 cursor-pointer">
                            {t('gameImport.prev')}
                        </button>
                        <button type="button" disabled={offset + IMPORT_PAGE >= list.total} onClick={() => setOffset(offset + IMPORT_PAGE)}
                                className="px-3 py-1 rounded bg-black/30 border border-amber-900/50 disabled:opacity-40 cursor-pointer">
                            {t('gameImport.next')}
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}
