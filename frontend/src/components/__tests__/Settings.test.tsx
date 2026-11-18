// --- FILE: frontend/src/components/__tests__/Settings.test.tsx ---
// Настройки: оформление и звук сохраняются в браузере, смена пароля отправляет запрос, подменяет
// токен и не даёт серверному закрытию WebSocket разлогинить игрока.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest';
import Settings from '../Settings';
import {gameSocket} from '../../services/gameSocket';
import {soundEngine} from '../../services/soundEngine';
import {getToken, setToken} from '../../services/authToken';
import {setEarnedForTests} from '../../config/unlocks';

vi.mock('../../services/gameSocket', () => ({
    gameSocket: {connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), on: vi.fn(), off: vi.fn()},
}));

vi.mock('../../services/soundEngine', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../services/soundEngine')>();
    let muted = false;
    let soundSet = 'wood';
    return {
        SOUND_SETS: original.SOUND_SETS,
        soundEngine: {
            play: vi.fn(),
            isMuted: vi.fn(() => muted),
            toggleMute: vi.fn(() => {
                muted = !muted;
                return muted;
            }),
            getSoundSet: vi.fn(() => soundSet),
            setSoundSet: vi.fn((id: string) => {
                soundSet = id;
            }),
        },
    };
});

const response = (status: number, body: unknown = {}) =>
    ({ok: status < 400, status, json: async () => body}) as Response;

function renderSettings(props: Partial<React.ComponentProps<typeof Settings>> = {}) {
    const onTokenChange = vi.fn();
    const onLogoutEverywhere = vi.fn();
    render(
        <MemoryRouter>
            <Settings
                token="old-token"
                username="alice"
                onTokenChange={onTokenChange}
                onLogoutEverywhere={onLogoutEverywhere}
                {...props}
            />
        </MemoryRouter>,
    );
    return {onTokenChange, onLogoutEverywhere};
}

function fillPasswords(current: string, next: string, repeat: string = next) {
    fireEvent.change(screen.getByLabelText('Текущий пароль'), {target: {value: current}});
    fireEvent.change(screen.getByLabelText(/Новый пароль \(не короче/), {target: {value: next}});
    fireEvent.change(screen.getByLabelText('Новый пароль ещё раз'), {target: {value: repeat}});
    fireEvent.click(screen.getByRole('button', {name: 'Сменить пароль'}));
}

beforeEach(() => {
    localStorage.clear();
    (gameSocket.disconnect as Mock).mockClear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Settings: оформление и звук', () => {
    it('выбор доски и фигур сохраняется в браузере', () => {
        renderSettings();

        fireEvent.click(screen.getByRole('button', {name: 'Графит'}));
        fireEvent.click(screen.getByRole('button', {name: 'Стаунтон (Турнирный)'}));

        expect(localStorage.getItem('regence_board_theme')).toBe('slate');
        expect(localStorage.getItem('regence_piece_set')).toBe('cburnett');
        expect(screen.getByRole('button', {name: 'Графит'})).toHaveAttribute('aria-pressed', 'true');
    });

    it('переключатель звука меняет состояние и блокирует проверку при выключенном звуке', () => {
        renderSettings();
        const toggle = screen.getByRole('switch');
        expect(toggle).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(toggle);

        expect(soundEngine.toggleMute).toHaveBeenCalled();
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('button', {name: 'Проверить'})).toBeDisabled();
    });

    it('тема-комплект в один клик: все части выбраны, выбор уходит в профиль; ручная смена снимает отметку', async () => {
        const fetchMock = vi.fn(async () => response(200, {}));
        vi.stubGlobal('fetch', fetchMock);
        setToken('old-token');
        setEarnedForTests(['wins_10']);   // мраморная доска открывается за десять побед (таск 18.4)
        renderSettings();
        fireEvent.click(screen.getByTestId('preset-marble_hall'));
        expect(localStorage.getItem('regence_board_theme')).toBe('marble');
        expect(localStorage.getItem('regence_piece_set')).toBe('celtic');
        expect(localStorage.getItem('regence_page_pattern')).toBe('marble');
        expect(soundEngine.setSoundSet).toHaveBeenCalledWith('marble');
        expect(screen.getByTestId('preset-marble_hall')).toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect((fetchMock.mock.calls as unknown as [string, RequestInit][])
            .some(([url, init]) => url.endsWith('/profile/me/settings') && init.body === JSON.stringify({theme_preset: 'marble_hall'}))).toBe(true));
        fireEvent.click(screen.getByRole('button', {name: 'Графит'}));
        expect(screen.getByTestId('preset-marble_hall')).toHaveAttribute('aria-pressed', 'false');
        setToken(null);
    });

    it('отдельная тема для разбора партий: комплект или «как в игре»', () => {
        renderSettings();
        fireEvent.change(screen.getByTestId('analysis-theme'), {target: {value: 'study'}});
        expect(localStorage.getItem('regence_analysis_board_theme')).toBe('leather');
        expect(localStorage.getItem('regence_analysis_piece_set')).toBe('mpchess');
        expect(localStorage.getItem('regence_board_theme')).toBeNull();
        fireEvent.change(screen.getByTestId('analysis-theme'), {target: {value: 'same'}});
        expect(localStorage.getItem('regence_analysis_board_theme')).toBeNull();
    });

    it('настройки доски: показ хода соперника, ввод хода, быстрый ход сохраняются', () => {
        renderSettings();
        fireEvent.click(screen.getByTestId('pref-lastMove-arrow'));
        fireEvent.click(screen.getByTestId('pref-moveInput-click'));
        fireEvent.click(screen.getByTestId('pref-quickMove'));
        fireEvent.click(screen.getByTestId('pref-captured-order'));
        expect(JSON.parse(localStorage.getItem('regence_board_prefs')!)).toMatchObject(
            {lastMove: 'arrow', moveInput: 'click', quickMove: true, captured: 'order'});
        expect(screen.getByTestId('pref-lastMove-arrow')).toHaveAttribute('aria-checked', 'true');
    });

    it('закрытое оформление: видно с условием, выбрать нельзя; после достижения — можно', () => {
        setEarnedForTests([]);
        renderSettings();
        expect(screen.getByTestId('lock-preset-marble_hall')).toHaveTextContent('Откроется за достижение «Десять побед»');
        expect(screen.getByTestId('preset-marble_hall')).toBeDisabled();
        expect(screen.getByTestId('board-marble')).toBeDisabled();
        expect(screen.getByTestId('pieces-lewis')).toHaveAttribute('title', 'Откроется за достижение «Чемпион»');
        fireEvent.click(screen.getByTestId('board-marble'));
        expect(localStorage.getItem('regence_board_theme')).toBeNull();
        act(() => setEarnedForTests(['wins_10', 'tournament_win']));
        expect(screen.getByTestId('board-marble')).not.toBeDisabled();
        expect(screen.getByTestId('pieces-lewis')).not.toBeDisabled();
        setEarnedForTests([]);
    });

    it('набор звуков выбирается отдельно', () => {
        renderSettings();
        // Звук мог остаться выключенным предыдущим тестом (общий мок) — наборы при выключенном звуке недоступны.
        if (screen.getByRole('switch').getAttribute('aria-checked') === 'false') fireEvent.click(screen.getByRole('switch'));
        fireEvent.click(screen.getByRole('button', {name: 'Звонкие'}));
        expect(soundEngine.setSoundSet).toHaveBeenCalledWith('bright');
        expect(screen.getByRole('button', {name: 'Звонкие'})).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('Settings: смена пароля', () => {
    it('успешная смена подменяет токен и заранее отключает WebSocket', async () => {
        const fetchMock = vi.fn(async () => response(200, {access_token: 'new-token', token_type: 'bearer'}));
        vi.stubGlobal('fetch', fetchMock);
        const {onTokenChange} = renderSettings();

        fillPasswords('old-password', 'new-password-1');

        await waitFor(() => expect(onTokenChange).toHaveBeenCalledWith('new-token'));
        expect(getToken()).toBe('new-token');
        expect(screen.getByRole('status')).toHaveTextContent('Пароль изменён');

        const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => !String(url).includes('/profile/me'))[0] as unknown as [string, RequestInit];
        expect(url).toContain('/api/v1/auth/change-password');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer old-token');
        expect(JSON.parse(init.body as string)).toEqual({
            current_password: 'old-password', new_password: 'new-password-1',
        });
        // Иначе закрытие сокета сервером (сессии отозваны) разлогинило бы игрока.
        expect(gameSocket.disconnect).toHaveBeenCalled();
    });

    it('неверный текущий пароль показывает текст сервера и токен не трогает', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response(400, {detail: 'Текущий пароль указан неверно'})));
        const {onTokenChange} = renderSettings();

        fillPasswords('wrong', 'new-password-1');

        expect(await screen.findByRole('alert')).toHaveTextContent('Текущий пароль указан неверно');
        expect(onTokenChange).not.toHaveBeenCalled();
        expect(getToken()).toBeNull();
    });

    it.each([
        ['short', 'short', /не короче 8 символов/],
        ['new-password-1', 'new-password-2', /не совпадают/],
    ])('пароль %s / %s отклоняется до запроса', (next, repeat, message) => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        renderSettings();

        fillPasswords('old-password', next, repeat);

        expect(screen.getByRole('alert')).toHaveTextContent(message);
        // Запрошен только профиль (e-mail для раздела) — смена пароля на сервер не ушла.
        expect((fetchMock.mock.calls as unknown as [string][]).filter(([url]) => !String(url).includes('/profile/me'))).toEqual([]);
    });

    it('кнопка «Выйти на всех устройствах» вызывает выход', () => {
        const {onLogoutEverywhere} = renderSettings();
        fireEvent.click(screen.getByRole('button', {name: 'Выйти на всех устройствах'}));
        expect(onLogoutEverywhere).toHaveBeenCalled();
    });

    it('гостю доступно только оформление', () => {
        renderSettings({token: null, username: null});
        expect(screen.queryByRole('button', {name: 'Сменить пароль'})).not.toBeInTheDocument();
        expect(screen.getByText(/Войдите в аккаунт/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Графит'})).toBeInTheDocument();
    });
});

describe('Settings: мои данные (таск 17.5)', () => {
    it('удаление аккаунта: подтверждение, пароль уходит на сервер, затем выход', async () => {
        const fetchMock = vi.fn(async () => response(204));
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        setToken('old-token');
        const onAccountDeleted = vi.fn();
        renderSettings({onAccountDeleted});
        fireEvent.change(screen.getByTestId('settings-delete-password'), {target: {value: 'secret-pass'}});
        fireEvent.click(screen.getByTestId('settings-delete'));
        await waitFor(() => expect(onAccountDeleted).toHaveBeenCalled());
        const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => !String(url).includes('/profile/me'))[0] as unknown as [string, RequestInit];
        expect(url).toContain('/api/v1/account/delete');
        expect(JSON.parse(String(init.body))).toEqual({password: 'secret-pass'});
        expect(getToken()).toBeNull();
        expect(gameSocket.disconnect).toHaveBeenCalled();
    });

    it('идущая партия — текст сервера, аккаунт не удалён', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response(409, {detail: {code: 'account_in_game'}})));
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const onAccountDeleted = vi.fn();
        renderSettings({onAccountDeleted});
        fireEvent.change(screen.getByTestId('settings-delete-password'), {target: {value: 'secret-pass'}});
        fireEvent.click(screen.getByTestId('settings-delete'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Сначала доиграйте текущую партию');
        expect(onAccountDeleted).not.toHaveBeenCalled();
    });

    it('без пароля кнопка удаления недоступна; выгрузка запрашивает свои данные', async () => {
        const fetchMock = vi.fn(async () => response(200, {format: 1}));
        vi.stubGlobal('fetch', fetchMock);
        URL.createObjectURL = vi.fn(() => 'blob:x');
        URL.revokeObjectURL = vi.fn();
        renderSettings();
        expect(screen.getByTestId('settings-delete')).toBeDisabled();
        fireEvent.click(screen.getByTestId('settings-export'));
        await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
        expect(String(((fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => !String(url).includes('/profile/me'))[0] as unknown as [string])[0])).toContain('/api/v1/account/export');
    });
});

describe('Settings: e-mail (таск 17.5)', () => {
    it('привязка: адрес, пароль и язык уходят на сервер, подсказка про письмо', async () => {
        const fetchMock = vi.fn(async (url: string) => (url.includes('/profile/me')
            ? response(200, {email: null}) : response(202)));
        vi.stubGlobal('fetch', fetchMock);
        renderSettings();
        expect(await screen.findByText('E-mail не привязан.')).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('settings-email-input'), {target: {value: 'alice@example.com'}});
        fireEvent.change(screen.getByTestId('settings-email-password'), {target: {value: 'secret-pass'}});
        fireEvent.click(screen.getByTestId('settings-email-send'));
        expect(await screen.findByText(/Письмо отправлено на alice@example.com/)).toBeInTheDocument();
        const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/account/email')) as unknown as [string, RequestInit];
        expect(JSON.parse(String(call[1].body))).toEqual({email: 'alice@example.com', password: 'secret-pass', language: 'ru'});
    });

    it('привязанный адрес показан, его можно отвязать с паролем', async () => {
        const fetchMock = vi.fn(async (url: string) => (url.includes('/profile/me')
            ? response(200, {email: 'alice@example.com'}) : response(204)));
        vi.stubGlobal('fetch', fetchMock);
        renderSettings();
        expect(await screen.findByText('Привязан: alice@example.com')).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('settings-email-password'), {target: {value: 'secret-pass'}});
        fireEvent.click(screen.getByTestId('settings-email-remove'));
        expect(await screen.findByText('E-mail отвязан.')).toBeInTheDocument();
        expect(screen.getByTestId('settings-email-current').textContent).toBe('E-mail не привязан.');
    });
});
