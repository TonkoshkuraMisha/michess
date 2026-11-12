// --- FILE: frontend/src/config/players.ts ---
// Имена игроков, которые присылает сервер, — на языке игрока. Сервер хранит у ботов нейтральные имена
// (src/api/bots.py): исторический бот — его id («morphy»), общий соперник мастерской — «workshop_opponent»,
// архетип в архиве партий — «archetype:<id>». Обычные имена игроков показываются как есть.

import {hasMessage, t as translateNow, uiMessage} from '../i18n';
import type {I18n, MessageParam} from '../i18n';
import {ARCHETYPE_PREFIX} from './archetypes';
import {HISTORICAL_BOTS} from './champions';
import type {HistoricalBotId} from './champions';

export const WORKSHOP_OPPONENT_USERNAME = 'workshop_opponent';

function historicalBotId(username: string): HistoricalBotId | null {
    const id = username.toLowerCase().replace(/_bot$/, '');
    return id in HISTORICAL_BOTS ? (id as HistoricalBotId) : null;
}

/** Имя игрока как сообщение: подпись бота или архетипа из каталога, иначе — имя как есть. */
export function playerNameMessage(username: string | null | undefined): MessageParam {
    if (!username) return '';
    const botId = historicalBotId(username);
    if (botId) return uiMessage(`bots.profiles.${botId}.playerLabel`);
    if (username === WORKSHOP_OPPONENT_USERNAME) return uiMessage('bots.workshopTitle');
    if (username.startsWith(ARCHETYPE_PREFIX)) {
        const key = `archetypes.${username.slice(ARCHETYPE_PREFIX.length)}.name`;
        if (hasMessage(key)) return uiMessage(key);
    }
    return username;
}

/** Имя игрока для показа на текущем языке компонента (t из useI18n) или на текущем языке приложения. */
export function displayPlayerName(username: string | null | undefined, t: I18n['t'] = translateNow): string {
    const message = playerNameMessage(username);
    if (typeof message !== 'object') return String(message);
    return 'text' in message ? message.text : t(message.key);
}

/** Соперник ступени лестницы: исторический бот — по id, архетип — по id архетипа. */
export function ladderOpponentName(kind: 'historical' | 'archetype', id: string, t: I18n['t'] = translateNow): string {
    if (kind === 'historical') {
        const key = `bots.profiles.${id}.shortName`;
        return hasMessage(key) ? t(key) : id;
    }
    const key = `archetypes.${id}.name`;
    return hasMessage(key) ? t(key) : id;
}
