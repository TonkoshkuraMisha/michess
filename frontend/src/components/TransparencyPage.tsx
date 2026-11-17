// --- FILE: frontend/src/components/TransparencyPage.tsx ---
// «Как мы измеряем силу ботов» и открытые данные (таск 24.3): методика калибровки, таблица «заявлено / измерено ±95 %»
// по каждому боту, журналы прогонов как есть, выгрузка своих партий в PGN и описание открытого API только для чтения.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {format, parseISO} from 'date-fns';
import {Download, FileText, Scale} from 'lucide-react';
import {hasMessage, renderUiMessage, useI18n} from '../i18n';
import type {MessageKey, UiMessage} from '../i18n';
import {errorMessage} from '../services/apiErrors';
import {getToken} from '../services/authToken';
import {fetchBotCatalog} from '../services/botCatalog';
import type {BotStrength} from '../services/botCatalog';
import {downloadMyGamesPgn, runUrl, transparencyApi} from '../services/transparency';
import type {CalibrationMeta, CalibrationRun, PublicApiInfo} from '../services/transparency';

interface Row extends BotStrength {
    key: string;
    nameKey: string;
}

const sectionClass = 'bg-acacia p-4 rounded-lg border-2 border-acacia-dark flex flex-col gap-3';
const headingClass = 'text-lg font-bold text-amber-200 flex items-center gap-2';
const METHOD_STEPS = ['anchors', 'pairs', 'fit', 'scale'] as const;
// Пояснение к адресу API — по его последней части; неизвестный серверу клиенту адрес показывается без пояснения.
const ENDPOINT_NOTES: [RegExp, string][] = [
    [/\/public$/, 'index'], [/\/players\/\{username\}$/, 'player'], [/\/games\.pgn$/, 'playerPgn'],
    [/\/players\/\{username\}\/games$/, 'playerGames'], [/\/rating-history$/, 'ratingHistory'],
    [/\/games\/\{id\}\.pgn$/, 'gamePgn'], [/\/games\/\{id\}$/, 'game'], [/\/leaderboard$/, 'leaderboard'], [/\/bots$/, 'bots'],
];

function botName(row: Row, t: (key: MessageKey) => string): string {
    return hasMessage(row.nameKey) ? t(row.nameKey as MessageKey) : row.key;
}

export function TransparencyPage({username = null}: { username?: string | null }) {
    const {t, dateLocale} = useI18n();
    const [rows, setRows] = useState<Row[]>([]);
    const [meta, setMeta] = useState<CalibrationMeta | null>(null);
    const [runs, setRuns] = useState<CalibrationRun[]>([]);
    const [api, setApi] = useState<PublicApiInfo | null>(null);
    const [openRun, setOpenRun] = useState<{ name: string; text: string } | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [exportNote, setExportNote] = useState<UiMessage | null>(null);
    const [busy, setBusy] = useState(false);
    const logged = Boolean(getToken());

    useEffect(() => {
        fetchBotCatalog().then((catalog) => {
            setRows([
                ...catalog.historical.map((bot) => ({...bot, key: bot.id, nameKey: `bots.profiles.${bot.id}.name`})),
                ...catalog.archetypes.map((bot) => ({...bot, key: `archetype:${bot.id}`, nameKey: `archetypes.${bot.id}.name`})),
            ].sort((a, b) => b.rating - a.rating));
        }).catch((err) => setError(errorMessage(err, 'common.networkError')));
        transparencyApi.runs().then((body) => {
            setMeta(body.calibration);
            setRuns(body.runs);
        }).catch(() => undefined);
        transparencyApi.publicApi().then(setApi).catch(() => undefined);
    }, []);

    const showRun = async (name: string) => {
        if (openRun?.name === name) {
            setOpenRun(null);
            return;
        }
        try {
            setOpenRun({name, text: await transparencyApi.runText(name)});
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        }
    };

    const exportGames = async () => {
        setBusy(true);
        setExportNote(null);
        try {
            const count = await downloadMyGamesPgn(username);
            setExportNote(count ? {key: 'transparency.exportDone', params: {count}} : {key: 'transparency.exportEmpty'});
        } catch (err) {
            setExportNote(errorMessage(err, 'settings.exportFailed'));
        } finally {
            setBusy(false);
        }
    };

    const measured = rows.filter((row) => row.measured).length;
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light select-text" data-testid="transparency-page">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold text-amber-200 flex items-center gap-2">
                    <Scale className="text-amber-400"/> {t('transparency.title')}
                </h1>
                <p className="text-sm text-boxwood/85">{t('transparency.intro')}</p>
            </header>
            {error && <p role="alert" className="text-rose-300 text-sm">{renderUiMessage(error, t)}</p>}

            <section className={sectionClass}>
                <h2 className={headingClass}>{t('transparency.methodTitle')}</h2>
                <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-sm">
                    {METHOD_STEPS.map((step) => (
                        <li key={step}>{t(`transparency.method.${step}`, {
                            anchors: (meta?.anchors ?? []).join(', ') || '—', seconds: meta?.anchor_movetime_s ?? 1,
                        })}</li>
                    ))}
                </ol>
                <p className="text-sm text-boxwood/85">{t('transparency.measuredVsDeclared')}</p>
                <p className="text-sm text-boxwood/85" data-testid="transparency-memory">{t('transparency.memory')}</p>
            </section>

            <section className={sectionClass} data-testid="transparency-results">
                <h2 className={headingClass}>{t('transparency.resultsTitle')}</h2>
                {meta && (
                    <p className="text-sm text-boxwood/85" data-testid="transparency-meta">
                        {t('transparency.lastRun', {
                            date: format(parseISO(meta.date), 'd MMM yyyy', {locale: dateLocale}),
                            games: meta.games, measured, total: rows.length,
                        })}
                    </p>
                )}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-boxwood/75 border-b border-amber-900/50">
                                <th className="py-1 pr-3 font-normal">{t('transparency.col.bot')}</th>
                                <th className="py-1 pr-3 font-normal">{t('transparency.col.declared')}</th>
                                <th className="py-1 pr-3 font-normal">{t('transparency.col.measured')}</th>
                                <th className="py-1 pr-3 font-normal">{t('transparency.col.games')}</th>
                                <th className="py-1 pr-3 font-normal">{t('transparency.col.live')}</th>
                                <th className="py-1 font-normal">{t('transparency.col.status')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.key} className="border-b border-amber-900/20" data-testid={`strength-${row.key}`}>
                                    <td className="py-1 pr-3">{botName(row, t)}</td>
                                    <td className="py-1 pr-3 font-mono">{row.declared_rating}</td>
                                    <td className="py-1 pr-3 font-mono">
                                        {row.measured ? `${row.rating}${row.ci95 ? ` ±${row.ci95}` : ''}` : '—'}
                                    </td>
                                    <td className="py-1 pr-3 font-mono">{row.measured ? row.games : '—'}</td>
                                    <td className="py-1 pr-3 font-mono" data-testid={`live-${row.key}`}>
                                        {row.live ? t('transparency.liveValue', {rating: row.live.rating, games: row.live.games}) : '—'}
                                        {row.live?.offset ? (
                                            <span className="block text-[11px] text-amber-300">
                                                {t('transparency.offset', {offset: row.live.offset > 0 ? `+${row.live.offset}` : row.live.offset})}
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className="py-1">
                                        <span className={`px-1.5 py-0.5 rounded text-xs border whitespace-nowrap ${row.measured
                                            ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60'
                                            : 'bg-black/30 text-boxwood/80 border-amber-900/50'}`}>
                                            {t(row.measured ? 'transparency.measured' : 'transparency.declared')}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className={sectionClass} data-testid="transparency-runs">
                <h2 className={headingClass}><FileText size={18} className="text-amber-400"/> {t('transparency.runsTitle')}</h2>
                <p className="text-sm text-boxwood/85">{t('transparency.runsNote')}</p>
                <ul className="flex flex-col gap-1 text-sm">
                    {runs.map((run) => (
                        <li key={run.name} className="flex flex-col gap-1">
                            <span className="flex flex-wrap items-center justify-between gap-2 bg-black/30 rounded px-3 py-1.5">
                                <span className="font-mono break-all">{run.name}</span>
                                <span className="flex items-center gap-3 shrink-0">
                                    <span className="text-xs text-boxwood/70">{t('transparency.sizeKb', {kb: Math.max(1, Math.round(run.size / 1024))})}</span>
                                    {run.kind === 'log' && (
                                        <button type="button" onClick={() => void showRun(run.name)} data-testid={`run-show-${run.name}`}
                                                aria-expanded={openRun?.name === run.name}
                                                className="text-amber-300 hover:underline cursor-pointer">
                                            {t(openRun?.name === run.name ? 'transparency.hide' : 'transparency.show')}
                                        </button>
                                    )}
                                    <a href={runUrl(run.name)} download={run.name} className="text-amber-300 hover:underline">
                                        {t('transparency.download')}
                                    </a>
                                </span>
                            </span>
                            {openRun?.name === run.name && (
                                <pre className="max-h-80 overflow-auto bg-black/50 rounded p-2 text-xs whitespace-pre-wrap" data-testid="run-text">
                                    {openRun.text}
                                </pre>
                            )}
                        </li>
                    ))}
                </ul>
            </section>

            <section className={sectionClass} data-testid="transparency-data">
                <h2 className={headingClass}><Download size={18} className="text-amber-400"/> {t('transparency.dataTitle')}</h2>
                <p className="text-sm">{t('transparency.exportNote')}</p>
                {logged ? (
                    <button type="button" onClick={() => void exportGames()} disabled={busy} data-testid="transparency-export"
                            className="self-start px-4 py-2 rounded-md bg-amber-800 hover:bg-amber-700 text-white text-sm font-bold disabled:opacity-50 cursor-pointer flex items-center gap-1.5">
                        <Download size={15}/> {t('settings.exportGames')}
                    </button>
                ) : (
                    <p className="text-sm text-amber-300">{t('transparency.exportLogin')}</p>
                )}
                {exportNote && <p className="text-sm text-amber-200" role="status" data-testid="transparency-export-note">{renderUiMessage(exportNote, t)}</p>}
                {logged && <p className="text-xs text-boxwood/75">{t('transparency.allData')} <Link to="/settings" className="underline hover:text-amber-300">{t('settings.myData')}</Link></p>}

                <h3 className="font-bold text-amber-300 mt-2">{t('transparency.apiTitle')}</h3>
                <p className="text-sm">{t('transparency.apiNote')}</p>
                {api && (
                    <>
                        <p className="text-sm text-boxwood/85" data-testid="transparency-api-limit">
                            {t('transparency.apiLimit', {requests: api.rate_limit.requests, seconds: api.rate_limit.window_s})}
                        </p>
                        <ul className="flex flex-col gap-1 text-sm">
                            {api.endpoints.map((endpoint) => {
                                const note = ENDPOINT_NOTES.find(([pattern]) => pattern.test(endpoint))?.[1];
                                return (
                                    <li key={endpoint} className="flex flex-col sm:flex-row sm:gap-3">
                                        <code className="font-mono text-amber-200 break-all">GET {endpoint}</code>
                                        {note && <span className="text-boxwood/80">{t(`transparency.endpoints.${note}` as MessageKey)}</span>}
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}
            </section>
        </div>
    );
}
