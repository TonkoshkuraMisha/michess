// Достижения и звание клуба в профиле (таск 17.6).

import {render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Achievements} from '../Achievements';

afterEach(() => vi.unstubAllGlobals());

describe('достижения', () => {
    it('звание, открытые сначала, прогресс у закрытых', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true, json: async () => ({
                title: 'amateur',
                achievements: [
                    {code: 'wins_10', target: 10, progress: 3, earned_at: null, new: false},
                    {code: 'first_game', target: 1, progress: 1, earned_at: '2026-11-15T00:00:00Z', new: true},
                ],
            }),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);
        render(<Achievements username="magnus"/>);
        expect(await screen.findByTestId('club-title')).toHaveTextContent('Любитель');
        expect(String((fetchMock.mock.calls as unknown as [string][])[0][0])).toContain('/profile/magnus/achievements');
        const items = screen.getAllByRole('listitem');
        expect(items[0]).toHaveTextContent('Первая партия');
        expect(items[0]).toHaveTextContent('новое!');
        expect(items[1]).toHaveTextContent('3 из 10');
    });
});
