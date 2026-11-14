// --- FILE: frontend/src/components/__tests__/Settings.test.tsx ---
// Настройки: оформление и звук сохраняются в браузере, смена пароля отправляет запрос, подменяет
// токен и не даёт серверному закрытию WebSocket разлогинить игрока.

import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest';
import Settings from '../Settings';
import {gameSocket} from '../../services/gameSocket';
import {soundEngine} from '../../services/soundEngine';

vi.mock('../../services/gameSocket', () => ({
    gameSocket: {connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), on: vi.fn(), off: vi.fn()},
}));

vi.mock('../../services/soundEngine', () => {
    let muted = false;
    return {
        soundEngine: {
            play: vi.fn(),
            isMuted: vi.fn(() => muted),
            toggleMute: vi.fn(() => {
                muted = !muted;
                return muted;
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

        expect(localStorage.getItem('michess_board_theme')).toBe('slate');
        expect(localStorage.getItem('michess_piece_set')).toBe('cburnett');
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
});

describe('Settings: смена пароля', () => {
    it('успешная смена подменяет токен и заранее отключает WebSocket', async () => {
        const fetchMock = vi.fn(async () => response(200, {access_token: 'new-token', token_type: 'bearer'}));
        vi.stubGlobal('fetch', fetchMock);
        const {onTokenChange} = renderSettings();

        fillPasswords('old-password', 'new-password-1');

        await waitFor(() => expect(onTokenChange).toHaveBeenCalledWith('new-token'));
        expect(localStorage.getItem('token')).toBe('new-token');
        expect(screen.getByRole('status')).toHaveTextContent('Пароль изменён');

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
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
        expect(localStorage.getItem('token')).toBeNull();
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
        expect(fetchMock).not.toHaveBeenCalled();
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
        localStorage.setItem('token', 'old-token');
        const onAccountDeleted = vi.fn();
        renderSettings({onAccountDeleted});
        fireEvent.change(screen.getByTestId('settings-delete-password'), {target: {value: 'secret-pass'}});
        fireEvent.click(screen.getByTestId('settings-delete'));
        await waitFor(() => expect(onAccountDeleted).toHaveBeenCalled());
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain('/api/v1/account/delete');
        expect(JSON.parse(String(init.body))).toEqual({password: 'secret-pass'});
        expect(localStorage.getItem('token')).toBeNull();
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
        expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('/api/v1/account/export');
    });
});
