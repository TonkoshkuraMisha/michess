// --- FILE: frontend/src/services/masters.ts ---
// Каталог мастеров прошлого (таск 28.5): участники турниров «Машины времени», с каждым можно сыграть отдельную
// партию. Сервер отдаёт ключи и числа; имя и строка о мастере — из каталогов по id (services/timeMachine.ts).
// Эндпоинты (src/api/bots.py, открыты без входа): GET /api/v1/bots/guests — список, GET /api/v1/bots/guests/{id} —
// характер одного мастера. Сами мастера описаны на сервере в src/services/bots/guests.py.

import {API_BASE_URL} from '../config/api';
import {UiError, readApiErrorOr} from './apiErrors';
import type {MessageKey} from '../i18n';
import type {PersonalityConfig} from './personalities';

/** Мастер прошлого в каталоге соперников. */
export interface Master {
    id: string;
    /** Имя для PGN и архива: «Фамилия, Имя» латиницей. */
    pgn_name: string;
    /** Годы жизни «1806–1853»; null — надёжных дат нет. */
    era: string | null;
    /** Сила бота-мастера: задана по историческим оценкам относительно откалиброванных ботов, матчами не измерена. */
    rating: number;
    /** Ключи исторических турниров, в которых мастер играл, по годам. */
    events: string[];
    /** Фирменные дебюты — названия из открытой таблицы дебютов. */
    openings: { white: string[]; black: string[] };
}

/** Цвет игрока в партии с мастером; random — по жребию. */
export type MasterColor = 'white' | 'black' | 'random';

/** Состояние маршрута, с которым доска начинает партию с мастером (Chessboard.tsx). */
export interface MasterGameStart {
    /** Имя на языке игрока — на доске. */
    name: string;
    /** Имя из PGN — под ним партия сохраняется на сервере. */
    savedName: string;
    config: PersonalityConfig;
    color: MasterColor;
}

const BASE = `${API_BASE_URL}/api/v1/bots/guests`;

async function call<T>(url: string, fallback: MessageKey): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new UiError(await readApiErrorOr(res, fallback));
    return res.json() as Promise<T>;
}

/** Все мастера каталога (GET /bots/guests); ошибка — UiError с текстом masters.loadFailed. */
export const getMasters = () =>
    call<{ guests?: Master[] }>(BASE, 'masters.loadFailed').then((r) => r.guests ?? []);

/** Характер мастера — тот же, с которым он играет в историческом турнире. */
export const getMasterConfig = (id: string) =>
    call<{ id: string; pgn_name: string; rating: number; config: PersonalityConfig }>(
        `${BASE}/${encodeURIComponent(id)}`, 'masters.startFailed');

/** Порядок списка мастеров — см. sortMasters. */
export type MasterOrder = 'strength' | 'years' | 'name';

/** Год рождения; null — годы жизни неизвестны. */
export function birthYear(master: Pick<Master, 'era'>): number | null {
    const year = master.era ? Number.parseInt(master.era, 10) : Number.NaN;
    return Number.isFinite(year) ? year : null;
}

/** Порядок списка: по силе (сильные первыми), по годам жизни (старшие первыми, без дат — в конце) или по имени. */
export function sortMasters(list: Master[], order: MasterOrder, nameOf: (master: Master) => string, locale?: string): Master[] {
    const byName = (a: Master, b: Master) => nameOf(a).localeCompare(nameOf(b), locale);
    return [...list].sort((a, b) => {
        if (order === 'strength') return b.rating - a.rating || byName(a, b);
        if (order === 'years') {
            const [ya, yb] = [birthYear(a), birthYear(b)];
            if (ya === null || yb === null) return ya === yb ? byName(a, b) : ya === null ? 1 : -1;
            return ya - yb || byName(a, b);
        }
        return byName(a, b);
    });
}

/** Поиск по имени: на языке игрока или латиницей, как в PGN; регистр не важен. */
export function matchesQuery(master: Pick<Master, 'pgn_name'>, name: string, query: string): boolean {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || name.toLocaleLowerCase().includes(needle) || master.pgn_name.toLocaleLowerCase().includes(needle);
}
