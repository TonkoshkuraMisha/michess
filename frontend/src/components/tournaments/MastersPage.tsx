// --- FILE: frontend/src/components/tournaments/MastersPage.tsx ---
// Каталог мастеров прошлого (таск 28.5): /masters — все участники турниров «Машины времени». С любым можно сыграть
// отдельную партию: мастер играет тем же характером, что и в историческом турнире, а партия уходит в архив под
// его именем. Имена, строки о мастерах и названия турниров — из каталогов по ключам.

import {useEffect, useMemo, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {Users} from 'lucide-react';
import {renderUiMessage, uiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {getMasterConfig, getMasters, matchesQuery, sortMasters} from '../../services/masters';
import type {Master, MasterColor, MasterGameStart, MasterOrder} from '../../services/masters';
import {eventTitle, guestAbout, guestName} from '../../services/timeMachine';

const sectionClass = 'bg-acacia p-4 rounded-lg border-2 border-acacia-dark';
const ORDERS: MasterOrder[] = ['strength', 'years', 'name'];
const COLORS: MasterColor[] = ['white', 'black', 'random'];

function MasterCard({master, busy, onPlay}: { master: Master; busy: boolean; onPlay: (master: Master, color: MasterColor) => void }) {
    const {t} = useI18n();
    const about = guestAbout(master.id, t);
    const openings = [...master.openings.white, ...master.openings.black];
    return (
        <li className={`${sectionClass} flex flex-col gap-2 min-w-0`} data-testid={`master-${master.id}`}>
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
                <h2 className="text-lg font-bold text-amber-200 break-words min-w-0">{guestName(master.id, t)}</h2>
                <span className="text-sm text-boxwood/75">{master.era ?? t('masters.eraUnknown')}</span>
                <span className="ml-auto text-sm font-mono text-amber-300 shrink-0">{t('masters.rating', {rating: master.rating})}</span>
            </header>
            {about && <p className="text-sm">{about}</p>}
            {openings.length > 0 && (
                <p className="text-sm text-boxwood/85" data-testid={`master-opening-${master.id}`}>
                    <span className="text-boxwood/70">{t('masters.opening')}</span> {openings.join(' · ')}
                </p>
            )}
            <p className="text-xs text-boxwood/75">
                <span className="text-boxwood/60">{t('masters.events')}</span>{' '}
                {master.events.map((key) => eventTitle(key, t)).join(', ')}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">
                <span className="text-sm text-boxwood/80">{t('masters.play')}</span>
                {COLORS.map((color) => (
                    <button key={color} type="button" disabled={busy} onClick={() => onPlay(master, color)}
                            data-testid={`play-${master.id}-${color}`}
                            className="px-3 py-1.5 rounded-md bg-amber-700 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50 cursor-pointer">
                        {t(`masters.colors.${color}`)}
                    </button>
                ))}
            </div>
        </li>
    );
}

export function MastersPage() {
    const {t, tp, language} = useI18n();
    const navigate = useNavigate();
    const [masters, setMasters] = useState<Master[] | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [query, setQuery] = useState('');
    const [order, setOrder] = useState<MasterOrder>('strength');
    const [onlyOpening, setOnlyOpening] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        getMasters().then((list) => alive && setMasters(list))
            .catch((err) => alive && setError(errorMessage(err, 'masters.loadFailed')));
        return () => {
            alive = false;
        };
    }, []);

    const shown = useMemo(() => {
        if (!masters) return [];
        const nameOf = (master: Master) => guestName(master.id, t);
        const found = masters.filter((master) => matchesQuery(master, nameOf(master), query)
            && (!onlyOpening || master.openings.white.length + master.openings.black.length > 0));
        return sortMasters(found, order, nameOf, language);
    }, [masters, query, order, onlyOpening, t, language]);

    const play = (master: Master, color: MasterColor) => {
        // Партия с ботом сохраняется в архив игрока: гостю сначала нужно войти.
        if (!getToken()) {
            setError(uiMessage('masters.loginToPlay'));
            return;
        }
        setBusy(true);
        setError(null);
        getMasterConfig(master.id)
            .then((found) => {
                const guestGame: MasterGameStart = {
                    name: guestName(master.id, t), savedName: found.pgn_name, config: found.config, color,
                };
                navigate('/', {state: {guestGame}});
            })
            .catch((err) => setError(errorMessage(err, 'masters.startFailed')))
            .finally(() => setBusy(false));
    };

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="masters-page">
            <header className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-amber-200 flex items-center gap-2">
                    <Users className="text-amber-400"/> {t('masters.title')}
                </h1>
                <p className="text-sm text-boxwood/85 max-w-3xl">{t('masters.intro')}</p>
                <Link to="/time-machine" className="text-sm underline text-amber-300 self-start">{t('timeMachine.title')}</Link>
            </header>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <div className={`${sectionClass} flex flex-wrap items-center gap-x-4 gap-y-2`}>
                <label className="flex items-center gap-2 text-sm min-w-0">
                    <span>{t('masters.search')}</span>
                    <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="masters-search"
                           className="bg-black/40 rounded px-2 py-1 text-sm w-44 max-w-full"/>
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <span>{t('masters.order')}</span>
                    <select value={order} onChange={(e) => setOrder(e.target.value as MasterOrder)} data-testid="masters-order"
                            className="bg-black/40 rounded px-2 py-1 text-sm">
                        {ORDERS.map((value) => <option key={value} value={value}>{t(`masters.orders.${value}`)}</option>)}
                    </select>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={onlyOpening} onChange={(e) => setOnlyOpening(e.target.checked)}
                           data-testid="masters-only-opening"/>
                    <span>{t('masters.onlyOpening')}</span>
                </label>
                {masters && <span className="text-xs text-boxwood/65 ml-auto" data-testid="masters-count">{tp('timeMachine.masters', shown.length)}</span>}
            </div>
            {masters === null && !error && <p className="text-sm text-boxwood/70">{t('masters.loading')}</p>}
            {masters !== null && shown.length === 0 && <p className="text-sm text-boxwood/70" data-testid="masters-empty">{t('masters.empty')}</p>}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {shown.map((master) => <MasterCard key={master.id} master={master} busy={busy} onPlay={play}/>)}
            </ul>
        </div>
    );
}
