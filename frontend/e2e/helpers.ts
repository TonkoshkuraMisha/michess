// Общие шаги E2E-сценариев.

import {expect} from '@playwright/test';
import type {APIRequestContext, Page} from '@playwright/test';

export const PASSWORD = 'e2e-pass-12345';
// На продакшен-стеке API на том же адресе (nginx); против dev-серверов (Vite + uvicorn) — свой адрес: E2E_API_URL.
export const API = process.env.E2E_API_URL ?? '';

/**
 * Игрок для сценария: регистрация и вход, токен — в localStorage страницы до её загрузки. Регистрация ограничена
 * 5 аккаунтами в час с адреса, поэтому сценарии одного прогона (один воркер) делят одного игрока.
 */
const players = new Map<string, string>();

export async function loginNewPlayer(page: Page, request: APIRequestContext, prefix: string): Promise<string> {
    const shared = process.env.E2E_SHARED_PLAYER === '0' ? null : players.get('shared');
    if (shared) {
        await page.addInitScript((value) => localStorage.setItem('token', value), shared);
        return shared;
    }
    const username = `${prefix}_${Date.now().toString(36)}`;
    expect((await request.post(`${API}/api/v1/auth/register`, {data: {username, password: PASSWORD}})).ok()).toBe(true);
    const response = await request.post(`${API}/api/v1/auth/login`, {form: {username, password: PASSWORD}});
    const {access_token: token} = await response.json();
    players.set('shared', token);
    await page.addInitScript((value) => localStorage.setItem('token', value), token);
    return token;
}
