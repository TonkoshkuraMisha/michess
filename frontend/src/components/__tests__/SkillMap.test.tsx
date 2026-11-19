// Карта навыков (таск 22.1): показывается только самому игроку, разделы, слабые темы, ошибки, дебюты и курсы.

import {act, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SkillMap} from '../SkillMap';
import type {SkillMapData} from '../../services/skills';
import {setToken} from '../../services/authToken';

const DATA: SkillMapData = {
    username: 'player1', puzzle_rating: 1500,
    sections: 'ABCDEFGHIJKL'.split('').map((s) => ({section: s, attempts: s === 'A' ? 6 : 0, score: s === 'A' ? 100 : null})),
    weakest_themes: [{theme: 'pin', section: 'B', attempts: 5, score: 20}],
    mistakes: {total: 3, fixed: 1, themes: [{theme: 'fork', count: 2}]},
    trainers: [{trainer: 'coord_find', attempts: 2, best: 9, max_level: 1}],
    openings: {repertoires: 1, new: 1, learning: 1, learned: 1},
    endgames: {done: 1, total: 25}, mates: {done: 1, total: 20},
};

beforeEach(() => {
    setToken('jwt');
    vi.stubGlobal('ResizeObserver', class {
        observe() {
        }

        unobserve() {
        }

        disconnect() {
        }
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
});

const view = (username: string) => render(<MemoryRouter><SkillMap username={username}/></MemoryRouter>);

describe('карта навыков', () => {
    it('свой профиль — разделы, слабые темы, ошибки, дебюты, курсы', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => DATA}) as Response));
        await act(async () => view('player1'));
        expect(screen.getByTestId('skill-sections')).toHaveTextContent('A. Двойной удар100%');
        expect(screen.getByTestId('skill-weakest')).toHaveTextContent('Связка20% · 5');
        expect(screen.getByTestId('skill-mistakes')).toHaveTextContent('Позиций из ваших партий: 3, исправлено: 1.');
        expect(screen.getByTestId('skill-openings')).toHaveTextContent('Выучено 1 · в работе 1 · новых 1');
        expect(screen.getByTestId('skill-courses')).toHaveTextContent('Эндшпиль: 1 из 25');
    });

    it('чужой профиль и гость — блока нет', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => DATA}) as Response));
        const {container} = await act(async () => view('someone_else'));
        expect(container).toBeEmptyDOMElement();
        setToken(null);
        const guest = await act(async () => view('player1'));
        expect(guest.container).toBeEmptyDOMElement();
    });
});
