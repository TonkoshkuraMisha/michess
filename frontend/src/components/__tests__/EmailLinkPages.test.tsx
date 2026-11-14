// Страницы ссылок из писем (таск 17.5): подтверждение e-mail и новый пароль.

import {fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ResetPasswordPage, VerifyEmailPage} from '../EmailLinkPages';

const response = (status: number, body: unknown = {}) => ({ok: status < 400, status, json: async () => body}) as Response;

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('ссылки из писем', () => {
    it('подтверждение: токен из адреса уходит один раз, адрес показан', async () => {
        const fetchMock = vi.fn(async () => response(200, {email: 'alice@example.com'}));
        vi.stubGlobal('fetch', fetchMock);
        render(<MemoryRouter initialEntries={['/verify-email?token=abcdefghijkl']}><VerifyEmailPage/></MemoryRouter>);
        expect(await screen.findByRole('status')).toHaveTextContent('Адрес alice@example.com подтверждён');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
            .toEqual({token: 'abcdefghijkl'});
    });

    it('устаревшая ссылка — текст сервера', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response(400, {detail: {code: 'email_link_invalid'}})));
        render(<MemoryRouter initialEntries={['/verify-email?token=abcdefghijkl']}><VerifyEmailPage/></MemoryRouter>);
        expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка недействительна');
    });

    it('новый пароль: проверка длины и совпадения, затем сохранение и выход', async () => {
        const fetchMock = vi.fn(async () => response(204));
        vi.stubGlobal('fetch', fetchMock);
        localStorage.setItem('token', 'old');
        render(<MemoryRouter initialEntries={['/reset-password?token=abcdefghijkl']}><ResetPasswordPage/></MemoryRouter>);
        fireEvent.change(screen.getByLabelText(/Новый пароль \(не короче/), {target: {value: 'short'}});
        fireEvent.click(screen.getByRole('button', {name: 'Сохранить пароль'}));
        expect(screen.getByRole('alert')).toHaveTextContent('не короче 8');
        fireEvent.change(screen.getByLabelText(/Новый пароль \(не короче/), {target: {value: 'brand-new-pass'}});
        fireEvent.change(screen.getByLabelText('Новый пароль ещё раз'), {target: {value: 'brand-new-pass'}});
        fireEvent.click(screen.getByRole('button', {name: 'Сохранить пароль'}));
        expect(await screen.findByRole('status')).toHaveTextContent('Пароль изменён');
        expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
            .toEqual({token: 'abcdefghijkl', new_password: 'brand-new-pass'});
        expect(localStorage.getItem('token')).toBeNull();
    });
});
