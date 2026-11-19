// --- FILE: frontend/src/services/miniGameRooms.ts ---
// Игры тренеров с человеком по сети (таск 19.8): комната на двоих по ссылке. Правила и состояние — на сервере
// (src/services/mini_game_rooms.py, эндпоинты src/api/mini_game_rooms.py, /api/v1/mini-game-rooms); клиент только
// показывает комнату и опрашивает её (get) — о ходе соперника он узнаёт так.
import {apiRequest} from './http';


export type RoomColor = 'white' | 'black';

/** Комната (mini_game_rooms.view на сервере). you — цвет запросившего; null — зритель или гость. */
export interface MiniRoom {
    code: string;
    game_id: string;
    fen: string;
    moves: string[];
    result: '1-0' | '0-1' | '1/2-1/2' | null;
    /** Почему окончена: по правилам игры или сдачей. */
    reason: 'rules' | 'resign' | null;
    /** Растёт с каждым ходом; ход отправляется с той версией, на которой игрок видел позицию. */
    version: number;
    /** Комната «ещё раз» — туда переходят оба игрока. */
    next: string | null;
    white: string | null;
    black: string | null;
    you: RoomColor | null;
    /** Второе место ещё свободно. */
    waiting: boolean;
}

const call = (path: string, init: RequestInit = {}) => apiRequest<MiniRoom>(`/mini-game-rooms${path}`, init);

export const miniRoomsApi = {
    create: (gameId: string, color: RoomColor | 'random' = 'random') =>
        call('', {method: 'POST', body: JSON.stringify({game_id: gameId, color})}),
    get: (code: string) => call(`/${code}`),
    join: (code: string) => call(`/${code}/join`, {method: 'POST'}),
    move: (code: string, move: string, version: number) =>
        call(`/${code}/move`, {method: 'POST', body: JSON.stringify({move, version})}),
    resign: (code: string) => call(`/${code}/resign`, {method: 'POST'}),
    rematch: (code: string) => call(`/${code}/rematch`, {method: 'POST'}),
};

/** Ссылка на комнату для соперника. */
export function roomLink(code: string, origin = window.location.origin): string {
    return `${origin}/train/games/room/${code}`;
}
