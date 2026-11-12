// Язык интерфейса в настоящем браузере: выбирается по языку браузера, переключается в шапке без
// перезагрузки и запоминается — после перезагрузки страница остаётся на выбранном языке.

import {expect, test} from '@playwright/test';

test.describe('язык интерфейса', () => {
    test('украинский браузер получает украинский интерфейс, выбор английского переживает перезагрузку', async ({browser}) => {
        const context = await browser.newContext({locale: 'uk-UA'});
        const page = await context.newPage();
        await page.goto('/');

        await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
        await expect(page.getByRole('link', {name: 'Гра'})).toBeVisible();
        await expect(page.getByRole('button', {name: 'Увійти'})).toBeVisible();

        await page.getByRole('combobox', {name: 'Мова'}).selectOption('en');
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.getByRole('link', {name: 'Play'})).toBeVisible();
        await expect(page.getByRole('button', {name: 'Log in'})).toBeVisible();

        await page.reload();
        await expect(page.getByRole('link', {name: 'Play'})).toBeVisible();
        await context.close();
    });

    test('браузер на неподдерживаемом языке получает английский', async ({browser}) => {
        const context = await browser.newContext({locale: 'de-DE'});
        const page = await context.newPage();
        await page.goto('/');

        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await page.getByRole('button', {name: 'Log in'}).click();
        await expect(page.getByRole('dialog', {name: 'Log in to michess'})).toBeVisible();
        await context.close();
    });
});
