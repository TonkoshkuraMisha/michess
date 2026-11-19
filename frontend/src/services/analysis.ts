// --- FILE: frontend/src/services/analysis.ts ---
// Просмотр и разбор партии: PGN партии (своей — /api/v1/profile/games/{id}/pgn, из библиотеки — /library/games/{id}/pgn,
// импортированной — /imports/games/{id}/pgn) и разбор движком: GET — готовый разбор из кэша, POST — запустить
// (/api/v1/analysis/game/{id}, src/api/analysis.py; у импортированных — /imports/games/{id}/analysis). Разбор — помощь
// движка: во время своей партии с человеком сервер его не даёт (src/api/fair_play.py), клиент лишь показывает отказ.
// Используют GameViewer.tsx (просмотр) и chessboard/GameSummaryPanel.tsx (итог после партии). Запросы — http.ts.

import type {FullGameAnalysisReport} from '../components/gameViewer/viewerModel';
import type {MessageKey} from '../i18n';
import {apiFetch, apiRequest, apiUrl} from './http';

/** Откуда партия: сыгранная на сайте (и архив мастеров), библиотека книг или импорт игрока. */
export type GameSource = 'played' | 'library' | 'imported';

/** Путь PGN партии по её источнику. */
function pgnPath(source: GameSource, id: number | string): string {
    if (source === 'library') return `/library/games/${id}/pgn`;
    if (source === 'imported') return `/imports/games/${id}/pgn`;
    return `/profile/games/${id}/pgn`;
}

/** Путь разбора: у импортированных партий — свой, у остальных — общий разбор движком. */
const analysisPath = (source: GameSource, id: number | string) =>
    (source === 'imported' ? `/imports/games/${id}/analysis` : `/analysis/game/${id}`);

export const analysisApi = {
    /** Адрес PGN для ссылки «скачать». */
    pgnUrl: (source: GameSource, id: number | string) => apiUrl(pgnPath(source, id)),
    /** Текст PGN партии. */
    pgn: async (source: GameSource, id: number | string) => (await apiFetch(pgnPath(source, id), {}, 'viewer.loadFailed')).text(),
    /** Готовый разбор из кэша; нет его или сбой — null (разбор можно запустить кнопкой). */
    cached: (source: GameSource, id: number | string) =>
        apiRequest<FullGameAnalysisReport>(analysisPath(source, id)).catch(() => null),
    /**
     * Запустить разбор; отказ (движок занят, лимит, идёт своя партия) — UiError с текстом по коду сервера.
     * T — какую часть отчёта читает вызывающий (итог партии описывает её своим типом); fallback — текст отказа без кода.
     */
    run: <T = FullGameAnalysisReport>(source: GameSource, id: number | string, fallback: MessageKey = 'viewer.analysisFailed') =>
        apiRequest<T>(analysisPath(source, id), {method: 'POST'}, fallback),
};
