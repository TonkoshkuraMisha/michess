// --- FILE: frontend/src/__tests__/App.test.tsx ---
// Шапка и меню профиля: ни одного элемента управления без действия. Пункт меню появляется только
// вместе с рабочей страницей (ToDo.md, «Правила Части II»).

import {fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import App from '../App';
import {mockFetchRouter} from '../test/mocks';

vi.mock('../services/gameSocket', () => ({
    gameSocket: {connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), on: vi.fn(), off: vi.fn()},
}));

vi.mock('../services/soundEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/soundEngine')>();
    return {
        ...actual,
        soundEngine: {play: vi.fn(), isMuted: vi.fn(() => false), toggleMute: vi.fn(() => true), setMuted: vi.fn()},
    };
});

const PROFILE = {
    id: 1, username: 'alice', bullet_rating: 1400, blitz_rating: 1500, rapid_rating: 1600,
    classical_rating: 1700, is_cheater: false,
};

function renderApp(path = '/leaderboard') {
    vi.stubGlobal('fetch', mockFetchRouter({
        '/profile/me': () => PROFILE,
        '/profile/leaderboard': () => [],
        '/profile/matchmaking/queue': () => [],
        '/profile/games/live': () => [],
        '/profile/games/my-active': () => ({active: false}),
        '/health': () => ({status: 'healthy'}),
    }));
    return render(
        <MemoryRouter initialEntries={[path]}>
            <App/>
        </MemoryRouter>,
    );
}

/** React хранит пропсы элемента на DOM-узле — так видно, есть ли у кнопки обработчик. */
function hasClickHandler(element: Element): boolean {
    const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps'));
    const props = propsKey ? (element as unknown as Record<string, {onClick?: unknown}>)[propsKey] : undefined;
    return typeof props?.onClick === 'function';
}

function expectNoDeadControls(container: HTMLElement) {
    for (const button of within(container).queryAllByRole('button')) {
        expect(hasClickHandler(button), `кнопка «${button.textContent || button.title}» ничего не делает`).toBe(true);
    }
    for (const link of within(container).queryAllByRole('link')) {
        expect(link.getAttribute('href'), `ссылка «${link.textContent || link.title}» никуда не ведёт`).toBeTruthy();
    }
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('App: навигация', () => {
    it('в шапке гостя нет элементов без действия', () => {
        renderApp();
        const header = screen.getByRole('banner');

        expectNoDeadControls(header);
        for (const label of ['Задачи', 'Обучение', 'Просмотр', 'Инструменты']) {
            expect(within(header).queryByText(label)).not.toBeInTheDocument();
        }
        expect(within(header).queryByTitle('Поиск партии')).not.toBeInTheDocument();
        expect(within(header).queryByTitle('Уведомления')).not.toBeInTheDocument();
    });

    it('в шапке и меню профиля вошедшего игрока нет элементов без действия', async () => {
        localStorage.setItem('token', 'test-token');
        renderApp();
        const header = screen.getByRole('banner');

        fireEvent.click(await within(header).findByText('alice'));
        expect(within(header).getByText('Профиль')).toBeInTheDocument();

        expectNoDeadControls(header);
        expect(within(header).queryByText('Входящие')).not.toBeInTheDocument();
    });

    it('«Настройки» из меню профиля открывают страницу настроек', async () => {
        localStorage.setItem('token', 'test-token');
        renderApp();
        const header = screen.getByRole('banner');

        fireEvent.click(await within(header).findByText('alice'));
        fireEvent.click(within(header).getByRole('button', {name: /Настройки/}));

        expect(await screen.findByRole('heading', {name: 'Настройки'})).toBeInTheDocument();
        expect(screen.getByText('Аккаунт alice')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Сменить пароль'})).toBeInTheDocument();
    });

    it('гость попадает в настройки по ссылке в шапке', () => {
        renderApp();
        fireEvent.click(within(screen.getByRole('banner')).getByTitle('Настройки'));
        expect(screen.getByRole('heading', {name: 'Настройки'})).toBeInTheDocument();
        expect(screen.getByText(/Войдите в аккаунт/)).toBeInTheDocument();
    });
});
