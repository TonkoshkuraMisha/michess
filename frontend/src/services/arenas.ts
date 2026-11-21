// --- FILE: frontend/src/services/arenas.ts ---
// Арены — турниры между людьми (таск 17.2): расписание, вход, «Играть» (ожидание пары), таблица, напоминание.
// Все запросы — к /api/v1/arenas (маршруты src/api/arenas.py); правила, очки, статусы и таблицу считает сервер
// (src/services/arena.py), расписание по конференциям — src/services/arena_schedule.py. Клиент только показывает.

import {apiRequest} from './http';

/** closing (33.1): пар больше нет — доигрываются последние партии или идёт время до конца; итоги — в finished. */
export type ArenaStatus = 'scheduled' | 'running' | 'closing' | 'finished';

/**
 * Карточка арены — как её собирает сервер (arena.view в src/services/arena.py). Приходит в списке (GET /arenas),
 * в анонсе лобби (GET /arenas/current) и как основа страницы арены (ArenaDetail).
 */
export interface ArenaInfo {
    id: number;
    /** Ключ слота расписания; null — арена создана не расписанием. */
    schedule_key: string | null;
    /** arena — по времени, swiss — по турам (17.2). */
    format?: 'arena' | 'swiss' | 'match';
    /** Только у швейцарки: всего туров и номер идущего. */
    rounds?: number;
    current_round?: number;
    base_time_ms: number;
    increment_ms: number;
    /** Начало и конец — ISO-время с зоной (UTC); статус сервер вычисляет по ним и по числу идущих партий. */
    starts_at: string;
    ends_at: string;
    status: ArenaStatus;
    /** Число участников: есть в списке и в анонсе, на странице арены его заменяет длина таблицы. */
    players?: number;
    /** В партиях арены доступен «берсерк» (33.3): половина времени без добавки ради лишнего очка за победу. */
    berserk?: boolean;
    /** Последний старт: до него создаются пары (только у формата arena). */
    last_start_at?: string;
    /** Идущих партий арены — итоги ждут их. */
    open_games?: number;
    /** Деление при переполнении (33.2): 1 — основное. */
    division?: number;
    /** Основная арена, от которой отделено это деление; null — это и есть основная. */
    parent_id?: number | null;
    /** Конференция, по расписанию которой идёт арена (33.4): central | western | northern | southern | eastern. */
    conference?: string | null;
    /** Матч конференций: конференция-гость (хозяин — conference). */
    opponent_conference?: string | null;
    /** Вечерняя арена 5+3 — главная арена дня своей конференции (33.4). */
    evening?: boolean;
}

/** Ключи пяти конференций — те же, что на сервере (src/services/conferences.py); названия — каталог conferences. */
export const CONFERENCES = ['central', 'western', 'northern', 'southern', 'eastern'] as const;
export type ConferenceKey = typeof CONFERENCES[number];

/** Строка сервера → ключ конференции; null — пусто или ключ, которого клиент не знает (сервер новее). */
export function conferenceKey(value: string | null | undefined): ConferenceKey | null {
    return (CONFERENCES as readonly string[]).includes(value ?? '') ? value as ConferenceKey : null;
}

/** Строка таблицы арены (arena.standings на сервере): места уже расставлены сервером. */
export interface ArenaStanding {
    place: number;
    username: string;
    /** Очки арены: победа 2, ничья 1; в серии «огня» — вдвое. */
    score: number;
    games: number;
    wins: number;
    /** «Огонь»: серия побед, при которой очки следующей партии удваиваются. */
    fire: boolean;
    /** Рейтинг игрока в контроле арены на момент входа. */
    rating: number;
    /** Перформанс в арене — первый показатель при равенстве очков. */
    performance?: number | null;
    /** Конференция игрока на момент входа в арену (33.6); null — страна в профиле не указана. */
    conference?: string | null;
}

/** Строка зачёта конференций арены (33.6): сумма очков лучших участников конференции. */
export interface ArenaConferenceRow {
    conference: string;
    score: number;
    /** Сколько игроков вошло в зачёт и сколько игроков конференции в арене всего. */
    counted: number;
    players: number;
}

/** Игрок на доске матча конференций: очки — в единицах матча (победа 1, ничья ½). */
export interface MatchSeat {
    username: string;
    rating: number;
    score: number;
}

/**
 * Матч конференций (arena.match_view на сервере): хозяин и гость, счёт, сколько записалось с каждой стороны, открыта ли
 * запись и доски (до старта — предварительный состав по рейтингу).
 */
export interface MatchDetail {
    home: string;
    guest: string;
    home_score: number;
    guest_score: number;
    home_players: number;
    guest_players: number;
    entry_open: boolean;
    boards: { board: number; home: MatchSeat; guest: MatchSeat }[];
}

/** Страница арены (GET /arenas/{id}): карточка, таблица, зачёт конференций и состояние вошедшего игрока. */
export interface ArenaDetail extends ArenaInfo {
    standings: ArenaStanding[];
    conferences?: ArenaConferenceRow[];
    /** Только у матча конференций (format 'match'). */
    match?: MatchDetail | null;
    /**
     * Состояние игрока; null — запрос без входа. waiting — ждёт пару, current_game_id — его идущая партия арены.
     * division_arena_id: игрок в другом делении этой арены — клиент переходит туда (33.2).
     * reminder: игрок просил напомнить о начале этой арены (33.4).
     * podium_place: призовое место 1–3 после окончательных итогов (33.5); null — не призёр или итогов ещё нет.
     * username: имя игрока — по нему экран итогов подсвечивает его строку в таблице.
     */
    me: {
        username?: string;
        joined: boolean; waiting: boolean; current_game_id: number | null; division_arena_id?: number | null;
        reminder?: boolean; podium_place?: number | null;
    } | null;
}

/** Категория контроля лиги (как категории рейтинга). */
export type LeagueCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

/** Строка месячной лиги арен (src/services/arena_league.py): места расставлены сервером. */
export interface LeagueRow {
    place: number;
    username: string;
    /** Сумма очков арен сезона в категории. */
    score: number;
    /** Очки лучшей арены — первый показатель при равенстве суммы. */
    best: number;
    /** В скольких аренах игрок сыграл хотя бы одну партию. */
    arenas: number;
}

/** Ответ GET /arenas/league: лига сезона «ГГГГ-ММ» в категории; me — строка вошедшего игрока или null. */
export interface ArenaLeague {
    season: string;
    category: LeagueCategory;
    /** Категории, в которых расписание ставит арены, — вкладки лиги. */
    categories: LeagueCategory[];
    /** Сколько игроков в лиге всего (в table — только первые строки). */
    players: number;
    table: LeagueRow[];
    me: LeagueRow | null;
}

/** Запрос к /api/v1/arenas через общую обёртку http.ts (токен, JSON, ошибки). */
const call = <T>(path: string, init: RequestInit = {}) => apiRequest<T>(`/arenas${path}`, init);

/** Эндпоинты арен. list, current, get и league открыты без входа; остальные требуют токен. */
export const arenasApi = {
    /** Идущие, ближайшие (на 6 часов вперёд) и недавно законченные арены. */
    list: () => call<{ arenas: ArenaInfo[] }>(''),
    /** Анонс для лобби: идущая арена с наибольшим числом игроков, иначе ближайшая по началу; null — арен нет. */
    current: () => call<{ arena: ArenaInfo | null }>('/current'),
    get: (id: number) => call<ArenaDetail>(`/${id}`),
    /** Месячная лига арен текущего сезона в категории контроля. */
    league: (category: LeagueCategory) => call<ArenaLeague>(`/league?category=${category}`),
    /** arena_id — деление, куда попал игрок (при переполнении — не та арена, что запрошена). */
    join: (id: number) => call<{ joined: boolean; arena_id?: number }>(`/${id}/join`, {method: 'POST'}),
    /** «Играть»: либо сразу пара (game_id), либо ожидание (waiting) — тогда клиент повторяет запрос. */
    ready: (id: number) => call<{ waiting?: boolean; game_id?: number }>(`/${id}/ready`, {method: 'POST'}),
    /** Уйти из ожидания пары, оставаясь участником арены. */
    leaveWaiting: (id: number) => call<{ waiting: boolean }>(`/${id}/leave-waiting`, {method: 'POST'}),
    /** «Напомнить»: незадолго до начала арены придёт уведомление; forgetReminder — отменить. */
    remind: (id: number) => call<{ reminder: boolean }>(`/${id}/remind`, {method: 'POST'}),
    forgetReminder: (id: number) => call<{ reminder: boolean }>(`/${id}/remind`, {method: 'DELETE'}),
};

/** Контроль времени подписью «минуты+секунды добавки», например «3+2». */
export function controlLabel(a: Pick<ArenaInfo, 'base_time_ms' | 'increment_ms'>): string {
    return `${Math.round(a.base_time_ms / 60000)}+${Math.round(a.increment_ms / 1000)}`;
}

/** Секунд до момента (не меньше нуля). */
export function secondsUntil(iso: string, now = Date.now()): number {
    return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

/** Секунды → «м:сс», а от часа — «ч:мм:сс» (обратный отсчёт до начала и до конца арены). */
export function clock(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
