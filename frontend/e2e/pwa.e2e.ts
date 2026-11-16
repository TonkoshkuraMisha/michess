/// <reference lib="dom" />
// Приложение на телефоне (таск 24.2) на продакшен-стеке: манифест с иконками отдаётся nginx с нужным типом,
// сервис-воркер регистрируется и берёт страницу под контроль, без сети вместо ошибки браузера — своя офлайн-страница
// на языке игрока, а со связью — снова сайт.

import {expect, test} from '@playwright/test';

test('манифест и иконки', async ({request}) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    const manifest = await response.json();
    expect(manifest).toMatchObject({start_url: '/', display: 'standalone'});
    const purposes = manifest.icons.map((icon: { purpose: string }) => icon.purpose);
    expect(purposes).toContain('maskable');
    for (const icon of manifest.icons as { src: string; type: string }[]) {
        const file = await request.get(icon.src);
        expect(file.ok(), icon.src).toBe(true);
        expect(file.headers()['content-type'], icon.src).toContain(icon.type);
    }
    const worker = await request.get('/sw.js');
    expect(worker.ok()).toBe(true);
    expect(worker.headers()['cache-control']).toContain('no-cache');
});

test('сервис-воркер и офлайн-страница', async ({page, context}) => {
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe('/');
    // Под контроль воркер берёт страницу после clients.claim(); перезагрузка — наверняка.
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    try {
        await page.goto('/puzzles');
        await expect(page.locator('#offline-title')).toHaveText('Нет связи');
        await expect(page.locator('#offline-retry')).toHaveText('Попробовать ещё раз');
    } finally {
        await context.setOffline(false);
    }
    await page.goto('/puzzles');
    await expect(page.locator('#offline-title')).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty();
});
