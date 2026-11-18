// --- FILE: frontend/src/components/arena/ConferencesPage.tsx ---
// Конференции (таск 33.6): /conferences — Кубок конференций текущего сезона (месяца) и выбор своей страны. Страна
// определяет конференцию; очки игрока в любой арене идут в зачёт его конференции. Страну игрок указывает сам:
// подсказка (страна от сервера или из языка браузера) только предлагается и без нажатия никуда не отправляется.
// Под Кубком — матчи конференций сезона и ближайшие (ConferenceMatches.tsx).

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {Globe} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {conferencesApi, countryName, localeCountry} from '../../services/conferences';
import type {ConferencesData} from '../../services/conferences';
import {MatchList} from './ConferenceMatches';

export function ConferencesPage() {
    const {t, language} = useI18n();
    const [data, setData] = useState<ConferencesData | null>(null);
    const [choice, setChoice] = useState('');
    const [error, setError] = useState<UiMessage | null>(null);
    const loggedIn = Boolean(getToken());

    const load = useCallback(() => {
        conferencesApi.page().then((page) => {
            setData(page);
            setChoice(page.me?.country ?? '');
        }).catch((err) => setError(errorMessage(err, 'common.networkError')));
    }, []);
    useEffect(load, [load]);

    // Страны по алфавиту языка интерфейса.
    const countries = useMemo(() => Object.keys(data?.countries ?? {})
        .map((code) => ({code, name: countryName(code, language)}))
        .sort((a, b) => a.name.localeCompare(b.name, language)), [data, language]);

    if (!data) return error ? <p role="alert" className="p-4 text-rose-300">{renderUiMessage(error, t)}</p> : null;

    const me = data.me;
    const save = (country: string | null) => {
        setError(null);
        conferencesApi.setCountry(country).then(load).catch((err) => setError(errorMessage(err, 'common.networkError')));
    };
    // Подсказка — только пока страна не указана и только из стран, которые можно выбрать.
    const hinted = data.suggested_country ?? localeCountry();
    const suggestion = me && !me.country && hinted && data.countries[hinted] ? hinted : null;
    const chosenConference = choice ? data.countries[choice] : null;

    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="conferences-page">
            <Link to="/arenas" className="text-sm text-amber-400 hover:underline">{t('arenas.title')}</Link>
            <header className="flex items-center gap-2">
                <Globe className="text-amber-400 shrink-0"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('conferences.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('conferences.intro')}</p>
            <p className="text-sm text-boxwood/75">{t('conferences.rules', {n: data.top_players})}</p>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}

            <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark overflow-x-auto">
                <h2 className="font-bold text-amber-200 mb-2">{t('conferences.cup', {season: data.season})}</h2>
                <table className="w-full text-sm" data-testid="conference-cup">
                    <thead>
                        <tr className="text-boxwood/70 text-left">
                            <th>#</th><th>{t('conferences.conference')}</th>
                            <th className="text-right">{t('conferences.score')}</th>
                            <th className="text-right">{t('conferences.arenas')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.table.map((row, index) => (
                            <tr key={row.conference} data-testid={`cup-${row.conference}`}
                                className={me?.conference === row.conference ? 'text-amber-200 font-bold' : ''}>
                                <td>{index + 1}</td>
                                <td>{t(`arenas.conferences.${row.conference}`)}</td>
                                <td className="text-right font-bold">{row.score}</td>
                                <td className="text-right font-mono text-boxwood/80">{row.arenas}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            <MatchList matches={data.matches ?? []}/>

            <section className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark flex flex-col gap-2" data-testid="my-country">
                <h2 className="font-bold text-amber-200">{t('conferences.myCountry')}</h2>
                {!loggedIn || !me ? <p className="text-sm">{t('conferences.loginToChoose')}</p> : (
                    <>
                        <p className="text-sm" data-testid="my-conference">
                            {me.conference
                                ? t('conferences.yours', {conference: t(`arenas.conferences.${me.conference}`)})
                                : t('conferences.noCountry')}
                        </p>
                        {suggestion && (
                            <p className="text-sm flex flex-wrap items-center gap-2" data-testid="country-suggestion">
                                <span>{t('conferences.suggest', {country: countryName(suggestion, language)})}</span>
                                <button type="button" onClick={() => setChoice(suggestion)} data-testid="country-use-suggested"
                                        className="text-amber-400 hover:underline">{t('conferences.useSuggested')}</button>
                            </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            <select value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="country-select"
                                    aria-label={t('conferences.choose')}
                                    className="bg-black/40 rounded px-2 py-1.5 text-sm min-w-0 w-full sm:w-72">
                                <option value="">{t('conferences.choose')}</option>
                                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                            </select>
                            <button type="button" disabled={!choice || choice === me.country} onClick={() => save(choice)}
                                    data-testid="country-save"
                                    className="px-4 py-1.5 rounded bg-amber-700 text-white text-sm font-bold disabled:opacity-40">
                                {t('conferences.save')}
                            </button>
                            {me.country && (
                                <button type="button" onClick={() => save(null)} data-testid="country-remove"
                                        className="text-sm text-rose-300 hover:underline">{t('conferences.remove')}</button>
                            )}
                        </div>
                        {chosenConference && choice !== me.country && (
                            <p className="text-sm text-boxwood/85" data-testid="country-preview">
                                {t('conferences.willJoin', {conference: t(`arenas.conferences.${chosenConference}`)})}
                            </p>
                        )}
                        <p className="text-xs text-boxwood/70">
                            {t(me.can_change ? 'conferences.changeRule' : 'conferences.changeUsed')}
                        </p>
                        <p className="text-xs text-boxwood/70">{t('conferences.privacy')}</p>
                    </>
                )}
            </section>
        </div>
    );
}
