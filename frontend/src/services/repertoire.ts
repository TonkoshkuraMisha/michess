// Дебютный репертуар (таск 20.1): /api/v1/repertoires — свои линии за белых или за чёрных, шесть стартовых наборов,
// добавление линий (UCI из начальной позиции или текст PGN), комментарии и удаление хода с ветками за ним.
// Сервер присылает рёбра графа позиций с SAN и ключом позиции после хода — клиент ходит по ним, не вычисляя ключи.

import {API_BASE_URL} from '../config/api';
import {readApiErrorOr, UiError} from './apiErrors';
import {uiMessage} from '../i18n';
import {getToken} from './authToken';

export type RepertoireColor = 'white' | 'black';
export const STARTER_IDS = ['italian', 'london', 'open_games', 'queens_gambit', 'caro_kann', 'nimzo_indian'] as const;
export type StarterId = typeof STARTER_IDS[number];

export interface Starter {
    id: StarterId;
    color: RepertoireColor;
    level: 'beginner' | 'intermediate';
    lines: string[][];
}

export interface RepertoireSummary {
    id: number;
    name: string;
    color: RepertoireColor;
    starter: StarterId | null;
    moves: number;
}

export interface RepertoireEdge {
    position: string;
    uci: string;
    san: string;
    child: string;
    comment: string;
    /** Ход стороны репертуара (а не ответ соперника). */
    mine: boolean;
}

export interface Repertoire {
    id: number;
    name: string;
    color: RepertoireColor;
    starter: StarterId | null;
    root: string;
    moves: RepertoireEdge[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1/repertoires${path}`, {
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

const json = (method: string, body: object): RequestInit => ({method, body: JSON.stringify(body)});

export const repertoireApi = {
    starters: () => call<{ starters: Starter[] }>('/starters'),
    list: () => call<{ repertoires: RepertoireSummary[] }>(''),
    create: (body: { name?: string; color?: RepertoireColor; starter?: StarterId }) => call<Repertoire>('', json('POST', body)),
    get: (id: number) => call<Repertoire>(`/${id}`),
    rename: (id: number, name: string) => call<{ id: number; name: string }>(`/${id}`, json('PATCH', {name})),
    remove: (id: number) => call<{ deleted: boolean }>(`/${id}`, {method: 'DELETE'}),
    addLine: (id: number, moves: string[]) => call<Repertoire & { added: number }>(`/${id}/lines`, json('POST', {moves})),
    importPgn: (id: number, pgn: string) => call<Repertoire & { added: number }>(`/${id}/pgn`, json('POST', {pgn})),
    comment: (id: number, position: string, uci: string, comment: string) =>
        call<{ comment: string }>(`/${id}/comment`, json('PUT', {position, uci, comment})),
    removeMove: (id: number, position: string, uci: string) =>
        call<Repertoire & { removed: number }>(`/${id}/remove`, json('POST', {position, uci})),
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
