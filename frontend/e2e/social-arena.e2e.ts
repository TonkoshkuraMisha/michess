// Сквозной путь в двух настоящих браузерах (долг из ToDo): личное сообщение доходит до собеседника, запись ленты видна
// подписчику и получает «нравится», партия арены — «Играть» у обоих, пара, ходы, сдача и очки победителю в таблице.
//
// Игроки регистрируются через API (на стенде CI лимит регистраций поднят) и входят через page.request — так же, как
// в helpers.loginPage. Арену создаёт CI перед прогоном (scripts/e2e_arena.py) и передаёт её номер в E2E_ARENA_ID;
// без него (локальный прогон против dev-серверов) сценарий арены пропускается.

import {expect, test, type Browser, type Page} from '@playwright/test';
import {API, loginPage, PASSWORD} from './helpers.ts';

const ARENA_ID = process.env.E2E_ARENA_ID;

function uniqueName(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

interface Player {
    name: string;
    page: Page;
    token: string;
}

async function newPlayer(browser: Browser, prefix: string): Promise<Player> {
    const name = uniqueName(prefix);
    const context = await browser.newContext();
    const page = await context.newPage();
    expect((await page.request.post(`${API}/api/v1/auth/register`, {data: {username: name, password: PASSWORD, accept_terms: true}})).ok()).toBe(true);
    const token = await loginPage(page, name);
    return {name, page, token};
}

const square = (page: Page, id: string) => page.locator(`[data-square="${id}"]`);
const pieceOn = (page: Page, id: string) => square(page, id).locator('img[alt]');

async function move(mover: Page, opponent: Page, from: string, to: string) {
    await square(mover, from).dragTo(square(mover, to));
    for (const page of [mover, opponent]) {
        await expect(pieceOn(page, to)).toHaveCount(1);
        await expect(pieceOn(page, from)).toHaveCount(0);
    }
}

test.describe.serial('общение и арена в двух браузерах', () => {
    let alice: Player;
    let bob: Player;

    test.beforeAll(async ({browser}) => {
        alice = await newPlayer(browser, 'e2e_sa');
        bob = await newPlayer(browser, 'e2e_sb');
    });

    test.afterAll(async () => {
        await alice?.page.context().close();
        await bob?.page.context().close();
    });

    test('личное сообщение доходит до собеседника', async () => {
        const text = `Привет из e2e ${Date.now()}`;
        await alice.page.goto(`/messages/${bob.name}`);
        await alice.page.getByTestId('dm-input').fill(text);
        await alice.page.getByTestId('dm-send').click();
        await expect(alice.page.getByTestId('dm-messages')).toContainText(text);

        await bob.page.goto(`/messages/${alice.name}`);
        await expect(bob.page.getByTestId('dm-messages')).toContainText(text);
    });

    test('запись ленты видна подписчику и получает «нравится»', async () => {
        const followed = await bob.page.request.post(`${API}/api/v1/social/follow/${alice.name}`,
            {headers: {Authorization: `Bearer ${bob.token}`}});
        expect(followed.ok()).toBe(true);

        const text = `Запись ленты e2e ${Date.now()}`;
        await alice.page.goto('/feed');
        await alice.page.getByTestId('feed-input').fill(text);
        await alice.page.getByTestId('feed-publish').click();
        await expect(alice.page.getByTestId('feed-post').filter({hasText: text})).toBeVisible();

        await bob.page.goto('/feed');
        const post = bob.page.getByTestId('feed-post').filter({hasText: text});
        await expect(post).toBeVisible();
        const like = post.getByTestId('feed-like');
        await like.click();
        await expect(like).toHaveAttribute('aria-pressed', 'true');
        await expect(like).toHaveText('1');
    });

    test('партия арены: пара, ходы, сдача и очки победителю', async () => {
        test.skip(!ARENA_ID, 'арену создаёт CI (scripts/e2e_arena.py, E2E_ARENA_ID)');
        for (const player of [alice, bob]) {
            await player.page.goto(`/arenas/${ARENA_ID}`);
            await player.page.getByTestId('arena-join').click();
            await player.page.getByTestId('arena-play').click();
        }
        // Пара составлена — обе страницы сами переходят на доску с идущей партией.
        for (const player of [alice, bob]) {
            await expect(player.page.getByTestId('pvp-game-status')).toBeVisible({timeout: 20_000});
        }
        // Цвет — по ориентации доски: у белых первая клетка в разметке — a8 (белые внизу), у чёрных — h1.
        await expect(pieceOn(alice.page, 'e2')).toHaveCount(1);
        const aliceWhite = await alice.page.locator('[data-square]').first().getAttribute('data-square') === 'a8';
        const [white, black] = aliceWhite ? [alice, bob] : [bob, alice];
        await move(white.page, black.page, 'e2', 'e4');
        await move(black.page, white.page, 'e7', 'e5');

        white.page.once('dialog', (dialog) => void dialog.accept());
        await white.page.getByRole('button', {name: 'Сдаться'}).click();

        await black.page.goto(`/arenas/${ARENA_ID}`);
        const winnerRow = black.page.getByTestId('arena-standings').locator('tr', {hasText: black.name});
        // Очки — ячейка с жирным числом: победа приносит 2.
        await expect(winnerRow.locator('td.font-bold')).toHaveText('2');
    });
});
