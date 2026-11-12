// Наставник в разборе партии на настоящем Stockfish: партия с детским матом, разбор, комментарии к матующему
// ходу и к грубой ошибке перед ним, стрелки на доске.

import {expect, test} from '@playwright/test';

const PASSWORD = 'e2e-pass-12345';

test('разбор партии: наставник объясняет зевок и мат', async ({page, request}) => {
    const username = `coach_${Date.now().toString(36)}`;
    expect((await request.post('/api/v1/auth/register', {data: {username, password: PASSWORD}})).ok()).toBe(true);
    const login = await request.post('/api/v1/auth/login', {form: {username, password: PASSWORD}});
    const {access_token: token} = await login.json();

    // 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# — игрок белыми против Морфи.
    const saved = await request.post('/api/v1/bots/save-game', {
        headers: {Authorization: `Bearer ${token}`},
        data: {
            bot_id: 'morphy', player_color: 'white', result: '1-0',
            moves_uci: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'],
            base_time_ms: 300000, increment_ms: 0,
        },
    });
    expect(saved.ok()).toBe(true);
    const {game_id: gameId} = await saved.json();

    await page.goto(`/game/${gameId}`);
    await page.getByRole('button', {name: 'Компьютерный анализ'}).click();

    const coach = page.getByTestId('coach-comment');
    await expect(coach).toContainText('мат', {timeout: 60_000});  // матующий ход: «♕xf7# — мат!»

    await page.getByTitle('Ход назад').click();  // 3... Nf6?? — пропускает мат
    await expect(coach).toContainText('♞f6');
    await expect(coach).toContainText('♕xf7#');
    await expect(page.getByTestId('coach-arrow-threat')).toHaveCount(1);
    await page.screenshot({path: 'test-results/coach-blunder.png'});
});
