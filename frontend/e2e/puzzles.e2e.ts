// Задачи на настоящем сервере с полной базой (24 530 задач из открытой базы): переход из шапки, выдача задачи,
// ход соперника, «Показать решение» — итог и решение, следующая задача, история и рейтинг решателя.

import {expect, test} from '@playwright/test';

const PASSWORD = 'e2e-pass-12345';

test('задачи: выдача, показ решения, следующая задача и история', async ({page, request}) => {
    const username = `puz_${Date.now().toString(36)}`;
    expect((await request.post('/api/v1/auth/register', {data: {username, password: PASSWORD}})).ok()).toBe(true);
    const login = await request.post('/api/v1/auth/login', {form: {username, password: PASSWORD}});
    const {access_token: token} = await login.json();
    await page.addInitScript((value) => localStorage.setItem('token', value), token);

    await page.goto('/');
    await page.getByRole('banner').getByRole('link', {name: 'Задачи'}).click();
    await expect(page).toHaveURL(/\/puzzles$/);

    await page.getByTestId('puzzle-next').click();
    // Сначала ходит соперник, затем ход решающего.
    await expect(page.getByTestId('puzzle-status')).toContainText('Ваш ход', {timeout: 10_000});
    await expect(page.getByTestId('puzzle-info')).toContainText('Рейтинг задачи');

    await page.getByTestId('puzzle-give-up').click();
    await expect(page.getByTestId('puzzle-outcome')).toContainText('В этот раз нет');
    await expect(page.getByTestId('puzzle-solution')).toContainText('Решение:');
    await expect(page.getByTestId('puzzle-history')).toBeVisible();
    await page.screenshot({path: 'test-results/puzzles-solution.png'});

    await page.getByTestId('puzzle-next').click();
    await expect(page.getByTestId('puzzle-status')).toContainText('Ваш ход', {timeout: 10_000});
    await expect(page.getByTestId('puzzle-profile')).toContainText('решено 1');
});

test('приёмы: объяснение темы, показ на доске и тренировка на ступени', async ({page, request}) => {
    const username = `thm_${Date.now().toString(36)}`;
    expect((await request.post('/api/v1/auth/register', {data: {username, password: PASSWORD}})).ok()).toBe(true);
    const login = await request.post('/api/v1/auth/login', {form: {username, password: PASSWORD}});
    const {access_token: token} = await login.json();
    await page.addInitScript((value) => localStorage.setItem('token', value), token);

    await page.goto('/puzzles');
    await page.getByTestId('puzzle-mode-themes').click();
    await page.getByTestId('training-theme-fork_knight').click();
    await expect(page.getByTestId('theme-card')).toContainText('Вилка конём');
    await page.getByTestId('theme-demo').click();
    await page.getByTestId('demo-next').click();
    await expect(page.getByTestId('demo-caption')).toContainText('Ход соперника');

    await page.getByTestId('theme-train').click();
    await expect(page.getByTestId('puzzle-info')).toContainText('ступень 1');
    await expect(page.getByTestId('puzzle-status')).toContainText('Ваш ход', {timeout: 10_000});
    await page.getByTestId('puzzle-give-up').click();
    await expect(page.getByTestId('training-progress')).toContainText('Ступень 1: чисто решено 0');
    await page.screenshot({path: 'test-results/puzzles-training.png'});
});
