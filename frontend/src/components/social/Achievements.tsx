// --- FILE: frontend/src/components/social/Achievements.tsx ---
// Достижения и звание клуба в профиле (таск 17.6): открытые — с датой, остальные — с прогрессом.
// Данные: GET /api/v1/profile/{имя}/achievements (список, прогресс, звание клуба; считает сервер) напрямую через fetch,
// без токена; признак «это я» — socialApi.relation (services/social.ts). Названия и подсказки — каталоги achievements.*.
// У своих открытых достижений есть кнопка «поделиться»: переход в /feed с готовой карточкой (FeedPage.tsx). Рисуется в Profile.tsx.

import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Award, Lock, Share2} from 'lucide-react';
import {getToken} from '../../services/authToken';
import {socialApi} from '../../services/social';
import {API_BASE_URL} from '../../config/api';
import {useI18n} from '../../i18n';
import type {MessageKey} from '../../i18n';

/** Достижение в ответе сервера: код (ключ каталога), цель и прогресс, дата получения (null — не открыто), метка «новое». */
export interface AchievementItem {
    code: string;
    target: number;
    progress: number;
    earned_at: string | null;
    new: boolean;
}

/** Ответ сервера: звание клуба (ключ каталога achievements.titles.*) и достижения. */
export interface AchievementsData {
    title: string;
    achievements: AchievementItem[];
}

/** Блок достижений профиля: сначала открытые, затем закрытые с прогрессом; для чужого профиля без кнопки «поделиться». */
export function Achievements({username}: { username: string }) {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [data, setData] = useState<AchievementsData | null>(null);
    // Своими открытыми достижениями можно поделиться в ленте (таск 30.2).
    const [own, setOwn] = useState(false);

    useEffect(() => {
        if (!getToken()) return;
        socialApi.relation(username).then((r) => setOwn(r.self)).catch(() => setOwn(false));
    }, [username]);

    useEffect(() => {
        let alive = true;
        fetch(`${API_BASE_URL}/api/v1/profile/${encodeURIComponent(username)}/achievements`)
            .then((res) => (res.ok ? res.json() as Promise<AchievementsData> : null))
            .then((value) => {
                if (alive) setData(value && Array.isArray(value.achievements) ? value : null);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [username]);

    if (!data) return null;
    const earned = data.achievements.filter((a) => a.earned_at);
    const open = data.achievements.filter((a) => !a.earned_at);
    return (
        <section className="bg-acacia-dark border border-amber-900/40 p-3 rounded flex flex-col gap-2" data-testid="achievements">
            <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-bold text-amber-200 flex items-center gap-1.5"><Award size={16}/> {t('achievements.heading')}</h2>
                <span className="text-sm text-amber-300" data-testid="club-title">{t(`achievements.titles.${data.title}` as MessageKey)}</span>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
                {[...earned, ...open].map((a) => (
                    <li key={a.code} data-testid={`ach-${a.code}`}
                        className={`rounded px-2 py-1.5 border ${a.earned_at ? 'border-amber-600/60 bg-amber-900/20' : 'border-amber-950/60 bg-black/20 text-boxwood/60'}`}>
                        <div className="flex items-center gap-1.5 font-bold">
                            {a.earned_at ? <Award size={13} className="text-amber-400"/> : <Lock size={12}/>}
                            {t(`achievements.items.${a.code}.name` as MessageKey)}
                            {a.new && <span className="text-xs text-emerald-300">{t('achievements.new')}</span>}
                            {own && a.earned_at && (
                                <button type="button" aria-label={t('feed.share')} title={t('feed.share')} data-testid={`ach-share-${a.code}`}
                                        onClick={() => navigate('/feed', {state: {attach: {kind: 'achievement', ref: a.code}}})}
                                        className="ml-auto text-amber-300 hover:text-amber-100 font-normal">
                                    <Share2 size={13}/>
                                </button>
                            )}
                        </div>
                        <div className="text-xs">{t(`achievements.items.${a.code}.hint` as MessageKey)}</div>
                        {!a.earned_at && a.target > 1 && (
                            <div className="text-xs mt-0.5">{t('achievements.progress', {n: a.progress, total: a.target})}</div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
