// Карта навыков (таск 22.1) в своём профиле: решаемость задач по разделам A–L (радар), слабые темы, ошибки в своих
// партиях, дебюты, эндшпиль и маты, тренажёры. Данные личные — GET /api/v1/skills (src/api/skills.py) отдаёт их
// только самому игроку по токену, поэтому блок показывается, только если ответ пришёл про этого же игрока.
// Используется в Profile.tsx.

import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {PolarAngleAxis, PolarGrid, Radar, RadarChart} from 'recharts';
import {Target} from 'lucide-react';
import {hasMessage, useI18n} from '../i18n';
import type {MessageKey} from '../i18n';
import {fetchSkillMap} from '../services/skills';
import type {SkillMapData} from '../services/skills';

/** Блок карты навыков; пока данных нет или они чужие, ничего не рисует. */
export function SkillMap({username}: { username: string }) {
    const {t} = useI18n();
    const [data, setData] = useState<SkillMapData | null>(null);

    useEffect(() => {
        let alive = true;
        fetchSkillMap().then((d) => alive && setData(d));
        return () => {
            alive = false;
        };
    }, [username]);

    if (!data || data.username !== username) return null;
    const themeName = (code: string) => {
        const key = `themes.${code}.name`;
        return hasMessage(key) ? t(key as MessageKey) : code;
    };
    const radar = data.sections.map((s) => ({
        axis: s.section, value: s.score ?? 0,
    }));
    const measured = data.sections.filter((s) => s.score !== null);
    const examLevelKey = `exam.levels.${data.exam?.level ?? ''}`;

    return (
        <section className="bg-acacia rounded-lg border-2 border-acacia-dark p-4 flex flex-col gap-3 text-sm" data-testid="skill-map">
            <header className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-lg font-bold text-amber-200 flex items-center gap-1.5"><Target size={18}/> {t('skills.title')}</h2>
                <span className="text-xs text-boxwood/70">{t('skills.private')}</span>
            </header>

            <div className="flex flex-col md:flex-row gap-4 items-start">
                <div className="flex flex-col items-center gap-1 shrink-0">
                    <RadarChart width={240} height={200} data={radar} outerRadius={70}>
                        <PolarGrid stroke="#78350f"/>
                        <PolarAngleAxis dataKey="axis" tick={{fill: '#e7c38b', fontSize: 11}}/>
                        <Radar dataKey="value" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.35} isAnimationActive={false}/>
                    </RadarChart>
                    <span className="text-xs text-boxwood/70">
                        {measured.length ? t('skills.radarHint', {n: measured.length}) : t('skills.noTactics')}
                    </span>
                </div>
                <ul className="flex-1 min-w-0 grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs" data-testid="skill-sections">
                    {data.sections.map((s) => (
                        <li key={s.section} className="flex justify-between gap-2">
                            <span className="truncate">{s.section}. {t(`puzzles.sections.${s.section}` as MessageKey)}</span>
                            <span className="font-mono text-amber-300 shrink-0">{s.score === null ? '—' : `${s.score}%`}</span>
                        </li>
                    ))}
                </ul>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <div className="bg-black/30 rounded p-2 flex flex-col gap-1" data-testid="skill-weakest">
                    <h3 className="font-bold text-amber-200">{t('skills.weakest')}</h3>
                    {data.weakest_themes.length === 0
                        ? <p className="text-xs text-boxwood/70">{t('skills.notEnough')}</p>
                        : data.weakest_themes.map((w) => (
                            <p key={w.theme} className="flex justify-between gap-2 text-xs">
                                <span className="truncate">{themeName(w.theme)}</span>
                                <span className="font-mono text-rose-300 shrink-0">{w.score}% · {w.attempts}</span>
                            </p>
                        ))}
                    <Link to="/puzzles" className="text-xs text-amber-400 hover:underline self-start">{t('skills.trainTactics')}</Link>
                </div>
                <div className="bg-black/30 rounded p-2 flex flex-col gap-1" data-testid="skill-mistakes">
                    <h3 className="font-bold text-amber-200">{t('skills.mistakes')}</h3>
                    <p className="text-xs">{t('skills.mistakesCount', {total: data.mistakes.total, fixed: data.mistakes.fixed})}</p>
                    {data.mistakes.themes.map((m) => (
                        <p key={m.theme} className="flex justify-between gap-2 text-xs">
                            <span className="truncate">{themeName(m.theme)}</span>
                            <span className="font-mono text-amber-300 shrink-0">{m.count}</span>
                        </p>
                    ))}
                </div>
                <div className="bg-black/30 rounded p-2 flex flex-col gap-1" data-testid="skill-openings">
                    <h3 className="font-bold text-amber-200">{t('skills.openings')}</h3>
                    <p className="text-xs">{data.openings.repertoires === 0 ? t('skills.noRepertoire')
                        : t('skills.openingsCount', {learned: data.openings.learned, learning: data.openings.learning, fresh: data.openings.new})}</p>
                    <Link to="/repertoire" className="text-xs text-amber-400 hover:underline self-start">{t('repertoire.title')}</Link>
                </div>
                <div className="bg-black/30 rounded p-2 flex flex-col gap-1" data-testid="skill-courses">
                    <h3 className="font-bold text-amber-200">{t('skills.courses')}</h3>
                    <Link to="/learn/endgames" className="text-xs hover:underline">{t('skills.endgames', {done: data.endgames.done, total: data.endgames.total})}</Link>
                    <Link to="/learn/mates" className="text-xs hover:underline">{t('skills.mates', {done: data.mates.done, total: data.mates.total})}</Link>
                    <Link to="/train" className="text-xs hover:underline">{t('skills.trainers', {n: data.trainers.length})}</Link>
                    <Link to="/exam" className="text-xs hover:underline" data-testid="skill-exam">
                        {data.exam?.overall && hasMessage(examLevelKey)
                            ? t('skills.exam', {level: t(examLevelKey), passed: data.exam.passed, of: data.exam.of})
                            : t('skills.examNone')}
                    </Link>
                </div>
            </div>
        </section>
    );
}
