// Вход и регистрация: формат запросов, сохранение токена, тексты ошибок (неверный пароль,
// лимит попыток, ошибки валидации имени) и переключение режимов.

import {fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import AuthModal from '../AuthModal';

const response = (status: number, body: unknown = {}) =>
    ({ok: status < 400, status, json: async () => body}) as Response;

function stubFetch(reply: Response) {
    const fetchMock = vi.fn(async () => reply);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function fillAndSubmit(username: string, password: string, submitLabel: RegExp) {
    fireEvent.change(screen.getByPlaceholderText('например, string1'), {target: {value: username}});
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {target: {value: password}});
    fireEvent.click(screen.getByRole('button', {name: submitLabel}));
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AuthModal: вход', () => {
    it('отправляет форму OAuth2 и сохраняет токен', async () => {
        const fetchMock = stubFetch(response(200, {access_token: 'jwt-123'}));
        const onSuccess = vi.fn();
        render(<AuthModal onSuccess={onSuccess}/>);

        fillAndSubmit('alice', 'secret-pass', /Войти/);

        await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith('jwt-123'));
        expect(localStorage.getItem('token')).toBe('jwt-123');
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/api\/v1\/auth\/login$/);
        expect(init.method).toBe('POST');
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(String(init.body)).toBe('username=alice&password=secret-pass');
    });

    it('неверный пароль — понятная ошибка, токен не сохраняется', async () => {
        stubFetch(response(401, {detail: 'Incorrect username or password'}));
        const onSuccess = vi.fn();
        render(<AuthModal onSuccess={onSuccess}/>);

        fillAndSubmit('alice', 'wrong', /Войти/);

        expect(await screen.findByText('Неверное имя пользователя или пароль')).toBeInTheDocument();
        expect(onSuccess).not.toHaveBeenCalled();
        expect(localStorage.getItem('token')).toBeNull();
        expect(screen.getByRole('button', {name: /Войти/})).not.toBeDisabled();
    });

    it('лимит попыток — текст сервера, а не «неверный пароль»', async () => {
        stubFetch(response(429, {detail: 'Слишком много попыток входа. Повторите через 60 с'}));
        render(<AuthModal onSuccess={vi.fn()}/>);

        fillAndSubmit('alice', 'secret-pass', /Войти/);

        expect(await screen.findByText('Слишком много попыток входа. Повторите через 60 с')).toBeInTheDocument();
    });

    it('сбой сети показывается пользователю', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('Failed to fetch');
        }));
        render(<AuthModal onSuccess={vi.fn()}/>);

        fillAndSubmit('alice', 'secret-pass', /Войти/);

        expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
    });
});

describe('AuthModal: регистрация', () => {
    function switchToRegistration() {
        fireEvent.click(screen.getByRole('button', {name: 'Нет аккаунта? Зарегистрируйтесь'}));
        expect(screen.getByText('Регистрация аккаунта')).toBeInTheDocument();
    }

    it('после успешной регистрации предлагает войти', async () => {
        const fetchMock = stubFetch(response(201, {id: 1, username: 'alice'}));
        const onSuccess = vi.fn();
        render(<AuthModal onSuccess={onSuccess}/>);
        switchToRegistration();

        fillAndSubmit('alice', 'secret-pass', /Зарегистрироваться/);

        expect(await screen.findByText('Регистрация успешна! Теперь войдите в систему.')).toBeInTheDocument();
        expect(screen.getByText('Вход в michess')).toBeInTheDocument();
        expect(onSuccess).not.toHaveBeenCalled();
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/api\/v1\/auth\/register$/);
        expect(JSON.parse(String(init.body))).toEqual({username: 'alice', password: 'secret-pass'});
    });

    it('ошибки валидации Pydantic показываются текстом, а не [object Object]', async () => {
        stubFetch(response(422, {
            detail: [
                {loc: ['body', 'username'], msg: 'Value error, Имя занято служебным маршрутом', type: 'value_error'},
                {loc: ['body', 'password'], msg: 'Пароль слишком короткий', type: 'value_error'},
            ],
        }));
        render(<AuthModal onSuccess={vi.fn()}/>);
        switchToRegistration();

        fillAndSubmit('me', '123', /Зарегистрироваться/);

        expect(await screen.findByText('Имя занято служебным маршрутом; Пароль слишком короткий')).toBeInTheDocument();
    });

    it('переключение режима сбрасывает ошибку', async () => {
        stubFetch(response(409, {detail: 'Имя уже занято'}));
        render(<AuthModal onSuccess={vi.fn()}/>);
        switchToRegistration();
        fillAndSubmit('alice', 'secret-pass', /Зарегистрироваться/);
        expect(await screen.findByText('Имя уже занято')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: 'Уже есть аккаунт? Войдите'}));

        expect(screen.queryByText('Имя уже занято')).not.toBeInTheDocument();
        expect(screen.getByText('Вход в michess')).toBeInTheDocument();
    });
});

describe('AuthModal: закрытие', () => {
    it('закрывается по Esc, крестику и клику по затемнению, но не по клику внутри окна', () => {
        const onClose = vi.fn();
        const {container} = render(<AuthModal onSuccess={vi.fn()} onClose={onClose}/>);

        fireEvent.mouseDown(screen.getByPlaceholderText('например, string1'));
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.keyDown(window, {key: 'Escape'});
        fireEvent.click(screen.getByRole('button', {name: 'Закрыть'}));
        fireEvent.mouseDown(container.firstChild as Element);
        expect(onClose).toHaveBeenCalledTimes(3);
    });
});

describe('AuthModal: доступность', () => {
    it('окно — модальный диалог с заголовком, меняющимся по режиму', () => {
        render(<AuthModal onSuccess={vi.fn()}/>);
        const dialog = screen.getByRole('dialog', {name: 'Вход в michess'});
        expect(dialog).toHaveAttribute('aria-modal', 'true');

        fireEvent.click(screen.getByRole('button', {name: 'Нет аккаунта? Зарегистрируйтесь'}));
        expect(screen.getByRole('dialog', {name: 'Регистрация аккаунта'})).toBeInTheDocument();
    });
});
