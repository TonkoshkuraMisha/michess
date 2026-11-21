// Общие шаги E2E-сценариев.

import {expect} from '@playwright/test';
import type {APIRequestContext, Page} from '@playwright/test';

export const PASSWORD = 'e2e-pass-12345';
// На продакшен-стеке API на том же адресе (nginx); против dev-серверов (Vite + uvicorn) — свой адрес: E2E_API_URL.
export const API = process.env.E2E_API_URL ?? '';

/**
 * Игрок для сценария: регистрация и вход до загрузки страницы. Вход — через page.request: он делит cookie с
 * браузерным контекстом страницы, и refresh-cookie (таск 17.5) восстанавливает вход при загрузке. Регистрация
 * ограничена 5 аккаунтами в час с адреса, поэтому сценарии одного прогона (один воркер) делят одного игрока.
 * Возвращает access-токен — для запросов к API из самого сценария.
 */
const players = new Map<string, string>();

export async function loginPage(page: Page, username: string): Promise<string> {
    const response = await page.request.post(`${API}/api/v1/auth/login`, {form: {username, password: PASSWORD}});
    expect(response.ok()).toBe(true);
    return (await response.json()).access_token as string;
}

export async function loginNewPlayer(page: Page, request: APIRequestContext, prefix: string): Promise<string> {
    let username = process.env.E2E_SHARED_PLAYER === '0' ? undefined : players.get('shared');
    if (!username) {
        username = `${prefix}_${Date.now().toString(36)}`;
        expect((await request.post(`${API}/api/v1/auth/register`, {data: {username, password: PASSWORD, accept_terms: true}})).ok()).toBe(true);
        players.set('shared', username);
    }
    return loginPage(page, username);
}

/**
 * Окно «Новая партия» игрового зала (схема владельца 18.11) на шаге «Начать»: соперник — человек или бот, контроль
 * времени — какой выбран. С первого шага, чтобы не зависеть от выбора, запомненного прошлой партией.
 */
export async function openNewGame(page: Page, who: 'human' | 'bot'): Promise<void> {
    await page.getByTestId('new-game-open').click();
    await page.getByTestId('new-game-step-who').click();
    await page.getByTestId(`new-game-who-${who}`).click();
    await page.getByTestId('new-game-next').click();
    await expect(page.getByTestId(`new-game-start-${who}`)).toBeVisible();
}
