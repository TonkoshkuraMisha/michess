// --- FILE: frontend/src/components/OpeningExplorer.tsx ---
// Дерево дебютов (таск 16.2): ходы из текущей позиции со статистикой партий (доли побед белых / ничьих / побед
// чёрных), название дебюта и партии мастеров из архива и библиотеки (партия библиотеки ведёт в библиотеку и помечена
// «в библиотеке» или «с объяснениями»). Данные — services/openingExplorer.ts (exploreOpening, ответ сервера по
// списку ходов). Используется в «Инструментах» (/tools), в просмотре партии (GameViewer) и в разделе репертуара.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {BookOpen} from 'lucide-react';
import {renderUiMessage, useI18n} from '../i18n';
import type {UiMessage} from '../i18n';
import {errorMessage} from '../services/apiErrors';
import {exploreOpening, shares} from '../services/openingExplorer';
import type {ExplorerResult} from '../services/openingExplorer';

interface Props {
    /** Ходы из начальной позиции в UCI. */
    moves: string[];
    /** Щелчок по ходу — сыграть его (в «Инструментах»); без обработчика ходы только показываются. */
    onPlay?: (uci: string) => void;
}

/**
 * Блок дерева дебютов для позиции после moves. Запрос повторяется при смене ходов; устаревший ответ отбрасывается
 * (флаг alive). Доля сегмента меньше 15 % подписи не получает — не помещается в полосу.
 */
export function OpeningExplorer({moves, onPlay}: Props) {
    const {t} = useI18n();
    const [data, setData] = useState<ExplorerResult | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const key = moves.join(' ');

    useEffect(() => {
        let alive = true;
        setError(null);
        exploreOpening(key ? key.split(' ') : [])
            .then((result) => alive && setData(result))
            .catch((err) => {
                if (!alive) return;
                setData(null);
                setError(errorMessage(err, 'common.networkError'));
            });
        return () => {
            alive = false;
        };
    }, [key]);

    return (
        <section className="bg-black/30 rounded-lg p-3 flex flex-col gap-2 text-sm" data-testid="opening-explorer">
            <h3 className="font-bold text-amber-200 flex items-center gap-1.5"><BookOpen size={16}/> {t('explorer.title')}</h3>
            {error && <p role="alert" className="text-rose-300">{renderUiMessage(error, t)}</p>}
            {data && (
                <>
                    <p className="text-amber-300" data-testid="explorer-opening">
                        {data.opening ? `${data.opening.eco} · ${data.opening.name}` : t('explorer.noName')}
                    </p>
                    {data.moves.length === 0 ? (
                        <p className="text-boxwood/70" data-testid="explorer-empty">{t('explorer.noGames')}</p>
                    ) : (
                        <table className="w-full" data-testid="explorer-moves">
                            <thead>
                                <tr className="text-xs text-boxwood/60 text-left">
                                    <th className="font-normal">{t('explorer.move')}</th>
                                    <th className="font-normal text-right pr-2">{t('explorer.games')}</th>
                                    <th className="font-normal">{t('explorer.results')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.moves.map((m) => {
                                    const [white, draw, black] = shares(m);
                                    return (
                                        <tr key={m.uci} className="align-middle">
                                            <td className="py-0.5">
                                                {onPlay
                                                    ? <button type="button" onClick={() => onPlay(m.uci)} title={m.opening?.name}
                                                              className="font-mono font-bold text-amber-200 hover:underline">{m.san}</button>
                                                    : <span className="font-mono font-bold" title={m.opening?.name}>{m.san}</span>}
                                            </td>
                                            <td className="text-right pr-2 font-mono text-boxwood/80">{m.games}</td>
                                            <td className="w-1/2">
                                                <div className="flex h-3.5 rounded overflow-hidden text-[10px] leading-[14px] font-mono"
                                                     aria-label={t('explorer.share', {white, draw, black})}>
                                                    <span className="bg-stone-100 text-stone-800 text-center" style={{width: `${white}%`}}>{white >= 15 ? white : ''}</span>
                                                    <span className="bg-stone-400 text-stone-900 text-center" style={{width: `${draw}%`}}>{draw >= 15 ? draw : ''}</span>
                                                    <span className="bg-stone-800 text-stone-100 text-center" style={{width: `${black}%`}}>{black >= 15 ? black : ''}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {data.games.length > 0 && (
                        <div className="flex flex-col gap-0.5" data-testid="explorer-games">
                            <h4 className="text-xs text-boxwood/60">{t('explorer.masterGames')}</h4>
                            {data.games.map((g) => (
                                <Link key={`${g.source}-${g.id}`} to={g.source === 'library' ? `/library/game/${g.id}` : `/game/${g.id}`}
                                      data-testid={`explorer-game-${g.source}-${g.id}`}
                                      className="text-xs hover:underline flex justify-between gap-2">
                                    <span className="truncate">
                                        {g.white} — {g.black}
                                        {g.source === 'library' && (
                                            <span className="ml-1.5 text-amber-300/90 no-underline">
                                                · {t(g.annotated ? 'explorer.withNotes' : 'explorer.inLibrary')}
                                            </span>
                                        )}
                                    </span>
                                    <span className="font-mono text-boxwood/70 shrink-0">{g.result} {g.year}</span>
                                </Link>
                            ))}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
