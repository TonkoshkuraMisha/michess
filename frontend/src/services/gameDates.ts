// --- FILE: frontend/src/services/gameDates.ts ---
// Дата партии для списков и просмотра. Берётся из заголовка PGN Date: у исторических партий месяц и день часто
// неизвестны, и «1860.??.??» показывается как «1860»; год неизвестен («????») — даты из PGN нет. Тогда — время
// окончания партии на сервере (finished_at, ISO), в формате «d MMM yyyy» на языке игрока. Сеть не нужна.
// Вызывают Profile.tsx, ChampionGames.tsx и GameViewer.tsx — у каждого свой текст на случай, когда даты нет.

import {format, parseISO} from 'date-fns';
import type {Locale} from 'date-fns';

/** Дата из заголовка PGN без неизвестных частей; null — даты нет или неизвестен год. */
export function pgnDisplayDate(pgnDate: string | null | undefined): string | null {
    if (!pgnDate || pgnDate.includes('????')) return null;
    return pgnDate.replace(/\?/g, '').replace(/\.+$/, '');
}

/** Дата партии для показа: из PGN, иначе из finished_at; null — нет ни той, ни другой. */
export function gameDisplayDate(pgnDate: string | null | undefined, finishedAt: string | null | undefined,
                                locale: Locale): string | null {
    return pgnDisplayDate(pgnDate) ?? (finishedAt ? format(parseISO(finishedAt), 'd MMM yyyy', {locale}) : null);
}
