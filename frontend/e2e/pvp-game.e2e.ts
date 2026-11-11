// Полный путь PvP-партии в двух настоящих браузерах: регистрация и вход, вызов по ссылке,
// ходы перетаскиванием с синхронизацией у соперника, мат, итог у обоих, реванш со сменой цвета.
//
// Игроки регистрируются один раз на весь файл: регистрация ограничена 5 аккаунтами в час с IP.

import {expect, test, type Browser, type Page} from '@playwright/test';

const PASSWORD = 'e2e-pass-12345';

function uniqueName(prefix: string): string {
    // 3–30 символов: латиница, цифры, _ (правила регистрации).
    return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

async function newPlayer(browser: Browser, username: string): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');

    await page.getByRole('button', {name: 'Войти'}).click();
    await page.getByRole('button', {name: 'Нет аккаунта? Зарегистрируйтесь'}).click();
    await page.getByPlaceholder('например, string1').fill(username);
    await page.getByPlaceholder('••••••••').fill(PASSWORD);
    await page.getByRole('button', {name: 'Зарегистрироваться'}).click();
    await expect(page.getByText('Регистрация успешна! Теперь войдите в систему.')).toBeVisible();

    // После регистрации форма переключилась на вход с теми же полями.
    await page.locator('form').getByRole('button', {name: 'Войти'}).click();
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.getByText(username).first()).toBeVisible();
    return page;
}

const square = (page: Page, id: string) => page.locator(`[data-square="${id}"]`);
// Фигура — <img alt="wp"> с pointer-events: none: тащим за клетку, наличие проверяем по img.
const pieceOn = (page: Page, id: string) => square(page, id).locator('img[alt]');

async function move(mover: Page, opponent: Page, from: string, to: string) {
    await square(mover, from).dragTo(square(mover, to));
    for (const page of [mover, opponent]) {
        await expect(pieceOn(page, to)).toHaveCount(1);
        await expect(pieceOn(page, from)).toHaveCount(0);
    }
}

async function resign(page: Page) {
    // Сдача подтверждается системным диалогом; Playwright по умолчанию его отклоняет.
    page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe('Вы действительно хотите сдаться?');
        void dialog.accept();
    });
    await page.getByRole('button', {name: 'Сдаться'}).click();
}

async function startFriendGame(creator: Page, acceptor: Page, color: 'white' | 'black') {
    await creator.goto('/');
    await acceptor.goto('/');
    await creator.getByRole('button', {name: 'С другом'}).click();
    await creator.getByRole('button', {name: color === 'white' ? '♔ Белые' : '♚ Чёрные'}).click();
    await creator.getByRole('button', {name: 'Сгенерировать и скопировать ссылку'}).click();
    const link = await creator.locator('input[readonly][value*="/challenge/"]').inputValue();
    expect(link).toMatch(/\/challenge\/[A-Za-z0-9]+$/);

    await acceptor.goto(new URL(link).pathname);
    for (const page of [creator, acceptor]) {
        await expect(page.getByText('Идет рейтинговая партия')).toBeVisible();
    }
    await expect(creator.getByText(`Вы играете ${color === 'white' ? 'Белыми' : 'Чёрными'}`)).toBeVisible();
    await expect(acceptor.getByText(`Вы играете ${color === 'white' ? 'Чёрными' : 'Белыми'}`)).toBeVisible();
}

test.describe.serial('PvP в двух браузерах', () => {
    let alice: Page;
    let bob: Page;

    test.beforeAll(async ({browser}) => {
        alice = await newPlayer(browser, uniqueName('e2e_a'));
        bob = await newPlayer(browser, uniqueName('e2e_b'));
    });

    test.afterAll(async () => {
        await alice?.context().close();
        await bob?.context().close();
    });

    test('вызов по ссылке, мат, итог у обоих и реванш со сменой цвета', async () => {
        await startFriendGame(alice, bob, 'white');

        // «Дурацкий мат»: 1. f3 e5 2. g4 Qh4#
        await move(alice, bob, 'f2', 'f3');
        await move(bob, alice, 'e7', 'e5');
        await move(alice, bob, 'g2', 'g4');
        await move(bob, alice, 'd8', 'h4');

        for (const page of [alice, bob]) {
            await expect(page.getByText('Партия завершена (0-1)')).toBeVisible();
        }

        // Реванш: цвета меняются, новая партия у обоих.
        await alice.getByRole('button', {name: 'Реванш', exact: true}).click();
        await expect(bob.getByText('Соперник предлагает реванш (со сменой цвета)!')).toBeVisible();
        await bob.getByRole('button', {name: 'Принять реванш'}).click();

        for (const page of [alice, bob]) {
            await expect(page.getByText('Идет рейтинговая партия')).toBeVisible();
        }
        await expect(bob.getByText('Вы играете Белыми')).toBeVisible();
        await move(bob, alice, 'e2', 'e4');
        await move(alice, bob, 'e7', 'e5');

        // Доигрываем реванш сдачей (до 2-го полухода вместо неё — «Отменить игру»), чтобы
        // следующий сценарий начался без активной партии.
        await resign(alice);
        for (const page of [alice, bob]) {
            await expect(page.getByText('Партия завершена (1-0)')).toBeVisible();
        }
    });

    test('нелегальный ход не проходит и не меняет позицию у соперника', async () => {
        await startFriendGame(alice, bob, 'white');

        // Ладья сквозь собственную пешку — доска не меняется ни у кого.
        await square(alice, 'a1').dragTo(square(alice, 'a4'));
        for (const page of [alice, bob]) {
            await expect(pieceOn(page, 'a1')).toHaveCount(1);
            await expect(pieceOn(page, 'a4')).toHaveCount(0);
        }

        await move(alice, bob, 'e2', 'e4');
        await move(bob, alice, 'e7', 'e5');
        await resign(alice);
        await expect(bob.getByText('Партия завершена (0-1)')).toBeVisible();
    });
});
