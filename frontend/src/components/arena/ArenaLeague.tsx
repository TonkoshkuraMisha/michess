// --- FILE: frontend/src/components/arena/ArenaLeague.tsx ---
// Месячная лига арен (таск 33.5) на странице /arenas: игроки по сумме очков арен месяца в одной категории контроля.
// Таблицу считает сервер (GET /api/v1/arenas/league, src/services/arena_league.py): только арены, без швейцарок,
// вкладки категорий — те, в которых расписание ставит арены. На рейтинг лига не влияет. Вошедший игрок видит свою
// строку под таблицей, даже если он ниже первых мест.

import {useEffect, useState} from 'react';
import {Medal} from 'lucide-react';
import {useI18n} from '../../i18n';
import {arenasApi} from '../../services/arenas';
import type {ArenaLeague as LeagueData, LeagueCategory, LeagueRow} from '../../services/arenas';
import {EmptyState, SegmentedControl, Section} from '../ui';

const DEFAULT_CATEGORY: LeagueCategory = 'blitz';

export function ArenaLeague() {
    const {t} = useI18n();
    const [category, setCategory] = useState<LeagueCategory>(DEFAULT_CATEGORY);
    const [data, setData] = useState<LeagueData | null>(null);

    useEffect(() => {
        let alive = true;
        arenasApi.league(category).then((next) => alive && setData(next)).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [category]);

    const table = data?.table ?? [];
    const categories = data?.categories ?? [];
    const me = data?.me ?? null;
    const meShown = me !== null && table.some((row) => row.username === me.username);

    const line = (row: LeagueRow, own: boolean) => (
        <tr key={`${row.place}-${row.username}`} className={own ? 'text-amber-200 font-bold' : ''}
            data-testid={own ? 'league-me' : `league-row-${row.place}`}>
            <td className="pr-2">{row.place}</td>
            <td className="pr-2 break-all">{row.username}</td>
            <td className="pr-2 text-right">{row.score}</td>
            <td className="pr-2 text-right">{row.best}</td>
            <td className="text-right">{row.arenas}</td>
        </tr>
    );

    return (
        <Section title={t('arenas.league.title')} aside={data ? t('arenas.league.season', {season: data.season}) : undefined}
                 testId="arena-league">
            <p className="text-sm text-boxwood/75">{t('arenas.league.intro')}</p>
            {categories.length > 1 && (
                <SegmentedControl<LeagueCategory> label={t('arenas.league.title')} value={category} onChange={setCategory}
                                  testIdPrefix="league-category"
                                  options={categories.map((id) => ({id, label: t(`ratingCategory.${id}`)}))}/>
            )}
            {table.length === 0 ? (
                <EmptyState icon={<Medal size={28}/>} title={t('arenas.league.empty')} description={t('arenas.league.emptyText')}/>
            ) : (
                <table className="w-full text-sm" data-testid="league-table">
                    <thead>
                        <tr className="text-left text-boxwood/70">
                            <th>#</th><th>{t('arenas.league.player')}</th>
                            <th className="text-right">{t('arenas.score')}</th>
                            <th className="text-right">{t('arenas.league.best')}</th>
                            <th className="text-right">{t('arenas.league.arenas')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {table.map((row) => line(row, row.username === me?.username))}
                        {me && !meShown && line(me, true)}
                    </tbody>
                </table>
            )}
        </Section>
    );
}
