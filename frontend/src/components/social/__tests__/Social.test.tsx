// Игроки и уведомления (таск 17.1): колокольчик, поиск игрока, подписка и вызов в профиле.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {NotificationBell, PlayerSearch} from '../SocialHeader';
import {ProfileSocial} from '../ProfileSocial';

const INBOX = {
    unread: 2,
    items: [
        {id: 2, kind: 'challenge', payload: {from: 'magnus', code: 'abc123', base_time_ms: 300000, increment_ms: 2000, rated: true},
            created_at: '2026-11-15T10:00:00Z', read: false},
        {id: 1, kind: 'tournament_round', payload: {tournament_id: 7, round: 2}, created_at: '2026-11-15T09:00:00Z', read: false},
    ],
};

function Probe() {
    const location = useLocation();
    return <pre data-testid="probe">{location.pathname}{JSON.stringify(location.state)}</pre>;
}

function routes(element: React.ReactNode) {
    return (
        <MemoryRouter initialEntries={['/x']}>
            <Routes>
                <Route path="/x" element={element}/>
                <Route path="*" element={<Probe/>}/>
            </Routes>
        </MemoryRouter>
    );
}

beforeEach(() => {
    setToken('jwt');
    vi.useFakeTimers({shouldAdvanceTime: true});
});
afterEach(() => {
    setToken(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('колокольчик', () => {
    it('счётчик непрочитанных, тексты, отметка прочитанным и переход по уведомлению', async () => {
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({
            ok: true, status: 200,
            json: async () => (String(url).endsWith('/messages/unread') ? {unread: 0}
                : init?.method === 'POST' ? {...INBOX, unread: 0, items: INBOX.items.map((n) => ({...n, read: true}))} : INBOX),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);
        render(routes(<NotificationBell/>));
        expect(await screen.findByTestId('notification-badge')).toHaveTextContent('2');
        await act(async () => fireEvent.click(screen.getByTestId('notification-bell')));
        expect(screen.getByTestId('notification-list')).toHaveTextContent('magnus вызывает вас на партию (5+2)');
        expect(screen.getByTestId('notification-list')).toHaveTextContent('Тур 2: ваша партия готова');
        expect(fetchMock.mock.calls.some(([u, init]) => String(u).endsWith('/notifications/read') && init?.method === 'POST')).toBe(true);
        expect(screen.queryByTestId('notification-badge')).toBeNull();
        fireEvent.click(screen.getByText(/magnus вызывает/));
        expect(screen.getByTestId('probe')).toHaveTextContent('/challenge/abc123');
    });

    it('опрос сервера по таймеру', async () => {
        const fetchMock = vi.fn(async () => ({ok: true, status: 200, json: async () => ({unread: 0, items: []})} as Response));
        vi.stubGlobal('fetch', fetchMock);
        render(routes(<NotificationBell/>));
        await act(async () => undefined);
        const before = fetchMock.mock.calls.length;
        await act(async () => {
            vi.advanceTimersByTime(30_000);
        });
        expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });
});

describe('поиск игрока', () => {
    it('ищет с двух букв, показывает «в сети» и ведёт в профиль', async () => {
        const fetchMock = vi.fn(async () => ({ok: true, status: 200,
            json: async () => ({players: [{username: 'magnus', online: true, blitz_rating: 2800, rapid_rating: 2800}]})} as Response));
        vi.stubGlobal('fetch', fetchMock);
        render(routes(<PlayerSearch/>));
        fireEvent.click(screen.getByTestId('player-search-toggle'));
        fireEvent.change(screen.getByTestId('player-search-input'), {target: {value: 'm'}});
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.change(screen.getByTestId('player-search-input'), {target: {value: 'ma'}});
        await act(async () => {
            vi.advanceTimersByTime(300);
        });
        expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('/social/search?q=ma');
        fireEvent.click(await screen.findByText('magnus'));
        expect(screen.getByTestId('probe')).toHaveTextContent('/profile/magnus');
    });
});

describe('профиль чужого игрока', () => {
    it('подписка переключается, «Вызвать» отправляет на главную доску с именем', async () => {
        const relation = {username: 'magnus', self: false, following: false, followed_by: true, friends: false, online: true};
        vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => ({ok: true, status: 200,
            json: async () => (init?.method === 'POST' ? {...relation, following: true, friends: true} : relation)} as Response)));
        render(routes(<ProfileSocial username="magnus"/>));
        expect(await screen.findByTestId('profile-social')).toHaveTextContent('в сети');
        await act(async () => fireEvent.click(screen.getByTestId('profile-follow')));
        expect(screen.getByTestId('profile-friends')).toHaveTextContent('Вы друзья');
        fireEvent.click(screen.getByTestId('profile-challenge'));
        expect(screen.getByTestId('probe')).toHaveTextContent('/{"challenge":"magnus"}');
    });

    it('свой профиль — блока нет', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200,
            json: async () => ({username: 'me', self: true, following: false, followed_by: false, friends: false, online: true})} as Response)));
        render(routes(<ProfileSocial username="me"/>));
        await act(async () => undefined);
        expect(screen.queryByTestId('profile-social')).toBeNull();
    });
});
