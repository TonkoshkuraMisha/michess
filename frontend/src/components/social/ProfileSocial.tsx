// --- FILE: frontend/src/components/social/ProfileSocial.tsx ---
// Профиль чужого игрока (таск 17.1): в сети ли он, подписка (взаимная — «друзья»), прямой вызов и личное сообщение (30.1). Вызов создаётся на
// главной доске (там открыт сокет и выбран контроль времени): страница передаёт имя через location.state.challenge.

import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {MessageSquare, Swords, UserCheck, UserPlus} from 'lucide-react';
import {useI18n} from '../../i18n';
import {getToken} from '../../services/authToken';
import {socialApi} from '../../services/social';
import type {Relation} from '../../services/social';
import {ReportButton} from './ModerationPage';

export function ProfileSocial({username}: { username: string }) {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [relation, setRelation] = useState<Relation | null>(null);

    useEffect(() => {
        if (!getToken()) return;
        socialApi.relation(username).then(setRelation).catch(() => setRelation(null));
    }, [username]);

    if (!relation || relation.self) return null;

    const toggle = () => (relation.following ? socialApi.unfollow(username) : socialApi.follow(username))
        .then(setRelation).catch(() => undefined);

    return (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3 z-10 text-sm" data-testid="profile-social">
            <span className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${relation.online ? 'bg-emerald-400' : 'bg-stone-600'}`}/>
                {t(relation.online ? 'social.online' : 'social.offline')}
            </span>
            {relation.friends && <span className="text-emerald-300" data-testid="profile-friends">{t('social.friends')}</span>}
            <button type="button" onClick={() => void toggle()} data-testid="profile-follow"
                    className="px-2.5 py-1 rounded bg-black/40 border border-amber-800/60 flex items-center gap-1 hover:border-amber-500">
                {relation.following ? <UserCheck size={14}/> : <UserPlus size={14}/>}
                {t(relation.following ? 'social.unfollow' : 'social.follow')}
            </button>
            <button type="button" onClick={() => navigate('/', {state: {challenge: username}})} data-testid="profile-challenge"
                    className="px-2.5 py-1 rounded bg-amber-700 text-white font-bold flex items-center gap-1">
                <Swords size={14}/> {t('social.challenge')}
            </button>
            <button type="button" onClick={() => navigate(`/messages/${encodeURIComponent(username)}`)} data-testid="profile-message"
                    className="px-2.5 py-1 rounded bg-black/40 border border-amber-800/60 flex items-center gap-1 hover:border-amber-500">
                <MessageSquare size={14}/> {t('dm.write')}
            </button>
            <ReportButton username={username}/>
        </div>
    );
}
