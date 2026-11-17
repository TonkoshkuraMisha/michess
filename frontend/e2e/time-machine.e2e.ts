// «Машина времени» и каталог мастеров прошлого в настоящем браузере против полного стека (таски 28.3 и 28.5).
// Партия игрока с мастером прошлого сохраняется под его именем из PGN («Keres, Paul»): до 17.11 сервер такое имя
// отклонял (400 username_invalid_chars), результат не записывался, и исторический турнир нельзя было доиграть.
// Юнит-тесты ставили результаты сервисом напрямую и этого не видели — здесь весь путь проходит браузер.

import {expect, test} from '@playwright/test';
import type {APIRequestContext, Page} from '@playwright/test';
import {API, loginNewPlayer} from './helpers.ts';

interface PlayerRow { seat: number; kind: string; bot_key: string | null; personality_name: string | null }
interface GameRow { id: number; round: number; white_seat: number; black_seat: number; result: string | null; game_id: number | null }
interface TournamentState {
    id: number; status: string; event_key: string | null; my_seat: number; current_round: number;
    players: PlayerRow[]; games: GameRow[];
}

/** Игрок общий для прогона: сдать оставшиеся с прошлой попытки турниры, чтобы войти в новый. */
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

test('машина времени: партия с мастером прошлого записывается в исторический турнир', async ({page, request}) => {
    test.setTimeout(240_000);
    const token = await loginNewPlayer(page, request, 'tm');
    const headers = {Authorization: `Bearer ${token}`};
    await withdrawActiveTournaments(request, token);

    await page.goto('/time-machine');
    await page.getByTestId('start-avro_1938').click();
    await expect(page.getByTestId('tournament-view')).toBeVisible();
    const tournamentId = Number(new URL(page.url()).pathname.split('/').pop());
    expect(tournamentId).toBeGreaterThan(0);

    const state = async () =>
        await (await request.get(`${API}/api/v1/tournaments/${tournamentId}`, {headers})).json() as TournamentState;
    const before = await state();
    expect(before.event_key).toBe('avro_1938');
    const mine = before.games.find((g) => g.round === before.current_round && g.result === null
        && [g.white_seat, g.black_seat].includes(before.my_seat));
    expect(mine, 'у игрока есть партия в первом туре').toBeTruthy();
    const opponentSeat = mine!.white_seat === before.my_seat ? mine!.black_seat : mine!.white_seat;
    const opponent = before.players.find((p) => p.seat === opponentSeat)!;
    // Первый соперник новичка — из верхней части посева: в АВРО это мастер прошлого, а не исторический бот.
    expect(opponent.kind).toBe('personality');
    expect(opponent.bot_key).toMatch(/^guest:/);
    expect(opponent.personality_name).toContain(', ');

    await page.getByRole('button', {name: 'Играть мою партию'}).click();
    await expect(page.getByTestId('tournament-bar')).toBeVisible();
    // На доске — имя мастера на языке игрока, а не латинское имя из PGN.
    await expect(page.getByText(/Керес|Файн|Решевский|Эйве|Флор/).first()).toBeVisible();
    await resign(page);
    await expect(page.getByText(/Результат записан в турнир/)).toBeVisible();
    // После партии: путь в турнир и карточка соперника — мастера прошлого.
    await expect(page.getByTestId('back-to-tournament')).toBeVisible();
    await expect(page.getByTestId('tournament-bar-opponent-card')).toHaveAttribute('href', /\/masters\?master=/);

    // Сервер принял партию: у неё есть результат и запись в архиве.
    await expect.poll(async () => (await state()).games.find((g) => g.id === mine!.id)?.result ?? null, {timeout: 20_000})
        .not.toBeNull();
    const recorded = (await state()).games.find((g) => g.id === mine!.id)!;
    expect(recorded.game_id).not.toBeNull();
    const pgn = await request.get(`${API}/api/v1/profile/games/${recorded.game_id}/pgn`, {headers});
    expect(pgn.ok()).toBe(true);
    expect(await pgn.text()).toContain(opponent.personality_name!);

    await request.post(`${API}/api/v1/tournaments/${tournamentId}/withdraw`, {headers});
});

test('каталог мастеров: отдельная партия с мастером прошлого уходит в архив под его именем', async ({page, request}) => {
    test.setTimeout(180_000);
    const token = await loginNewPlayer(page, request, 'masters');
    const headers = {Authorization: `Bearer ${token}`};
    const me = await (await request.get(`${API}/api/v1/profile/me`, {headers})).json() as { username: string };

    await page.goto('/masters');
    await expect(page.getByTestId('master-keres')).toBeVisible();
    await page.getByTestId('masters-search').fill('Kieseritzky');
    await expect(page.locator('li[data-testid^="master-"]')).toHaveCount(1);
    await page.getByTestId('play-kieseritzky-white').click();

    // Доска: соперник — Кизерицкий, игрок белыми. Ход e2–e4, мастер отвечает (движок на сервере).
    await expect(page.getByText(/Кизерицкий/).first()).toBeVisible();
    const square = (name: string) => page.locator(`[data-square="${name}"]`).first();
    await square('e2').click();
    await square('e4').click();
    await expect.poll(async () => page.locator('[data-square="e4"] img').count(), {timeout: 10_000}).toBe(1);
    // Ответ чёрных: на седьмой горизонтали стало меньше восьми пешек или с восьмой ушла фигура.
    await expect.poll(async () => await page.evaluate(`Array.from(document.querySelectorAll('[data-square]'))
        .filter((cell) => /[78]$/.test(cell.getAttribute('data-square') ?? '') && cell.querySelector('img')).length`),
        {timeout: 30_000}).toBeLessThan(16);
    await resign(page);

    // В архиве игрока последняя партия — с мастером, под именем из PGN.
    await expect.poll(async () => {
        const games = await (await request.get(`${API}/api/v1/profile/${encodeURIComponent(me.username)}/games`, {headers})).json();
        const list = (Array.isArray(games) ? games : games.items ?? []) as { white_username: string; black_username: string }[];
        return list.length > 0 ? list[0].black_username : null;
    }, {timeout: 20_000}).toBe('Kieseritzky, Lionel');
});
