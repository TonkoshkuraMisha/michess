// --- FILE: frontend/src/services/study.ts ---
// Совместный разбор и занятие с тренером (таск 17.3): комната (/api/v1/study) и материалы клуба.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export type ArrowColor = 'green' | 'red' | 'blue' | 'yellow';

export interface StudyBoard {
    fen: string;
    last_move: string | null;
    arrows: { from: string; to: string; color: ArrowColor }[];
    highlights: { square: string; tone: 'light' | 'dark' }[];
    ghost: { square: string; piece: string } | null;
}

export interface StudyQuestion {
    id: string;
    kind: 'move' | 'choice';
    prompt: string;
    options?: string[];
    correct?: number | string[];
    deadline: number;
    revealed: boolean;
}

export interface StudyRoom {
    code: string;
    host: string;
    is_host: boolean;
    version: number;
    board: StudyBoard;
    chat: { from: string; text: string; at: number }[];
    question: StudyQuestion | null;
    participants: string[];
    answers?: Record<string, { name: string; answer: string | number; correct: boolean }>;
    my_answer?: string | number;
}

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

export const studyApi = {
    create: () => call<StudyRoom>('', {method: 'POST'}) as Promise<StudyRoom>,
    poll: (code: string, since: number) => call<StudyRoom>(`/${encodeURIComponent(code)}?since=${since}`),
    setBoard: (code: string, board: StudyBoard) => call<StudyRoom>(`/${code}/board`, json('PUT', board)) as Promise<StudyRoom>,
    chat: (code: string, text: string) => call<StudyRoom>(`/${code}/chat`, json('POST', {text})) as Promise<StudyRoom>,
    ask: (code: string, question: { kind: 'move' | 'choice'; prompt: string; options?: string[]; correct: number | string[]; seconds: number }) =>
        call<StudyRoom>(`/${code}/question`, json('POST', question)) as Promise<StudyRoom>,
    answer: (code: string, answer: string | number) => call<StudyRoom>(`/${code}/answer`, json('POST', {answer})) as Promise<StudyRoom>,
    reveal: (code: string) => call<StudyRoom>(`/${code}/reveal`, {method: 'POST'}) as Promise<StudyRoom>,
    materials: () => call<{ materials: { id: number; title: string; created_at: string }[] }>('/materials'),
    saveMaterial: (title: string, lesson: unknown) =>
        call<{ id: number; title: string }>('/materials', json('POST', {title, lesson})) as Promise<{ id: number; title: string }>,
};
