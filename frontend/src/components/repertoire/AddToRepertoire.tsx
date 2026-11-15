// «В репертуар» (таск 20.1): добавить текущую линию (UCI из начальной позиции) в один из своих репертуаров —
// из «Инструментов» (линия на доске и справочник дебютов) и из просмотра партии (ходы до текущего).

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {BookMarked} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {repertoireApi} from '../../services/repertoire';
import type {RepertoireSummary} from '../../services/repertoire';

export function AddToRepertoire({moves}: { moves: string[] }) {
    const {t, tp} = useI18n();
    const logged = Boolean(getToken());
    const [list, setList] = useState<RepertoireSummary[] | null>(null);
    const [chosen, setChosen] = useState<number | null>(null);
    const [added, setAdded] = useState<number | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!logged) return;
        let alive = true;
        repertoireApi.list()
            .then(({repertoires}) => {
                if (!alive) return;
                setList(repertoires);
                setChosen(repertoires[0]?.id ?? null);
            })
            .catch((err) => alive && setError(errorMessage(err, 'common.networkError')));
        return () => {
            alive = false;
        };
    }, [logged]);

    useEffect(() => setAdded(null), [moves.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!logged) return null;

    const add = async () => {
        if (chosen === null || moves.length === 0) return;
        setBusy(true);
        setError(null);
        try {
            setAdded((await repertoireApi.addLine(chosen, moves)).added);
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-black/30 rounded-lg p-3 flex flex-wrap items-center gap-2 text-sm" data-testid="add-to-repertoire">
            <span className="font-bold text-amber-200 flex items-center gap-1.5"><BookMarked size={16}/> {t('repertoire.addTitle')}</span>
            {list && list.length === 0 && (
                <Link to="/repertoire" className="text-amber-400 hover:underline">{t('repertoire.createFirst')}</Link>
            )}
            {list && list.length > 0 && (
                <>
                    <select value={chosen ?? ''} onChange={(e) => setChosen(Number(e.target.value))} aria-label={t('repertoire.choose')}
                            data-testid="add-to-repertoire-select" className="bg-black/40 rounded px-1 py-0.5 max-w-[14rem]">
                        {list.map((r) => (
                            <option key={r.id} value={r.id}>{r.name || t('repertoire.untitled')} · {t(`repertoire.colors.${r.color}`)}</option>
                        ))}
                    </select>
                    <button type="button" onClick={() => void add()} disabled={busy || moves.length === 0} data-testid="add-to-repertoire-button"
                            className="px-2 py-1 rounded bg-amber-700 text-white font-bold disabled:opacity-50">
                        {t('repertoire.addLine')}
                    </button>
                </>
            )}
            {added !== null && <span className="w-full text-emerald-300" data-testid="add-to-repertoire-result">{tp('repertoire.added', added)}</span>}
            {error && <p role="alert" className="w-full text-rose-300">{renderUiMessage(error, t)}</p>}
        </div>
    );
}
