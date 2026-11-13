// Новые разделы в настоящем браузере против полного стека (таск A.5): турнир с настоящим воркером симуляции, урок
// школы, мастерская соперников и клубная лестница. Тесты юнит-уровня вызывают симуляцию напрямую — здесь её играет
// Celery-воркер очереди simulation, а партию игрока принимает сервер.

import {expect, test} from '@playwright/test';
import type {APIRequestContext, Page} from '@playwright/test';
import {API, loginNewPlayer} from './helpers.ts';

/** Игрок общий для прогона: сдать оставшийся с прошлой попытки турнир, чтобы создать новый. */
async function withdrawActiveTournaments(request: APIRequestContext, token: string) {
    const headers = {Authorization: `Bearer ${token}`};
    const list = await (await request.get(`${API}/api/v1/tournaments`, {headers})).json() as { id: number; status: string }[];
    for (const t of list.filter((item) => item.status === 'active')) {
        await request.post(`${API}/api/v1/tournaments/${t.id}/withdraw`, {headers});
    }
}

async function resign(page: Page) {
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', {name: /Сдаться/}).click();
}

test('турнир: партии ботов играет воркер, своя партия записывается в турнир', async ({page, request}) => {
    test.setTimeout(240_000);
    const token = await loginNewPlayer(page, request, 'tour');
    await withdrawActiveTournaments(request, token);

    await page.goto('/tournaments');
    for (const bot of ['Морфи', 'Филидор', 'Стаунтон']) {
        await page.getByRole('button', {name: new RegExp(`^${bot}`)}).click();
    }
    await page.getByRole('button', {name: 'Создать турнир'}).click();
    await expect(page.getByTestId('tournament-view')).toBeVisible();
    await expect(page.getByTestId('crosstable')).toBeVisible();

    // Партию ботов первого тура доигрывает воркер simulation; страница обновляется сама.
    await expect.poll(async () => page.locator('[data-testid^="tgame-"]').filter({hasText: /1-0|0-1|1\/2-1\/2/}).count(),
        {timeout: 150_000, intervals: [2_000]}).toBeGreaterThan(0);

    await page.getByRole('button', {name: 'Играть мою партию'}).click();
    const back = page.getByTestId('back-to-tournament');
    await expect(back).toBeVisible();
    await resign(page);
    await expect(page.getByText(/Результат записан в турнир/)).toBeVisible();
    await back.click();

    // Тур закрыт партией игрока: в таблице у игрока поражение, тур — второй.
    await expect(page.getByTestId('tournament-status')).toContainText('Тур 2 из 3', {timeout: 30_000});
    await expect(page.getByRole('link', {name: 'Партия'}).first()).toBeVisible();
});

test('урок школы: шаги, неверный ход с откликом, верный ход и ответ соперника', async ({page, request}) => {
    await loginNewPlayer(page, request, 'learn');
    await page.goto('/learn/tactics-double-attack');
    await expect(page.getByTestId('lesson-counter')).toContainText('Шаг 1 из 6');
    await page.getByRole('button', {name: 'Дальше'}).click();
    await page.getByRole('button', {name: 'Дальше'}).click();  // показ можно пропустить

    await expect(page.getByTestId('lesson-counter')).toContainText('Шаг 3 из 6');
    const cell = (sq: string) => page.locator(`[data-square="${sq}"]`).first();
    await cell('d5').click();
    await cell('f6').click();
    await expect(page.getByTestId('lesson-feedback')).toContainText('пешка g7 просто берёт коня');
    await cell('d5').click();
    await cell('e7').click();
    await expect(page.getByTestId('lesson-feedback')).toContainText('Шах и нападение на ферзя');
    await expect(page.getByText('Теперь продолжите линию.')).toBeVisible();
});

test('мастерская: соперник сохраняется в профиле и играет первым ходом', async ({page, request}) => {
    await loginNewPlayer(page, request, 'shop');
    await page.goto('/');
    await page.getByRole('tab', {name: 'Мастерская'}).click();
    await page.getByRole('button', {name: /^Центровик/}).click();
    await page.getByPlaceholder(/Гамбит/).fill(`E2E${Date.now().toString(36).slice(-4)}`);
    await page.getByRole('button', {name: /Сохранить соперника/}).click();
    await expect(page.getByText('Сохранено в профиле')).toBeVisible();

    await page.getByTestId('personality-workshop').getByRole('button', {name: /Чёрными/}).click();
    // Соперник ходит первым через /bots/custom-move: на доске больше нет начальной позиции белых.
    await expect.poll(async () => page.locator('[data-square="e2"] img, [data-square="d2"] img, [data-square="c2"] img, [data-square="g1"] img').count(),
        {timeout: 30_000}).toBeLessThan(4);
});

test('лестница: партия с соперником, выбранным сервером, итог в статусе', async ({page, request}) => {
    await loginNewPlayer(page, request, 'ladder');
    await page.goto('/');
    await page.getByRole('tab', {name: 'Лестница'}).click();
    await page.getByTestId('ladder-panel').getByRole('button', {name: /Белыми/}).click();
    await expect(page.getByRole('button', {name: /Вернуть ход/})).toBeDisabled();
    await resign(page);
    await expect(page.getByText(/Лестница: рейтинг/)).toBeVisible({timeout: 20_000});
});
