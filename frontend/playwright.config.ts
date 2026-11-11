// E2E-тесты (Playwright) против собранного продакшен-стека: nginx + API + PostgreSQL + Redis.
//
//   docker compose -f docker-compose.prod.yml up -d --build   (HTTP_PORT=8080)
//   npx playwright install chromium                            (один раз)
//   E2E_BASE_URL=http://localhost:8080 npm run test:e2e
//
// Каждый прогон регистрирует двух новых игроков, а регистрация ограничена 5 аккаунтами в час
// с одного IP — для частых локальных прогонов перезапускайте Redis стека (лимиты хранятся там).

import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.e2e.ts',
    timeout: 90_000,
    expect: {timeout: 15_000},
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        viewport: {width: 1400, height: 900},
        permissions: ['clipboard-read', 'clipboard-write'],
    },
    projects: [{name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1400, height: 900}}}],
});
