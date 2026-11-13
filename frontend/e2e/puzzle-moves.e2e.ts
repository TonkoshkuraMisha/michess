// Ход в задаче настоящей мышью — перетаскиванием и двумя щелчками (задача дня и задача по рейтингу). Раньше
// сценарии задач ходов не делали («Показать решение»), и доска, на которой фигура не сдвигалась, тест проходила.

import {expect, test} from '@playwright/test';
import type {APIRequestContext, Page} from '@playwright/test';
import {Chess} from 'chess.js';
import {loginNewPlayer} from './helpers.ts';

async function login(page: Page, request: APIRequestContext, prefix: string) {
    await loginNewPlayer(page, request, prefix);
}

/** Любой легальный ход решающего — после первого хода соперника. */
function anyLegalMove(view: { fen: string; first_move: string }) {
    const game = new Chess(view.fen);
    game.move({from: view.first_move.slice(0, 2), to: view.first_move.slice(2, 4), promotion: view.first_move[4]});
    const move = game.moves({verbose: true}).find((m) => !m.promotion) ?? game.moves({verbose: true})[0];
    return {from: move.from, to: move.to};
}

async function square(page: Page, name: string) {
    const box = await page.locator(`[data-testid="puzzle-board"] [data-square="${name}"]`).boundingBox();
    if (!box) throw new Error(`no square ${name}`);
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

const answered = (page: Page) => page.locator('[data-testid="puzzle-mark-ok"], [data-testid="puzzle-mark-wrong"]');

test('задача дня: фигура перетаскивается мышью, сервер отвечает на ход', async ({page, request}) => {
    await login(page, request, 'drag');
    await page.goto('/puzzles');
    const daily = page.waitForResponse((r) => r.url().includes('/api/v1/puzzles/daily'));
    await page.getByTestId('puzzle-mode-daily').click();
    const view = await (await daily).json();
    await expect(page.getByTestId('puzzle-status')).toContainText('Ваш ход', {timeout: 10_000});

    const {from, to} = anyLegalMove(view);
    const start = await square(page, from);
    const end = await square(page, to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, {steps: 5});
    await page.mouse.move(end.x, end.y, {steps: 5});
    await page.mouse.up();

    await expect(answered(page)).toBeVisible({timeout: 10_000});
    await page.screenshot({path: 'test-results/puzzle-drag.png'});
});

test('задача по рейтингу: ход двумя щелчками', async ({page, request}) => {
    await login(page, request, 'click');
    await page.goto('/puzzles');
    const next = page.waitForResponse((r) => r.url().includes('/api/v1/puzzles/next'));
    await page.getByTestId('puzzle-next').click();
    const view = await (await next).json();
    await expect(page.getByTestId('puzzle-status')).toContainText('Ваш ход', {timeout: 10_000});

    const {from, to} = anyLegalMove(view);
    await page.locator(`[data-testid="puzzle-board"] [data-square="${from}"]`).click();
    await page.locator(`[data-testid="puzzle-board"] [data-square="${to}"]`).click();
    await expect(answered(page)).toBeVisible({timeout: 10_000});
});

test('приёмы: ход перетаскиванием в тренировке по теме', async ({page, request}) => {
    await login(page, request, 'thm');
    await page.goto('/puzzles');
    await page.getByTestId('puzzle-mode-themes').click();
    await page.getByTestId('training-theme-fork').click();
    const train = page.waitForResponse((r) => r.url().includes('/api/v1/puzzles/train'));
    await page.getByTestId('theme-train').click();
    const view = await (await train).json();
    await expect(page.getByTestId('puzzle-status')).toContainText('Ваш ход', {timeout: 10_000});
    const {from, to} = anyLegalMove(view);
    await page.locator(`[data-testid="puzzle-board"] [data-square="${from}"]`)
        .dragTo(page.locator(`[data-testid="puzzle-board"] [data-square="${to}"]`));
    await expect(answered(page)).toBeVisible({timeout: 10_000});
    await expect(page.getByTestId('training-progress')).toBeVisible();
});

test('ход по двум подсказкам засчитывается верным', async ({page, request}) => {
    await login(page, request, 'hint');
    await page.goto('/puzzles');
    await page.getByTestId('puzzle-next').click();
    await expect(page.getByTestId('puzzle-status')).toContainText('Ваш ход', {timeout: 10_000});
    const hint = page.waitForResponse((r) => r.url().includes('/hint'));
    await page.getByTestId('puzzle-hint').click();
    await hint;
    const second = page.waitForResponse((r) => r.url().includes('/hint'));
    await page.getByTestId('puzzle-hint').click();
    const {from, to} = await (await second).json();
    // Превращение подсказка не называет — ходим, если это обычный ход, и выбираем ферзя, если спросят.
    await page.locator(`[data-testid="puzzle-board"] [data-square="${from}"]`)
        .dragTo(page.locator(`[data-testid="puzzle-board"] [data-square="${to}"]`));
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) await page.getByTestId('puzzle-promote-q').click();
    await expect(page.locator('[data-testid="puzzle-mark-ok"]')).toBeVisible({timeout: 10_000});
});

test('защита: «Что грозит?» — угроза, затем защита; «Не зевни» — выбор хода', async ({page, request}) => {
    await login(page, request, 'def');
    await page.goto('/puzzles');
    await page.getByTestId('puzzle-mode-defense').click();
    const next = page.waitForResponse((r) => r.url().includes('/defense/next'));
    await page.getByTestId('defense-next').click();
    const drill = await (await next).json();
    await expect(page.getByTestId('defense-status')).toContainText('Что он сыграет?');

    await page.locator(`[data-testid="puzzle-board"] [data-square="e4"]`).click();
    await expect(page.getByTestId('defense-threat-result')).toBeVisible();
    await expect(page.getByTestId('defense-status')).toContainText('Теперь защититесь');
    const game = new Chess(drill.fen);
    const move = game.moves({verbose: true}).find((m) => !m.promotion)!;
    await page.locator(`[data-testid="puzzle-board"] [data-square="${move.from}"]`)
        .dragTo(page.locator(`[data-testid="puzzle-board"] [data-square="${move.to}"]`));
    await expect(page.getByTestId('defense-outcome')).toBeVisible({timeout: 10_000});
    await expect(page.getByTestId('defense-progress')).toBeVisible();

    const blunder = page.waitForResponse((r) => r.url().includes('/defense/next'));
    await page.getByTestId('defense-kind-blunder').click();
    const choice = (await (await blunder).json()).choices[0];
    await page.getByTestId(`defense-choice-${choice}`).click();
    await expect(page.getByTestId('defense-outcome')).toBeVisible({timeout: 10_000});
    await page.screenshot({path: 'test-results/defense.png'});
});

test('упражнения-генераторы: «взять незащищённую» перетаскиванием и мат в 1 щелчками', async ({page, request}) => {
    await login(page, request, 'drl');
    await page.goto('/puzzles');
    await page.getByTestId('puzzle-mode-drills').click();

    const capture = page.waitForResponse((r) => r.url().includes('/drills/next'));
    await page.getByTestId('drill-next').click();
    const first = await (await capture).json();
    const game = new Chess(first.fen);
    const enemy = game.turn() === 'w' ? 'b' : 'w';
    const take = game.moves({verbose: true}).find((m) => m.captured && m.captured !== 'k'
        && !game.isAttacked(m.to, enemy))!;
    await page.locator(`[data-testid="puzzle-board"] [data-square="${take.from}"]`)
        .dragTo(page.locator(`[data-testid="puzzle-board"] [data-square="${take.to}"]`));
    await expect(page.getByTestId('drill-outcome')).toHaveText('Верно!', {timeout: 10_000});

    await page.getByTestId('drill-kind-mate1').click();
    const mate = page.waitForResponse((r) => r.url().includes('/drills/next'));
    await page.getByTestId('drill-next').click();
    const second = await (await mate).json();
    const board = new Chess(second.fen);
    const mating = board.moves({verbose: true}).find((m) => m.san.endsWith('#'))!;
    await page.locator(`[data-testid="puzzle-board"] [data-square="${mating.from}"]`).click();
    await page.locator(`[data-testid="puzzle-board"] [data-square="${mating.to}"]`).click();
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) await page.getByTestId(`puzzle-promote-${mating.promotion ?? 'q'}`).click();
    await expect(page.getByTestId('drill-outcome')).toHaveText('Верно!', {timeout: 10_000});
    await page.screenshot({path: 'test-results/drills.png'});
});
