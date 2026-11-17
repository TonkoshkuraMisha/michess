// Оформление и «Сообщить о проблеме» в настоящем браузере против полного стека (таски 31.1 и 24.4).
// Тема-комплект меняет фон самой страницы: до 17.11 его закрывал корневой блок приложения, и выбранный узор был
// виден только в превью настроек — юнит-тесты проверяли стиль body, а не то, что видит игрок.

import {expect, test} from '@playwright/test';
import {loginNewPlayer} from './helpers.ts';

test('тема «Осенний парк»: фон страницы виден, выбор переживает перезагрузку', async ({page}) => {
    await page.goto('/settings');
    await page.getByTestId('preset-autumn_park').click();

    // Фон задан на body, а корневой блок приложения его не закрывает.
    const look = async () => await page.evaluate(`(() => {
        const root = document.querySelector('#root > div');
        return {
            image: getComputedStyle(document.body).backgroundImage,
            color: getComputedStyle(document.body).backgroundColor,
            cover: root ? getComputedStyle(root).backgroundColor : 'no root',
            board: localStorage.getItem('michess_board_theme'),
        };
    })()`) as { image: string; color: string; cover: string; board: string | null };
    await expect.poll(async () => (await look()).image).toContain('/assets/patterns/leaves.svg');
    const chosen = await look();
    expect(chosen.color).toBe('rgb(58, 40, 20)');
    expect(chosen.cover).toBe('rgba(0, 0, 0, 0)');
    expect(chosen.board).toBe('autumn');

    // Сам узор отдаётся сервером как картинка, а не как страница-заглушка.
    const tile = await page.request.get('/assets/patterns/leaves.svg');
    expect(tile.ok()).toBe(true);
    expect(tile.headers()['content-type']).toContain('svg');

    await page.reload();
    await expect.poll(async () => (await look()).image).toContain('/assets/patterns/leaves.svg');
    expect((await look()).cover).toBe('rgba(0, 0, 0, 0)');
});

test('сообщить о проблеме: гость отправляет сообщение, сервер его принимает', async ({page}) => {
    await page.goto('/about');
    await page.getByTestId('report-problem-open').click();
    await expect(page.getByTestId('report-problem')).toBeVisible();
    await page.getByTestId('report-problem-text').fill('Сквозная проверка: сообщение гостя со страницы «О проекте».');
    // Адрес страницы уходит вместе с сообщением — он показан в окне.
    await expect(page.getByTestId('report-problem-context')).toContainText('/about');
    const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/v1/beta/feedback') && r.request().method() === 'POST'),
        page.getByTestId('report-problem-send').click(),
    ]);
    expect(response.status()).toBeLessThan(300);
    await expect(page.getByTestId('report-problem-sent')).toBeVisible();
});

test('после прямого захода вошедший игрок сразу видит страницу со своим входом и открывает окно сообщения', async ({page, request}) => {
    await loginNewPlayer(page, request, 'report');
    await page.setViewportSize({width: 1366, height: 768});
    // Прямой заход: вход восстанавливается по cookie до первой страницы — место страницы не остаётся пустым.
    await page.goto('/library');
    await expect(page.getByTestId('session-restoring')).toHaveCount(0);
    await page.getByTestId('report-problem-open').click();
    await expect(page.getByTestId('report-problem')).toBeVisible();
    await expect(page.getByTestId('report-problem-context')).toContainText('/library');
});
