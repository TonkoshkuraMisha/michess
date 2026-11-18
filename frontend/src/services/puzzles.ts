// --- FILE: frontend/src/services/puzzles.ts ---
// Задачи (таски 13.2–13.3, защитные упражнения 13.6): клиент API. Решение с сервера не приходит — только позиция,
// первый ход соперника и ответы на верные ходы.
// Все запросы — к /api/v1/puzzles и только с входом (маршруты src/api/puzzles.py). Правила считает сервер:
// задачи, рейтинг решателя, забег на время и ступени тем — src/services/puzzles.py; «Ваши ошибки» —
// personal_puzzles.py; защита — defense_drills.py; упражнения-генераторы — generated_drills.py; курс матов —
// mate_course.py. Какой ход решающего сейчас ожидается, сервер хранит в Redis (одна активная задача на игрока).

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

/** Задача для решения: позиция до первого хода соперника. Решения в ней нет. */
export interface PuzzleView {
    id: number;
    fen: string;
    /** Ход соперника (UCI), с которого задача начинается: клиент показывает его, после него ходит решающий. */
    first_move: string;
    rating: number;
    /** Коды тем реестра (src/services/themes.py); названия — в каталоге themes.<код>.name. */
    themes: string[];
    /** Цвет решающего. */
    color: 'white' | 'black';
    /** Сколько ходов должен сделать решающий. */
    solution_length: number;
    daily?: boolean;
    /** Состояние забега на время, если задача выдана в нём. */
    run?: TimedRun;
    /** Тренировка по приёмам: ступень задачи (смешанная подборка — null). */
    stage?: number | null;
}

/**
 * Забег на время (3 или 5 минут): счёт, ошибки и остаток времени считает сервер, клиент только показывает таймер.
 * over — забег окончен: вышло время или набрано три ошибки.
 */
export interface TimedRun {
    run_id: string;
    minutes: number;
    solved: number;
    mistakes: number;
    seconds_left: number;
    over: boolean;
}

/**
 * Прогресс темы после решённой задачи тренировки. Ступень (1–4) пройдена, когда из последних window задач не меньше
 * pass решены чисто — без ошибки и подсказки; оба числа присылает сервер (STAGE_WINDOW и STAGE_PASS).
 */
export interface TrainingProgress {
    theme: string;
    stage: number;
    /** Итоги последних задач ступени строкой, по знаку на задачу (сервер ведёт её в theme_progress.recent). */
    recent: string;
    mastered: boolean;
    /** Этой задачей игрок перешёл на следующую ступень. */
    advanced: boolean;
    window: number;
    pass: number;
}

/** Тема в обзоре тренировки (GET /puzzles/training). */
export interface ThemeOverview {
    code: string;
    section: string;
    stage: number;
    recent: string;
    solved: number;
    mastered: boolean;
    /** Сколько задач темы есть в базе на каждой из четырёх ступеней. */
    available: [number, number, number, number];
    /** Задач хватает на всех ступенях (минимумы темы заданы в реестре тем) — тему можно тренировать. */
    ready: boolean;
}

/** Обзор тренировки по приёмам: прогресс игрока по всем темам реестра. */
export interface TrainingOverview {
    window: number;
    pass: number;
    themes: ThemeOverview[];
}

/** Пример для показа приёма (GET /puzzles/demo): позиция и решение целиком; попыткой это не считается. */
export interface DemoExample {
    fen: string;
    moves: string[];
    color: 'white' | 'black';
}

/** Цели задачи (таск 27.8): итог решения, выводится сервером из тем задачи. */
export const PUZZLE_GOALS = ['mate', 'draw', 'promotion', 'material'] as const;
export type PuzzleGoal = typeof PUZZLE_GOALS[number];

/**
 * Что тренируем: тему (на ступени игрока), раздел (смешанная подборка) или только цель без темы и раздела
 * (смешанная подборка по цели). blind — «без названия темы»: темы задачи скрыты до конца решения.
 */
export interface TrainingTarget {
    theme?: string;
    section?: string;
    blind: boolean;
    goal?: PuzzleGoal;
}

/** «Ваши ошибки» (таск 13.5): позиция перед ошибкой в партии игрока. */
export interface PersonalView {
    id: number;
    /** Партия на сайте или партия с другого сайта (таск 24.1) — заполнено ровно одно. */
    game_id: number | null;
    imported_game_id?: number | null;
    ply: number;
    fen: string;
    previous_move: string | null;
    color: 'white' | 'black';
    themes: string[];
    attempts: number;
    solved_streak: number;
    /** Откуда ошибка: соперник (у бота — его id) и дата партии (таск B.3). */
    opponent?: string | null;
    opponent_is_bot?: boolean;
    played_at?: string | null;
}

/** Ответ на попытку в «Ваших ошибках»: верно ли, лучший ход (solution) и ход, сыгранный в партии (played). */
export interface PersonalAnswer {
    correct: boolean;
    solution: string;
    played: string;
    /** Задача освоена (решена верно два раза подряд) и больше не повторяется. */
    done: boolean;
    solved_streak: number;
    /** Когда задача вернётся на повторение: интервалы 1, 3, 7 и 21 день задаёт сервер. */
    next_due_at: string | null;
}

/** Сводка «Ваших ошибок»: к повторению сейчас, всего в работе, освоено и когда ближайшее повторение. */
export interface PersonalSummary {
    due: number;
    active: number;
    mastered: number;
    next_due_at: string | null;
}

/** Итог задачи: рейтинг решателя до и после (Эло против рейтинга задачи) и серия решённых без ошибок и подсказок. */
export interface PuzzleResult {
    solved: boolean;
    rating_before: number;
    rating_after: number;
    delta: number;
    streak: number;
    themes: string[];
    run: TimedRun | null;
    training?: TrainingProgress | null;
}

/**
 * Ответ на ход решающего. Верный ход — reply: ответный ход соперника (null, если задача решена этим ходом).
 * Первая ошибка завершает задачу: done, и в solution приходит решение целиком. result — только когда done.
 */
export interface MoveResponse {
    correct: boolean;
    done: boolean;
    reply: string | null;
    solution: string[] | null;
    result: PuzzleResult | null;
}

/**
 * Подсказка: первая показывает поле фигуры (from), вторая — и поле хода (to). Подсказки снижают прибавку рейтинга:
 * одна — вдвое, две — до нуля.
 */
export interface HintResponse {
    from: string;
    to: string | null;
    hints_used: number;
}

/** Профиль решателя (GET /puzzles/me): рейтинг задач, число попыток, серия, рекорды забегов и последние попытки. */
export interface PuzzleProfile {
    rating: number;
    games: number;
    streak: number;
    /** Личные рекорды забегов на 3 и 5 минут. */
    best: { '3': number; '5': number };
    history: {
        puzzle_id: number;
        puzzle_rating: number;
        solved: boolean;
        hints_used: number;
        rating_after: number;
        created_at: string | null;
    }[];
}

/** Итог забега на время: счёт, ошибки и личный рекорд на эту длительность (best — уже с учётом этого забега). */
export interface TimedResult {
    score: number;
    mistakes: number;
    minutes: number;
    best: number;
    new_record: boolean;
}

/** Защитные упражнения (таск 13.6): «Что грозит соперник?» и «Не зевни». */
export type DefenseKind = 'threat' | 'blunder';

/** Темы реестра, которые решаются защитными упражнениями, а не задачами базы. */
export const DEFENSE_DRILL_THEMES: Record<string, DefenseKind> = {
    find_the_threat: 'threat',
    blunder_check: 'blunder',
};

/** Защитное упражнение на ступени игрока. Угроза и верные ходы в нём не приходят — только после ответа. */
export interface DefenseDrillView {
    id: number;
    kind: DefenseKind;
    theme: string;
    fen: string;
    color: 'white' | 'black';
    rating: number;
    stage: number;
    /** «Не зевни»: три хода на выбор (UCI). */
    choices: string[];
}

/** Первый этап «Что грозит соперник?»: угадано ли поле; сама угроза (ход соперника, UCI) раскрывается в любом случае. */
export interface DefenseThreatResponse {
    correct: boolean;
    threat: string;
    /** Коды мотивов угрозы — для подписи. */
    motifs: string[];
}

/** Итог защитного упражнения: верные ходы, опровержения неверных и прогресс темы. */
export interface DefenseAnswer {
    correct: boolean;
    /** Решено чисто — такой результат идёт в зачёт ступени. */
    clean: boolean;
    good: string[];
    threat: string | null;
    /** Проигрывающий ход → ответ соперника, который его опровергает. */
    refutations: Record<string, string>;
    motifs: string[];
    training: TrainingProgress;
}

/** Упражнения-генераторы (таск 13.7): матрица «вид × фигура», уровни 1–3. */
export const DRILL_KINDS = ['capture', 'fork', 'check', 'pin', 'safe', 'escape', 'mate1', 'mate2'] as const;
export type DrillKind = typeof DRILL_KINDS[number];
/** Фигура упражнения: ферзь, ладья, слон, конь; x — случайная фигура. */
export const DRILL_PIECES = ['q', 'r', 'b', 'n', 'x'] as const;
export type DrillPiece = typeof DRILL_PIECES[number];

/** Тема реестра → вид упражнения (кнопка в карточке темы «Приёмов»). Та же таблица — THEME_DRILLS сервера. */
export const THEME_DRILLS: Record<string, DrillKind> = {
    hanging_piece: 'capture', fork: 'fork', pin: 'pin', basic_mates: 'mate1',
};

/** Есть ли упражнение для пары «вид × фигура»: нет только связки конём — конь не связывает. */
export function drillSupported(kind: DrillKind, piece: DrillPiece): boolean {
    return !(kind === 'pin' && piece === 'n');
}

/** Упражнение-генератор: позиция строится сервером по таблице seed (data/drills/seeds.json), решение не приходит. */
export interface DrillView {
    /** Ключ упражнения — с ним клиент присылает ответ (POST /puzzles/drills/answer). */
    key: string;
    kind: DrillKind;
    piece: DrillPiece;
    level: number;
    fen: string;
    color: 'white' | 'black';
    /** Фигура, которой решать (q/r/b/n); в «уйти от мата» — любая. */
    piece_type: string | null;
    /** Ходов решающего: мат в 2 — два. */
    moves: number;
    run?: DrillRun;
}

/** Забег упражнений на минуту: счёт и время считает сервер; три ошибки или конец времени — over. */
export interface DrillRun {
    /** Сочетание «вид, фигура, уровень» — по нему ведётся личный рекорд. */
    combo: string;
    solved: number;
    mistakes: number;
    seconds_left: number;
    over: boolean;
}

/** Ответ на ходы упражнения — устроен как MoveResponse задачи; в забеге ещё его состояние (run). */
export interface DrillAnswer {
    correct: boolean;
    done: boolean;
    reply: string | null;
    solution: string[] | null;
    run: DrillRun | null;
}

/** Итог забега упражнений: счёт и личный рекорд сочетания (таблица drill_records). */
export interface DrillRunResult {
    combo: string;
    score: number;
    mistakes: number;
    best: number;
    new_record: boolean;
}

const BASE = `${API_BASE_URL}/api/v1/puzzles`;

/** Запрос к /api/v1/puzzles с токеном; отказ сервера — UiError с текстом по коду ошибки. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${BASE}${path}`, {
            ...init,
            headers: {
                ...(init.body ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

/**
 * Курс матовых конструкций (таск 14.6): конструкции по порядку курса и число задач, найденных для каждой;
 * tasks — сколько задач на конструкцию проходит игрок, exam_size и exam_minutes — размер и время итоговой проверки.
 */
export interface MateCourseOverview {
    tasks: number;
    exam_size: number;
    exam_minutes: number;
    constructions: { code: string; available: number }[];
}

/** План итоговой проверки курса: задачи разных конструкций (тема и номер задачи в её наборе). */
export interface MateExamPlan {
    minutes: number;
    tasks: { theme: string; index: number }[];
}

/**
 * Эндпоинты задач. Задачи курса матов и забега решаются теми же move / hint / giveUp, что и обычные: начатая
 * задача становится активной задачей игрока на сервере, предыдущая незаконченная отменяется.
 */
export const puzzlesApi = {
    mateCourse: () => request<MateCourseOverview>('/course/mates'),
    mateExam: () => request<MateExamPlan>('/course/mates/exam'),
    /** Начать задачу курса: index-я по сложности задача конструкции; рейтинг задач она не меняет. */
    mateTask: (theme: string, index: number) =>
        request<PuzzleView & { course: string; index: number }>(`/course/mates/${encodeURIComponent(theme)}/${index}`),
    /** Задача под рейтинг решателя (и по теме), без недавно решавшихся. */
    next: (theme?: string | null) => request<PuzzleView>(`/next${theme ? `?theme=${encodeURIComponent(theme)}` : ''}`),
    /** Задача дня — одна на всех, по дате UTC. */
    daily: () => request<PuzzleView>('/daily'),
    move: (id: number, move: string) => request<MoveResponse>(`/${id}/move`, {
        method: 'POST', body: JSON.stringify({move}),
    }),
    hint: (id: number) => request<HintResponse>(`/${id}/hint`, {method: 'POST'}),
    /** «Показать решение»: задача засчитывается как нерешённая. */
    giveUp: (id: number) => request<{ solution: string[]; result: PuzzleResult }>(`/${id}/give-up`, {method: 'POST'}),
    me: () => request<PuzzleProfile>('/me'),
    timedStart: (minutes: 3 | 5) => request<TimedRun>('/timed/start', {
        method: 'POST', body: JSON.stringify({minutes}),
    }),
    /** Следующая задача забега: сложнее с каждой решённой; рейтинг решателя задачи забега не меняют. */
    timedNext: () => request<PuzzleView & { run: TimedRun }>('/timed/next'),
    timedFinish: () => request<TimedResult>('/timed/finish', {method: 'POST'}),
    /** Задача тренировки по приёмам (GET /puzzles/train) — см. TrainingTarget. */
    train: (target: TrainingTarget) => {
        const params = new URLSearchParams();
        if (target.theme) params.set('theme', target.theme);
        if (target.section) params.set('section', target.section);
        if (target.blind) params.set('blind', 'true');
        if (target.goal) params.set('goal', target.goal);
        return request<PuzzleView>(`/train?${params.toString()}`);
    },
    training: () => request<TrainingOverview>('/training'),
    personalSummary: () => request<PersonalSummary>('/personal'),
    personalNext: () => request<PersonalView>('/personal/next'),
    personalAnswer: (id: number, move: string) => request<PersonalAnswer>(`/personal/${id}/answer`, {
        method: 'POST', body: JSON.stringify({move}),
    }),
    /** Полуходы партии, из которых сделаны задачи игрока, — для значка в разборе партии. */
    personalPlies: (gameId: number) => request<{ game_id: number; plies: number[] }>(`/personal/game/${gameId}`),
    drillsNext: (kind: DrillKind, piece: DrillPiece, level: number) =>
        request<DrillView>(`/drills/next?kind=${kind}&piece=${piece}&level=${level}`),
    drillsAnswer: (key: string, moves: string[], run = false) => request<DrillAnswer>('/drills/answer', {
        method: 'POST', body: JSON.stringify({key, moves, run}),
    }),
    drillsRunStart: (kind: DrillKind, piece: DrillPiece, level: number) => request<DrillRun>('/drills/run/start', {
        method: 'POST', body: JSON.stringify({kind, piece, level}),
    }),
    drillsRunNext: () => request<DrillView & { run: DrillRun }>('/drills/run/next'),
    drillsRunFinish: () => request<DrillRunResult>('/drills/run/finish', {method: 'POST'}),
    /** Личные рекорды забегов по сочетаниям и таблица «тема → вид упражнения» с сервера. */
    drillsRecords: () => request<{ records: Record<string, number>; themes: Record<string, DrillKind> }>('/drills/records'),
    defenseNext: (kind: DefenseKind) => request<DefenseDrillView>(`/defense/next?kind=${kind}`),
    /** «Что грозит соперник?», первый этап: square — поле фигуры, которая бьёт, или поле удара. */
    defenseThreat: (id: number, square: string) => request<DefenseThreatResponse>(`/defense/${id}/threat`, {
        method: 'POST', body: JSON.stringify({square}),
    }),
    defenseAnswer: (id: number, move: string) => request<DefenseAnswer>(`/defense/${id}/answer`, {
        method: 'POST', body: JSON.stringify({move}),
    }),
    demo: (theme: string) => request<{ theme: string; examples: DemoExample[] }>(
        `/demo?theme=${encodeURIComponent(theme)}`,
    ),
};
