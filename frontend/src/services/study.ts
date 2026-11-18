// --- FILE: frontend/src/services/study.ts ---
// Совместный разбор и занятие с тренером (таск 17.3): комната (/api/v1/study) и материалы клуба.
// Маршруты — src/api/study.py, только с входом. Комната живёт в Redis (src/services/study_room.py) и рассылки по
// WebSocket не имеет: участники опрашивают её состояние (poll) раз в секунду. Материалы клуба — таблица
// study_materials.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export type ArrowColor = 'green' | 'red' | 'blue' | 'yellow';

/** Доска комнаты: её целиком задаёт ведущий (setBoard), остальные только видят. */
export interface StudyBoard {
    fen: string;
    last_move: string | null;
    arrows: { from: string; to: string; color: ArrowColor }[];
    highlights: { square: string; tone: 'light' | 'dark' }[];
    /** «Призрачная» фигура на поле — пометка ведущего поверх доски; позицию (fen) она не меняет. */
    ghost: { square: string; piece: string } | null;
}

/** Вопрос ведущего: ход на доске (move) или выбор из вариантов (choice), с таймером. */
export interface StudyQuestion {
    id: string;
    kind: 'move' | 'choice';
    prompt: string;
    options?: string[];
    /**
     * Верный ответ: номер варианта или список верных ходов. Участнику сервер отдаёт его только после раскрытия
     * (revealed); ведущий видит всегда.
     */
    correct?: number | string[];
    /** Срок ответа — время сервера в секундах Unix. */
    deadline: number;
    revealed: boolean;
}

/** Состояние комнаты для того, кто спрашивает (study_room.view на сервере). */
export interface StudyRoom {
    code: string;
    host: string;
    is_host: boolean;
    /** Растёт при каждом изменении комнаты: по нему опрос понимает, что нового нет. */
    version: number;
    board: StudyBoard;
    chat: { from: string; text: string; at: number }[];
    question: StudyQuestion | null;
    /** Имена тех, кто недавно опрашивал комнату. */
    participants: string[];
    /** Только ведущему: ответы участников на текущий вопрос (ключ — id игрока строкой). */
    answers?: Record<string, { name: string; answer: string | number; correct: boolean }>;
    /** Только участнику: его собственный ответ на текущий вопрос. */
    my_answer?: string | number;
}

/** Запрос к /api/v1/study с токеном. null — ответ 204: при опросе это значит «версия комнаты не изменилась». */
async function call<T>(path: string, init: RequestInit = {}): Promise<T | null> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/study${path}`, {
            ...init,
            headers: {
                ...(init.body ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (res.status === 204) return null;
    if (!res.ok) throw new UiError(await readApiErrorOr(res, 'common.networkError'));
    return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({method, body: JSON.stringify(body)});

/**
 * Эндпоинты комнаты. setBoard, ask и reveal сервер принимает только от ведущего (код отказа study_host_only),
 * chat и answer — от любого участника. Каждый из них возвращает новое состояние комнаты.
 */
export const studyApi = {
    /** Создать комнату: создатель становится ведущим, code — код комнаты для ссылки-приглашения. */
    create: () => call<StudyRoom>('', {method: 'POST'}) as Promise<StudyRoom>,
    /** Опрос: since — версия, которая уже есть у клиента; null — с тех пор ничего не изменилось. */
    poll: (code: string, since: number) => call<StudyRoom>(`/${encodeURIComponent(code)}?since=${since}`),
    setBoard: (code: string, board: StudyBoard) => call<StudyRoom>(`/${code}/board`, json('PUT', board)) as Promise<StudyRoom>,
    chat: (code: string, text: string) => call<StudyRoom>(`/${code}/chat`, json('POST', {text})) as Promise<StudyRoom>,
    ask: (code: string, question: { kind: 'move' | 'choice'; prompt: string; options?: string[]; correct: number | string[]; seconds: number }) =>
        call<StudyRoom>(`/${code}/question`, json('POST', question)) as Promise<StudyRoom>,
    answer: (code: string, answer: string | number) => call<StudyRoom>(`/${code}/answer`, json('POST', {answer})) as Promise<StudyRoom>,
    /** Раскрыть верный ответ на текущий вопрос всем участникам. */
    reveal: (code: string) => call<StudyRoom>(`/${code}/reveal`, {method: 'POST'}) as Promise<StudyRoom>,
    /** Материалы клуба игрока: занятия, сохранённые как уроки в формате школы (content/lessons/format.ts). */
    materials: () => call<{ materials: { id: number; title: string; created_at: string }[] }>('/materials'),
    saveMaterial: (title: string, lesson: unknown) =>
        call<{ id: number; title: string }>('/materials', json('POST', {title, lesson})) as Promise<{ id: number; title: string }>,
};
