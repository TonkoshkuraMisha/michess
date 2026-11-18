// --- FILE: frontend/src/services/tablebase.ts ---
// Эндшпильные таблицы (таск 14.4): POST /analysis/tablebase — результат позиции для стороны, которая ходит, и её
// лучший ход (им отвечает идеальный защитник). Под правилом честной игры.
// Маршрут — src/api/analysis.py, расчёт — src/services/tablebase.py: сервер спрашивает сервис эндшпильных таблиц
// по адресу TABLEBASE_URL (уходит только позиция), ответ кэшируется в Redis. Позицию, где фигур больше, чем знают
// таблицы, сервер отклоняет кодом tablebase_too_many_pieces. Недоступный сервис таблиц сервер заменяет оценкой
// Stockfish (source: 'engine', dtm и dtz — null, категории maybe-* — спорная оценка); нет и движка —
// tablebase_unavailable. Вердикт тренажёра по ответу — trainerVerdict.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** Лучший ход по таблицам; category, dtm и dtz передаются как есть из ответа сервиса таблиц для этого хода. */
export interface TablebaseMove {
    uci: string;
    san: string;
    category: string | null;
    dtm: number | null;
    dtz: number | null;
}

/** Ответ таблиц по позиции. */
export interface TablebaseProbe {
    /** win | loss | draw | cursed-win | blessed-loss | maybe-win | maybe-loss | unknown — для стороны, которая ходит. */
    category: string | null;
    /** Расстояние до мата (dtm) и до обнуления счётчика 50 ходов (dtz) — в полуходах; null — таблицы не знают. */
    dtm: number | null;
    dtz: number | null;
    /** Лучший ход ходящей стороны (первый в ответе сервиса таблиц); null — ходов в ответе нет. */
    best: TablebaseMove | null;
    /** tablebase — точный ответ таблиц; engine — таблицы недоступны, ответила оценка движка. */
    source: 'tablebase' | 'engine';
}

/**
 * Итог хода игрока в эндшпильном тренажёре по ответу для соперника (он ходит): continue — играем дальше,
 * winLost — выигрыш упущен, drawLost — ничья упущена. По точным таблицам строго: для выигрыша у соперника должен
 * быть проигрыш. По оценке движка партию обрывает только явный вердикт (draw / win), спорная оценка maybe-* —
 * не повод засчитать ошибку.
 */
export function trainerVerdict(probe: TablebaseProbe, winning: boolean): 'continue' | 'winLost' | 'drawLost' {
    const category = probe.category;
    if (probe.source === 'engine') {
        if (winning) return category === 'draw' || category === 'win' ? 'winLost' : 'continue';
        return category === 'win' ? 'drawLost' : 'continue';
    }
    if (winning) return category !== 'loss' ? 'winLost' : 'continue';
    return category === 'win' || category === 'maybe-win' ? 'drawLost' : 'continue';
}

/** Запрос таблиц по позиции (FEN). Отказ сервера, в том числе запрет во время партии, — UiError с текстом по коду. */
export async function probeTablebase(fen: string): Promise<TablebaseProbe> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/analysis/tablebase`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
            body: JSON.stringify({fen}),
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<TablebaseProbe>;
}
