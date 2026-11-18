// --- FILE: frontend/src/components/chessboard/FavoriteOpeningsPicker.tsx ---
// Любимые дебюты соперника мастерской (таск 21.2): до трёх за белых и за чёрных из открытой таблицы дебютов. Бот
// играет их ходы, пока позиция есть в линии; соперник свернул — дальше движок с характером. Дебют хранится в
// конфиге соперника не названием, а позицией (EPD); названия и поиск по названию или коду ECO — GET /bots/openings
// (таблица дебютов сервера, src/services/data/openings.tsv). Названия — английские имена собственные из таблицы,
// они не переводятся.

import {useEffect, useState} from 'react';
import {X} from 'lucide-react';
import {useI18n} from '../../i18n';
import {fetchOpenings, MAX_FAVORITE_OPENINGS} from '../../services/personalities';
import type {OpeningEntry} from '../../services/personalities';

type Side = 'white' | 'black';

interface Props {
    white: string[];
    black: string[];
    onChange: (side: Side, epds: string[]) => void;
}

/** Названия выбранных дебютов по их позициям (общий кэш на сессию, живёт до перезагрузки страницы). */
const names = new Map<string, OpeningEntry>();

/**
 * Названия дебютов по позициям: недостающие догружаются одним запросом GET /bots/openings?epd=…, после ответа
 * компонент перерисовывается. Возвращает общий кэш — пока ответа нет, записи для позиции в нём нет.
 */
export function useOpeningNames(epds: string[]): Map<string, OpeningEntry> {
    // Счётчик нужен только затем, чтобы перерисовать компонент, когда кэш пополнился.
    const [, setVersion] = useState(0);
    const missing = epds.filter((epd) => !names.has(epd));
    const key = missing.join('|');
    useEffect(() => {
        if (!key) return;
        let alive = true;
        fetchOpenings({epds: key.split('|')}).then((found) => {
            for (const entry of found) names.set(entry.epd, entry);
            if (alive) setVersion((v) => v + 1);
        }).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [key]);
    return names;
}

function SidePicker({side, value, onChange}: { side: Side; value: string[]; onChange: (epds: string[]) => void }) {
    const {t} = useI18n();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<OpeningEntry[]>([]);
    const known = useOpeningNames(value);
    const full = value.length >= MAX_FAVORITE_OPENINGS;

    // Поиск по названию: от двух символов, с паузой 250 мс после ввода (не запрос на каждую букву), до 8 строк.
    useEffect(() => {
        const text = query.trim();
        if (text.length < 2 || full) {
            setResults([]);
            return;
        }
        let alive = true;
        const timer = setTimeout(() => {
            fetchOpenings({q: text}).then((found) => {
                for (const entry of found) names.set(entry.epd, entry);
                if (alive) setResults(found.slice(0, 8));
            }).catch(() => alive && setResults([]));
        }, 250);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [query, full]);

    const add = (entry: OpeningEntry) => {
        if (value.includes(entry.epd) || full) return;
        onChange([...value, entry.epd]);
        setQuery('');
        setResults([]);
    };

    return (
        <div className="flex flex-col gap-1" data-testid={`openings-${side}`}>
            <span className="text-amber-200 font-semibold">{t(side === 'white' ? 'workshop.openings.white' : 'workshop.openings.black')}</span>
            <div className="flex flex-wrap gap-1">
                {value.map((epd) => (
                    <span key={epd} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-900/50 border border-amber-700/50 max-w-full">
                        <span className="truncate" title={known.get(epd)?.name}>
                            {known.get(epd) ? `${known.get(epd)!.eco} ${known.get(epd)!.name}` : '…'}
                        </span>
                        <button type="button" onClick={() => onChange(value.filter((v) => v !== epd))}
                                aria-label={t('workshop.openings.remove', {name: known.get(epd)?.name ?? ''})}
                                className="shrink-0 hover:text-red-300 cursor-pointer"><X size={11}/></button>
                    </span>
                ))}
                {value.length === 0 && <span className="text-boxwood/60">{t('workshop.openings.none')}</span>}
            </div>
            {!full && (
                <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={60}
                       placeholder={t('workshop.openings.search')} aria-label={t('workshop.openings.search')}
                       data-testid={`openings-search-${side}`}
                       className="px-2 py-1 rounded bg-black/50 border border-amber-800/60 text-boxwood-light"/>
            )}
            {results.length > 0 && (
                <ul className="flex flex-col bg-black/50 rounded border border-amber-900/50 max-h-40 overflow-y-auto">
                    {results.map((entry) => (
                        <li key={entry.epd}>
                            <button type="button" onClick={() => add(entry)} data-testid={`opening-option-${side}`}
                                    disabled={value.includes(entry.epd)}
                                    className="w-full text-left px-2 py-0.5 hover:bg-amber-900/40 disabled:opacity-40 cursor-pointer">
                                <span className="font-mono text-amber-300/80">{entry.eco}</span> {entry.name}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** Выбор любимых дебютов за белых и за чёрных; onChange отдаёт сторону и новый список позиций (EPD). */
export function FavoriteOpeningsPicker({white, black, onChange}: Props) {
    const {t} = useI18n();
    return (
        <div className="flex flex-col gap-1.5" data-testid="favorite-openings">
            <p className="text-[10px] text-boxwood/60 leading-tight">{t('workshop.openings.hint')}</p>
            <SidePicker side="white" value={white} onChange={(epds) => onChange('white', epds)}/>
            <SidePicker side="black" value={black} onChange={(epds) => onChange('black', epds)}/>
        </div>
    );
}

/** Строка с дебютами соперника для карточки: «♔ Ruy Lopez · ♚ Sicilian Defense» (без кода ECO; он — в выборе). */
export function OpeningsLine({white = [], black = []}: { white?: string[]; black?: string[] }) {
    const known = useOpeningNames([...white, ...black]);
    if (white.length + black.length === 0) return null;
    const label = (epd: string) => known.get(epd)?.name ?? '…';
    const parts = [...white.map((epd) => `♔ ${label(epd)}`), ...black.map((epd) => `♚ ${label(epd)}`)];
    return <span className="block text-[10px] text-boxwood/70 truncate" data-testid="openings-line">{parts.join(' · ')}</span>;
}
