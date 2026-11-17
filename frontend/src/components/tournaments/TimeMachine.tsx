// --- FILE: frontend/src/components/tournaments/TimeMachine.tsx ---
// «Машина времени» (таск 28.3): /time-machine — знаменитые турниры прошлого по годам. Игрок входит в турнир
// дополнительным участником при полном историческом составе; партии мастеров между собой разыгрывает сервер.
// RealResult — «как было на самом деле»: настоящая итоговая таблица рядом с турниром игрока.

import {useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {Hourglass} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {MessageKey, UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {ALL_TIME_CONTROLS} from '../../config/timeControls';
import {
    eventTitle, fieldName, fieldShortName, getTimeMachine, guestAbout, scoreText, startHistoricEvent,
} from '../../services/timeMachine';
import type {FieldEntry, HistoricEvent} from '../../services/timeMachine';

const sectionClass = 'bg-acacia p-4 rounded-lg border-2 border-acacia-dark';
/** Контроль по умолчанию — 10 минут: в большом турнире партий много. */
const DEFAULT_CONTROL = 'rapid-10+0';

/** Настоящая таблица турнира: место, участник, очки. В турнире на выбывание — места и выбывшие в первом круге. */
function RealTable({field}: { field: FieldEntry[] }) {
    const {t} = useI18n();
    return (
        <ol className="text-sm columns-1 sm:columns-2 gap-x-8" data-testid="real-table">
            {field.map((entry) => (
                <li key={entry.id} className="flex gap-2 items-baseline min-w-0 break-inside-avoid py-px"
                    title={guestAbout(entry.id, t) ?? undefined}>
                    <span className="w-6 text-right font-mono text-boxwood/70 shrink-0">{entry.place ?? '—'}</span>
                    <span className="truncate">{fieldName(entry, t)}</span>
                    <span className="ml-auto font-mono text-boxwood/80 shrink-0">
                        {entry.score !== null ? scoreText(entry.score) : entry.place === null ? t('timeMachine.outFirstRound') : ''}
                    </span>
                </li>
            ))}
        </ol>
    );
}

export function RealResult({eventKey, finished, myPlace}: { eventKey: string; finished: boolean; myPlace: number | null }) {
    const {t} = useI18n();
    const [event, setEvent] = useState<HistoricEvent | null>(null);
    useEffect(() => {
        let alive = true;
        getTimeMachine().then((events) => alive && setEvent(events.find((e) => e.key === eventKey) ?? null)).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [eventKey]);
    if (!event) return null;
    const real = `timeMachine.events.${eventKey}.real` as MessageKey;
    return (
        <details className={sectionClass} open={finished} data-testid="real-result">
            <summary className="font-bold text-amber-200 cursor-pointer">{t('timeMachine.realTitle')}</summary>
            <div className="flex flex-col gap-2 mt-2">
                <p className="text-sm">{t(real)}</p>
                {finished && myPlace !== null && (
                    <p className="text-sm text-amber-300" data-testid="real-compare">{t('timeMachine.yourPlace', {place: myPlace})}</p>
                )}
                <RealTable field={event.field}/>
            </div>
        </details>
    );
}

function EventCard({event, control, busy, onStart}: {
    event: HistoricEvent; control: string; busy: boolean; onStart: (event: HistoricEvent) => void;
}) {
    const {t, tp} = useI18n();
    const text = (part: string) => t(`timeMachine.events.${event.key}.${part}` as MessageKey);
    const strongest = [...event.field].sort((a, b) => b.rating - a.rating).slice(0, 5);
    return (
        <article className={`${sectionClass} flex flex-col gap-3`} data-testid={`event-${event.key}`}>
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-bold font-mono text-amber-400">{event.year}</span>
                <h2 className="text-xl font-bold text-amber-200">{text('title')}</h2>
                <span className="text-sm text-boxwood/75">{text('place')}</span>
                {event.best_place !== null && (
                    <span className="ml-auto text-sm text-emerald-300" data-testid={`best-${event.key}`}>
                        {t('timeMachine.bestPlace', {place: event.best_place})}
                    </span>
                )}
            </header>
            <p className="text-sm leading-relaxed max-w-3xl">{text('story')}</p>
            <ul className="text-sm text-boxwood/85 flex flex-wrap gap-x-5 gap-y-1">
                <li>{t(`timeMachine.formats.${event.format}`)}{event.cycles > 1 ? ` · ${tp('timeMachine.cycles', event.cycles)}` : ''}</li>
                <li>{tp('timeMachine.masters', event.field.length)}</li>
                <li data-testid={`games-${event.key}`}>
                    {event.player_games !== null ? tp('timeMachine.yourGames', event.player_games) : t('timeMachine.knockoutGames')}
                </li>
            </ul>
            <p className="text-sm">
                <span className="text-boxwood/70">{t('timeMachine.strongest')}</span>{' '}
                {strongest.map((entry) => fieldShortName(entry, t)).join(', ')}
            </p>
            <details>
                <summary className="text-sm text-amber-300 cursor-pointer">{t('timeMachine.fullField')}</summary>
                <div className="mt-2 flex flex-col gap-2">
                    <p className="text-sm text-boxwood/80">{text('real')}</p>
                    <RealTable field={event.field}/>
                </div>
            </details>
            <div className="flex flex-wrap items-center gap-3">
                {event.active_id !== null ? (
                    <Link to={`/tournaments/${event.active_id}`} data-testid={`continue-${event.key}`}
                          className="px-4 py-2 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600">
                        {t('timeMachine.continue')}
                    </Link>
                ) : (
                    <button type="button" disabled={busy} onClick={() => onStart(event)} data-testid={`start-${event.key}`}
                            className="px-4 py-2 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600 disabled:opacity-50 cursor-pointer">
                        {t('timeMachine.enter', {control})}
                    </button>
                )}
                {event.played > 0 && <span className="text-xs text-boxwood/65">{tp('timeMachine.played', event.played)}</span>}
            </div>
        </article>
    );
}

export function TimeMachinePage() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [events, setEvents] = useState<HistoricEvent[] | null>(null);
    const [control, setControl] = useState(DEFAULT_CONTROL);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        let alive = true;
        getTimeMachine().then((list) => alive && setEvents(list))
            .catch((err) => alive && setError(errorMessage(err, 'timeMachine.loadFailed')));
        return () => {
            alive = false;
        };
    }, []);

    // Пуля для турнира из двадцати партий не годится; «свой контроль» здесь не настраивается.
    const controls = ALL_TIME_CONTROLS.filter((c) => !c.isManual && c.base >= 3);
    const chosen = controls.find((c) => c.id === control) ?? controls[0];
    const start = (event: HistoricEvent) => {
        setBusy(true);
        setError(null);
        startHistoricEvent(event.key, chosen.base * 60_000, chosen.inc * 1000)
            .then((tournament) => navigate(`/tournaments/${tournament.id}`))
            .catch((err) => setError(errorMessage(err, 'timeMachine.startFailed')))
            .finally(() => setBusy(false));
    };
    // Идущий исторический турнир — один: пока он не закончен, в другой войти нельзя.
    const active = events?.find((e) => e.active_id !== null) ?? null;

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="time-machine">
            <header className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-amber-200 flex items-center gap-2">
                    <Hourglass className="text-amber-400"/> {t('timeMachine.title')}
                </h1>
                <p className="text-sm text-boxwood/85 max-w-3xl">{t('timeMachine.intro')}</p>
                {/* Каталог мастеров прошлого (таск 28.5): отдельная партия с любым участником. */}
                <p className="text-sm">
                    <Link to="/masters" data-testid="masters-link" className="underline text-amber-300">{t('masters.title')}</Link>
                    <span className="text-boxwood/75"> — {t('masters.teaser')}</span>
                </p>
            </header>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <div className={`${sectionClass} flex flex-wrap items-center gap-3`}>
                <label htmlFor="tm-control" className="text-sm">{t('timeMachine.control')}</label>
                <select id="tm-control" value={chosen.id} data-testid="tm-control"
                        onChange={(e) => setControl(e.target.value)} className="bg-black/40 rounded px-2 py-1 text-sm">
                    {controls.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <span className="text-xs text-boxwood/65">{t('timeMachine.controlHint')}</span>
            </div>
            {active && <p className="text-sm text-amber-300" data-testid="tm-active">{t('timeMachine.oneAtATime', {title: eventTitle(active.key, t)})}</p>}
            {events === null && !error && <p className="text-sm text-boxwood/70">{t('timeMachine.loading')}</p>}
            {events?.map((event) => (
                <EventCard key={event.key} event={event} control={chosen.label} busy={busy || (active !== null && active.key !== event.key)}
                           onStart={start}/>
            ))}
        </div>
    );
}
