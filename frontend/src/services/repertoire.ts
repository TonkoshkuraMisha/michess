// --- FILE: frontend/src/services/repertoire.ts ---
// Дебютный репертуар (таск 20.1): /api/v1/repertoires — свои линии за белых или за чёрных, шесть стартовых наборов,
// добавление линий (UCI из начальной позиции или текст PGN), комментарии и удаление хода с ветками за ним.
// Сервер присылает рёбра графа позиций с SAN и ключом позиции после хода — клиент ходит по ним, не вычисляя ключи.
// Маршруты — src/api/repertoire.py; граф — src/services/repertoire.py, повторение по расписанию SM-2 и игра
// против репертуара — repertoire_drill.py, отклонения в сыгранной партии — repertoire_deviations.py. Всё, кроме
// списка стартовых наборов, требует входа; ответ соперника (opponent) закрыт на время партии с человеком.

import {apiRequest} from './http';

export type RepertoireColor = 'white' | 'black';
/** Коды стартовых наборов сервера (src/services/repertoire_starters.py); названия и вводные тексты — в каталоге. */
export const STARTER_IDS = ['italian', 'london', 'open_games', 'queens_gambit', 'caro_kann', 'nimzo_indian'] as const;
export type StarterId = typeof STARTER_IDS[number];

/** Стартовый набор: готовые линии (каждая — ходы UCI из начальной позиции), сторона и уровень. */
export interface Starter {
    id: StarterId;
    color: RepertoireColor;
    level: 'beginner' | 'intermediate' | 'advanced';
    /** Стиль набора (27.10); у старого сервера может не быть. */
    style?: 'attacking' | 'positional';
    lines: string[][];
}

/** Репертуар в списке: moves — число ходов (рёбер) в нём. */
export interface RepertoireSummary {
    id: number;
    name: string;
    color: RepertoireColor;
    /** Из какого стартового набора скопирован; null — собран с нуля. */
    starter: StarterId | null;
    moves: number;
}

/** Ребро графа: ход uci из позиции position ведёт в позицию child. Ключи позиций вычисляет сервер (EPD). */
export interface RepertoireEdge {
    position: string;
    uci: string;
    san: string;
    child: string;
    /** Свой комментарий игрока к ходу; пустая строка — комментария нет. */
    comment: string;
    /** Ход стороны репертуара (а не ответ соперника). */
    mine: boolean;
}

/** Репертуар целиком: все рёбра графа и ключ начальной позиции (root), с которого начинается обход. */
export interface Repertoire {
    id: number;
    name: string;
    color: RepertoireColor;
    starter: StarterId | null;
    root: string;
    moves: RepertoireEdge[];
}

/** Запрос к /api/v1/repertoires через общую обёртку http.ts (токен, JSON, ошибки). */
const call = <T>(path: string, init: RequestInit = {}) => apiRequest<T>(`/repertoires${path}`, init);

const json = (method: string, body: object): RequestInit => ({method, body: JSON.stringify(body)});

// --- Отклонения в партиях (таск 20.3) ---

/** Первое место, где сыгранная партия ушла из одного из репертуаров игрока (по позициям, с учётом перестановок). */
export interface Deviation {
    repertoire_id: number;
    name: string;
    starter: StarterId | null;
    /**
     * you_left — игрок сыграл не свой ход; opponent_new — соперник сыграл ход, которого в репертуаре нет;
     * end — партия дошла до конца подготовленной линии; followed — вся партия прошла по репертуару.
     */
    kind: 'you_left' | 'opponent_new' | 'end' | 'followed';
    /** Полуход партии (с 1); для followed — длина партии. */
    ply: number;
    /** Ход, сыгранный в партии (SAN и UCI), и ходы, которые ждал репертуар (SAN). */
    played: string | null;
    played_uci: string | null;
    expected: string[];
    /** Ходы до позиции отклонения. */
    line: string[];
    position: string;
}

/** «3.» для хода белых, «1…» для хода чёрных — номер хода по полуходу. */
export function moveLabel(ply: number): string {
    return `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'}`;
}

// --- Повторение (таск 20.2) ---

/** Состояние карточки повторения: ещё не показывалась, учится, выучена. */
export type CardStatus = 'new' | 'learning' | 'learned';

/** Счётчики карточек репертуара. Дневную норму новых карточек задаёт сервер (NEW_PER_DAY в repertoire_drill.py). */
export interface DrillStats {
    total: number;
    new: number;
    learning: number;
    learned: number;
    /** Просрочено к повторению сейчас. */
    due: number;
    /** Сколько новых карточек ещё можно взять сегодня. */
    new_left: number;
}

/** Верный ответ карточки — один из своих ходов репертуара в этой позиции. */
export interface DrillAnswerOption {
    uci: string;
    san: string;
    comment: string;
}

/** Карточка «найди свой ход»: позиция репертуара, где ход за игроком; верны все его ходы из неё (answers). */
export interface DrillCard {
    position: string;
    /** Ходы из начальной позиции до карточки. */
    line: string[];
    fen: string;
    answers: DrillAnswerOption[];
    status: CardStatus;
}

/** Итог ответа на карточку: новое состояние и срок следующего повторения по расписанию SM-2 (считает сервер). */
export interface DrillAnswer {
    correct: boolean;
    answers: DrillAnswerOption[];
    status: CardStatus;
    due_at: string | null;
    stats: DrillStats;
}

export const repertoireApi = {
    starters: () => call<{ starters: Starter[] }>('/starters'),
    list: () => call<{ repertoires: RepertoireSummary[] }>(''),
    /** Новый репертуар: пустой (name, color) или копия стартового набора (starter — сторона берётся из него). */
    create: (body: { name?: string; color?: RepertoireColor; starter?: StarterId }) => call<Repertoire>('', json('POST', body)),
    get: (id: number) => call<Repertoire>(`/${id}`),
    rename: (id: number, name: string) => call<{ id: number; name: string }>(`/${id}`, json('PATCH', {name})),
    remove: (id: number) => call<{ deleted: boolean }>(`/${id}`, {method: 'DELETE'}),
    /** Добавить линию (UCI из начальной позиции) или линии из PGN; added — сколько ходов оказалось новыми. */
    addLine: (id: number, moves: string[]) => call<Repertoire & { added: number }>(`/${id}/lines`, json('POST', {moves})),
    importPgn: (id: number, pgn: string) => call<Repertoire & { added: number }>(`/${id}/pgn`, json('POST', {pgn})),
    comment: (id: number, position: string, uci: string, comment: string) =>
        call<{ comment: string }>(`/${id}/comment`, json('PUT', {position, uci, comment})),
    /** Убрать ход и ветки за ним — кроме позиций, в которые можно прийти другим порядком ходов. */
    removeMove: (id: number, position: string, uci: string) =>
        call<Repertoire & { removed: number }>(`/${id}/remove`, json('POST', {position, uci})),
    /** Карточки сессии: review — по расписанию и новые в пределах дневной нормы, learn — новые линии. */
    drill: (id: number, mode: 'review' | 'learn') => call<{ stats: DrillStats; cards: DrillCard[] }>(`/${id}/drill?mode=${mode}`),
    /** retry — повтор карточки после ошибки в той же сессии: расписание он не меняет. */
    answer: (id: number, position: string, uci: string, retry: boolean) =>
        call<DrillAnswer>(`/${id}/drill/answer`, json('POST', {position, uci, retry})),
    /** Поставить карточку позиции в сегодняшнее повторение (кнопка «Потренировать» после партии, таск 20.3). */
    focus: (id: number, position: string) => call<{ ok: boolean }>(`/${id}/drill/focus`, json('POST', {position})),
    /** Отклонения своей законченной партии от репертуаров её цвета. */
    deviations: (gameId: number | string) => call<{ color: RepertoireColor; results: Deviation[] }>(`/game/${gameId}/deviations`),
    /**
     * «Игра против репертуара»: ответ соперника после линии игрока — из ответов репертуара, чаще популярный у
     * людей (по индексу позиций). reply = null — ответов нет, линия пройдена.
     */
    opponent: (id: number, moves: string[]) =>
        call<{ reply: string | null; san: string | null }>(`/${id}/opponent`, json('POST', {moves})),
};

/** Рёбра из позиции: свои ходы — первыми. */
export function edgesFrom(repertoire: Repertoire, position: string): RepertoireEdge[] {
    return repertoire.moves.filter((m) => m.position === position).sort((a, b) => Number(b.mine) - Number(a.mine));
}

/**
 * Где линия (UCI из начальной позиции) выходит из репертуара: ключ последней известной позиции и число ходов линии,
 * которые в репертуаре уже есть. Пока все ходы — по рёбрам, позиция известна без шахматной логики на клиенте.
 */
export function followLine(repertoire: Repertoire, line: string[]): { position: string; known: number } {
    let position = repertoire.root;
    for (let i = 0; i < line.length; i++) {
        const edge = repertoire.moves.find((m) => m.position === position && m.uci === line[i]);
        if (!edge) return {position, known: i};
        position = edge.child;
    }
    return {position, known: line.length};
}
