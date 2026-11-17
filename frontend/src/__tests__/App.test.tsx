// --- FILE: frontend/src/__tests__/App.test.tsx ---
// Шапка и меню профиля: ни одного элемента управления без действия. Пункт меню появляется только
// вместе с рабочей страницей (ToDo.md, «Правила Части II»).

import {fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import App from '../App';
import {mockFetchRouter} from '../test/mocks';
import {setToken} from '../services/authToken';

vi.mock('../services/gameSocket', () => ({
    gameSocket: {connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), on: vi.fn(), off: vi.fn()},
}));

vi.mock('../services/soundEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/soundEngine')>();
    return {
        ...actual,
        soundEngine: {play: vi.fn(), isMuted: vi.fn(() => false), toggleMute: vi.fn(() => true), setMuted: vi.fn(),
            getSoundSet: vi.fn(() => 'wood'), setSoundSet: vi.fn()},
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

describe('App: просмотр партии на одном экране', () => {
    // Доска и панель с ходами занимают ровно экран: страница не прокручивается, прокручивается список ходов.
    it.each(['/game/5', '/library/game/17321', '/import/game/3'])('%s', (path) => {
        const {container} = renderApp(path);
        expect(container.firstElementChild?.className).toContain('xl:h-dvh');
        expect(screen.getByRole('main').className).toContain('xl:overflow-hidden');
    });

    it('обычная страница прокручивается целиком', () => {
        const {container} = renderApp('/library');
        expect(container.firstElementChild?.className).not.toContain('xl:h-dvh');
    });

    // Фон страницы (узор и палитра, таски 18.1 и 31.1) рисуется на body: корневой блок с собственной заливкой
    // закрывал его целиком, и выбранный фон был виден только в превью настроек.
    it('корневой блок прозрачен: фон страницы виден сквозь него', () => {
        const {container} = renderApp('/library');
        expect(container.firstElementChild?.className).not.toMatch(/(^|\s)bg-/);
    });
});

describe('App: меню в шапке на средних ширинах', () => {
    // На 768–1320 px подписи пунктов скрыты (остаются значки): у каждого пункта должны быть подсказка и доступное
    // имя, а сама подпись — в отдельном элементе, который показывается с ширины, где шапка помещается.
    it('у каждого пункта меню — подсказка, доступное имя и подпись, скрываемая на узкой шапке', () => {
        renderApp('/library');
        const nav = screen.getByRole('navigation');
        const items = [...within(nav).getAllByRole('link'), within(nav).getByRole('button')];
        expect(items).toHaveLength(7);
        for (const item of items) {
            const name = item.getAttribute('aria-label');
            expect(name, item.textContent ?? '').toBeTruthy();
            expect(item.getAttribute('title')).toBe(name);
            const label = within(item).getByText(name!);
            expect(label.className).toMatch(/^hidden min-\[1(320|440)px\]:inline$/);
        }
        // Турниры и таблица лидеров различимы и без подписей: значки у них разные.
        const icon = (name: string) => within(nav).getByRole('link', {name}).querySelector('svg')?.getAttribute('class');
        expect(icon('Турниры')).not.toBe(icon('Лидеры'));
    });

    it('длинное имя игрока в шапке обрезается, а не растягивает её', async () => {
        setToken('jwt');
        renderApp('/library');
        const name = await screen.findByTitle('alice');
        expect(name.className).toContain('truncate');
        expect(name.className).toContain('max-w-[7rem]');
    });
});

describe('App: программа беты (таск 24.4)', () => {
    it('гость открывает «Сообщить о проблеме» из шапки', () => {
        renderApp('/puzzles');
        fireEvent.click(within(screen.getByRole('banner')).getByRole('button', {name: 'Сообщить о проблеме'}));
        expect(screen.getByTestId('report-problem')).toBeInTheDocument();
        expect(screen.getByTestId('report-problem-context')).toHaveTextContent('/puzzles');
        fireEvent.click(screen.getByRole('button', {name: 'Закрыть'}));
        expect(screen.queryByTestId('report-problem')).not.toBeInTheDocument();
    });

    it('вошедший игрок открывает «Сообщить о проблеме» из меню профиля', async () => {
        setToken('test-token');
        renderApp();
        fireEvent.click(await within(screen.getByRole('banner')).findByText('alice'));
        fireEvent.click(screen.getByTestId('report-problem-menu'));
        expect(screen.getByTestId('report-problem')).toBeInTheDocument();
        // Меню профиля при этом закрылось.
        expect(screen.queryByTestId('report-problem-menu')).not.toBeInTheDocument();
        setToken(null);
    });

    it('ссылка-приглашение открывает гостю регистрацию с вписанным кодом', async () => {
        renderApp('/?invite=K7QF2MXN9B');
        expect(await screen.findByTestId('auth-invite')).toHaveValue('K7QF2MXN9B');
        expect(screen.getByRole('heading', {name: 'Регистрация аккаунта'})).toBeInTheDocument();
    });

    it('без приглашения окно входа само не открывается', async () => {
        renderApp('/leaderboard');
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('App: навигация', () => {
    it('в шапке гостя нет элементов без действия', () => {
        renderApp();
        const header = screen.getByRole('banner');

        expectNoDeadControls(header);
        for (const label of ['Обучение', 'Просмотр', 'Инструменты']) {
            expect(within(header).queryByText(label)).not.toBeInTheDocument();
        }
        // «Задачи» вернулись в шапку вместе с разделом (таск 13.3) — это рабочая ссылка.
        expect(within(header).getByText('Задачи').closest('a')?.getAttribute('href')).toBe('/puzzles');
        expect(within(header).queryByTitle('Поиск партии')).not.toBeInTheDocument();
        expect(within(header).queryByTitle('Уведомления')).not.toBeInTheDocument();
    });

    it('в шапке и меню профиля вошедшего игрока нет элементов без действия', async () => {
        setToken('test-token');
        renderApp();
        const header = screen.getByRole('banner');

        fireEvent.click(await within(header).findByText('alice'));
        expect(within(header).getByText('Профиль')).toBeInTheDocument();

        expectNoDeadControls(header);
        expect(within(header).queryByText('Входящие')).not.toBeInTheDocument();
    });

    it('«Настройки» из меню профиля открывают страницу настроек', async () => {
        setToken('test-token');
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
