// Отклонения от репертуара в сыгранной партии (таск 20.3) — блок в просмотре своей законченной партии:
// «на 7-м ходу вы отошли от репертуара» (потренировать позицию / открыть в репертуаре) или «соперник сыграл ход,
// которого нет в репертуаре» (добавить ответ). Данные — services/repertoire.ts, GET /repertoires/game/{gameId}/deviations
// (src/services/repertoire_deviations.py). Без входа, в чужой партии и без репертуаров блока нет. Строка
// отклонения (DeviationItem) общая с карточкой «Клубного тренера» в итоге партии (chessboard/CoachCards.tsx);
// сам блок подключён в GameViewer.tsx.

import {useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {BookMarked} from 'lucide-react';
import {useI18n} from '../../i18n';
import {getToken} from '../../services/authToken';
import {moveLabel, repertoireApi} from '../../services/repertoire';
import type {Deviation} from '../../services/repertoire';

// Сколько отклонений показывать в блоке: первые два (по одному на репертуар), чтобы блок не разрастался.
const SHOWN = 2;

/** Блок отклонений партии gameId; ошибка запроса не показывается — блок просто отсутствует. */
export function RepertoireDeviations({gameId}: { gameId: string }) {
    const {t} = useI18n();
    const [results, setResults] = useState<Deviation[]>([]);

    useEffect(() => {
        if (!getToken() || !gameId) return;
        let alive = true;
        repertoireApi.deviations(gameId).then((r) => alive && setResults(r.results)).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [gameId]);

    if (results.length === 0) return null;

    return (
        <section className="bg-black/30 rounded-lg p-3 flex flex-col gap-2 text-sm" data-testid="repertoire-deviations">
            <h3 className="font-bold text-amber-200 flex items-center gap-1.5"><BookMarked size={16}/> {t('repertoire.deviations.title')}</h3>
            {results.slice(0, SHOWN).map((d) => <DeviationItem key={d.repertoire_id} deviation={d}/>)}
        </section>
    );
}

/**
 * Одно отклонение: что произошло и что сделать — потренировать позицию (своя ошибка), добавить ответ (новый ход
 * соперника), открыть линию в репертуаре. Общий для блока в просмотре партии и карточки «Клубного тренера».
 */
export function DeviationItem({deviation: d}: { deviation: Deviation }) {
    const {t} = useI18n();
    const navigate = useNavigate();
    const name = d.name || (d.starter ? t(`repertoire.starters.${d.starter}.name`) : t('repertoire.untitled'));
    const editorLink = (extra: string[] = []) => `/repertoire/${d.repertoire_id}?line=${[...d.line, ...extra].join(',')}`;
    const train = async () => {
        await repertoireApi.focus(d.repertoire_id, d.position).catch(() => undefined);
        navigate(`/repertoire/${d.repertoire_id}/drill`);
    };
    const params = {move: moveLabel(d.ply), played: d.played ?? '', expected: d.expected.join(', '), name};
    return (
        <div className="flex flex-col gap-1.5" data-testid={`deviation-${d.repertoire_id}`}>
            <p>{t(`repertoire.deviations.${d.kind === 'you_left' ? 'youLeft' : d.kind === 'opponent_new' ? 'opponentNew' : d.kind}`, params)}</p>
            <div className="flex flex-wrap gap-2">
                {d.kind === 'you_left' && (
                    <button type="button" onClick={() => void train()} data-testid={`deviation-train-${d.repertoire_id}`}
                            className="px-2 py-1 rounded bg-amber-700 text-white font-bold text-xs">{t('repertoire.deviations.train')}</button>
                )}
                {d.kind === 'opponent_new' && d.played_uci && (
                    <Link to={editorLink([d.played_uci])} data-testid={`deviation-add-${d.repertoire_id}`}
                          className="px-2 py-1 rounded bg-amber-700 text-white font-bold text-xs">{t('repertoire.deviations.addAnswer')}</Link>
                )}
                {d.kind !== 'followed' && (
                    <Link to={editorLink()} className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 text-xs">
                        {t('repertoire.deviations.open')}
                    </Link>
                )}
            </div>
        </div>
    );
}
