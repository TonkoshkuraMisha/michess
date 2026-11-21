// Итоги турнира для экрана окончания: строки таблицы (по очкам и на выбывание), сводка игрока, строки арены.

import {describe, expect, it} from 'vitest';
import type {ArenaStanding} from '../arenas';
import {arenaRows, formatPoints, tournamentRows, tournamentStats} from '../tournamentResults';
import type {Tournament} from '../tournaments';

const tr = ((key: string) => key) as never;

const player = (seat: number, kind: 'user' | 'bot', place: number | null, rating: number, eliminated: number | null = null) => ({
    seat, kind, user_id: kind === 'user' ? 1 : null, bot_key: kind === 'bot' ? `morphy` : null, personality_name: `Бот ${seat}`,
    rating, place, eliminated_round: eliminated, config: null,
}) as Tournament['players'][number];

const game = (id: number, white: number, black: number, result: '1-0' | '0-1' | '1/2-1/2' | null) => ({
    id, round: 1, board: id, stage: 'main' as const, white_seat: white, black_seat: black, base_time_ms: 1, increment_ms: 0, result, game_id: null,
});

const base = {
    id: 1, format: 'round_robin', size: 3, status: 'finished', base_time_ms: 1, increment_ms: 0, current_round: 1,
    created_at: '', finished_at: '', my_seat: 2, withdrawn: false,
} as const;

describe('итоги турнира', () => {
    it('очки пишутся с запятой', () => {
        expect(formatPoints(3)).toBe('3');
        expect(formatPoints(2.5)).toBe('2,5');
    });

    it('таблица по местам, свою строку отмечает my_seat', () => {
        const t = {
            ...base,
            players: [player(1, 'bot', 2, 1700), player(2, 'user', 1, 1500), player(3, 'bot', 3, 1600)],
            games: [], standings: [
                {seat: 1, points: 1.5, head_to_head: 0, sonneborn_berger: 0, place: 2},
                {seat: 2, points: 2, head_to_head: 0, sonneborn_berger: 0, place: 1},
                {seat: 3, points: 0.5, head_to_head: 0, sonneborn_berger: 0, place: 3},
            ],
        } as unknown as Tournament;
        const rows = tournamentRows(t, tr, 'misha');
        expect(rows.map((r) => [r.place, r.name, r.rating, r.score, r.mine])).toEqual([
            [1, 'misha', 1500, '2', true], [2, expect.any(String), 1700, '1,5', false], [3, expect.any(String), 1600, '0,5', false],
        ]);
    });

    it('на выбывание: таблицы очков нет — места участников, выбывшие с крестиком', () => {
        const t = {
            ...base, format: 'knockout', size: 2,
            players: [player(1, 'bot', 1, 1700), player(2, 'user', 2, 1500, 1)], games: [], standings: [],
        } as unknown as Tournament;
        const rows = tournamentRows(t, tr);
        expect(rows.map((r) => [r.place, r.score, r.mine])).toEqual([[1, '', false], [2, '×', true]]);
    });

    it('сводка: победы, ничьи, поражения считаются по цвету игрока', () => {
        const t = {
            ...base,
            players: [player(1, 'bot', 2, 1700), player(2, 'user', 1, 1500), player(3, 'bot', 3, 1600)],
            games: [game(1, 2, 1, '1-0'), game(2, 3, 2, '1-0'), game(3, 2, 3, '1/2-1/2'), game(4, 1, 3, null)],
            standings: [{seat: 2, points: 1.5, head_to_head: 0, sonneborn_berger: 0, place: 1}],
        } as unknown as Tournament;
        expect(tournamentStats(t)).toEqual({points: '1,5', wins: 1, draws: 1, losses: 1, rating: 1500});
        expect(tournamentStats({...t, my_seat: null})).toBeNull();
    });

    it('арена: только сыгравшие, своя строка — по имени', () => {
        const standing = (place: number, username: string, games: number): ArenaStanding => ({
            place, username, score: 4, games, wins: 2, fire: false, rating: 1800,
        });
        const rows = arenaRows([standing(1, 'a', 3), standing(2, 'b', 0), standing(3, 'me', 2)], 'me');
        expect(rows.map((r) => [r.name, r.mine])).toEqual([['a', false], ['me', true]]);
    });
});
