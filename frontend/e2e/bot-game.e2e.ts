// Партия против исторического бота на основной доске в настоящем браузере: ходы перетаскиванием и двумя щелчками
// чередуются, после каждого хода бот отвечает (Stockfish на сервере), позиция на доске остаётся корректной.

import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';
import {Chess} from 'chess.js';
import {loginNewPlayer} from './helpers.ts';

const PIECES: Record<string, string> = {wp: 'P', wn: 'N', wb: 'B', wr: 'R', wq: 'Q', wk: 'K', bp: 'p', bn: 'n', bb: 'b', br: 'r', bq: 'q', bk: 'k'};

/** Расстановка с доски (alt картинок фигур) → FEN-расстановка. */
async function placement(page: Page): Promise<string> {
    // Строкой, а не функцией: конфиг TypeScript для E2E не знает типов DOM (код выполняется в браузере).
    const pieces = await page.evaluate(`Array.from(document.querySelectorAll('[data-square]')).map((cell) => ({
        square: cell.getAttribute('data-square') ?? '',
        piece: cell.querySelector('img')?.getAttribute('alt') ?? '',
    }))`) as { square: string; piece: string }[];
    const map = new Map(pieces.map((p) => [p.square, p.piece]));
    const rows: string[] = [];
    for (let rank = 8; rank >= 1; rank--) {
        let row = '';
        let empty = 0;
        for (const file of 'abcdefgh') {
            const symbol = PIECES[map.get(`${file}${rank}`) ?? ''];
            if (symbol) {
                row += (empty || '') + symbol;
                empty = 0;
            } else {
                empty += 1;
            }
        }
        rows.push(row + (empty || ''));
    }
    return rows.join('/');
}

/** Ход белых без особых правил (рокировку и взятие на проходе по одной доске не проверить): взятие, если есть. */
function chooseMove(board: string, seed: number) {
    const game = new Chess(`${board} w - - 0 1`);
    const moves = game.moves({verbose: true}).filter((m) => !m.promotion);
    const captures = moves.filter((m) => m.captured);
    const pool = captures.length ? captures : moves;
    return pool[seed % pool.length];
}

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`).first();

test('партия с ботом: ходы перетаскиванием и щелчками, бот отвечает', async ({page, request}) => {
    test.setTimeout(180_000);
    await loginNewPlayer(page, request, 'bot');
    await page.goto('/');
    await page.getByRole('button', {name: '♔ Белыми'}).first().click();
    await expect.poll(() => placement(page)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

    for (let turn = 0; turn < 8; turn++) {
        const before = await placement(page);
        const game = new Chess(`${before} w - - 0 1`);
        if (game.isGameOver()) break;
        const move = chooseMove(before, turn * 7 + 3);
        if (turn % 2 === 0) {
            await square(page, move.from).dragTo(square(page, move.to));
        } else {
            await square(page, move.from).click();
            await square(page, move.to).click();
        }
        // Ход белых виден на доске…
        await expect.poll(async () => (await placement(page)) !== before, {timeout: 10_000}).toBe(true);
        game.move({from: move.from, to: move.to});
        const afterOurs = game.fen().split(' ')[0];
        // …затем бот отвечает: позиция отличается от той, что была сразу после нашего хода, и это легальный ход чёрных.
        await expect.poll(async () => (await placement(page)) !== afterOurs, {timeout: 30_000}).toBe(true);
        const afterBot = await placement(page);
        const blackToMove = new Chess(`${afterOurs} b - - 0 1`);
        const legalReplies = blackToMove.moves({verbose: true}).map((m) => {
            const probe = new Chess(`${afterOurs} b - - 0 1`);
            probe.move(m);
            return probe.fen().split(' ')[0];
        });
        expect(legalReplies).toContain(afterBot);
    }
    await page.screenshot({path: 'test-results/bot-game.png'});
});
