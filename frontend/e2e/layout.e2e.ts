/// <reference lib="dom" />
// Вёрстка на телефоне и на широком экране, на трёх языках (таски 17.6 и 17.7): страница не прокручивается вбок, текст
// не вылезает за экран и не обрезается в кнопках, ссылках и блоках со скрытым переполнением. Намеренное многоточие
// (`text-overflow: ellipsis`) и блоки со своей горизонтальной прокруткой (таблицы) — не ошибка. При ошибке к отчёту
// прикладывается снимок страницы; E2E_LAYOUT_SHOTS=1 — снимки всех страниц (для глаз).

import {expect, test} from '@playwright/test';
import type {Page, TestInfo} from '@playwright/test';
import {API, loginNewPlayer} from './helpers.ts';

const LANGUAGES = ['ru', 'en', 'uk'] as const;
const VIEWPORTS = [
    {name: 'phone', width: 390, height: 844},
    {name: 'wide', width: 1600, height: 900},
];
// Страницы без параметров и разделы, у которых есть своя первая страница.
const ROUTES = [
    '/', '/puzzles', '/learn', '/learn/basics', '/learn/classics', '/learn/endgames', '/learn/mates', '/train', '/tools',
    '/watch', '/guess', '/train/games', '/tournaments', '/arenas', '/teams', '/study', '/leaderboard', '/about', '/settings', '/moderation',
    'PROFILE',
];

interface Problem {
    kind: 'page-scroll' | 'off-screen' | 'clipped';
    text: string;
    detail: string;
}

/** Проблемы вёрстки на открытой странице (выполняется в браузере). */
async function findProblems(page: Page): Promise<Problem[]> {
    return page.evaluate(() => {
        const problems: { kind: 'page-scroll' | 'off-screen' | 'clipped'; text: string; detail: string }[] = [];
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth + 1) {
            problems.push({kind: 'page-scroll', text: '', detail: `${doc.scrollWidth} > ${doc.clientWidth}`});
        }
        const scrollsSideways = (el: Element | null): boolean => {
            for (let node = el; node && node !== document.body; node = node.parentElement) {
                const overflowX = getComputedStyle(node).overflowX;
                if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth) return true;
            }
            return false;
        };
        const ownText = (el: Element) => Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim();
        for (const el of Array.from(document.querySelectorAll('body *'))) {
            if (!(el instanceof HTMLElement)) continue;
            const text = ownText(el);
            if (!text) continue;
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (style.position !== 'fixed' && (rect.right > window.innerWidth + 1 || rect.left < -1) && !scrollsSideways(el)) {
                problems.push({kind: 'off-screen', text: text.slice(0, 60), detail: `${Math.round(rect.left)}..${Math.round(rect.right)} / ${window.innerWidth}`});
                continue;
            }
            if (style.textOverflow === 'ellipsis') continue;
            const clips = style.overflowX === 'hidden' || style.overflowX === 'clip';
            const control = el.matches('button, a, label, [role="button"], th, td');
            if ((clips || control) && el.scrollWidth > el.clientWidth + 2 && !scrollsSideways(el)) {
                problems.push({kind: 'clipped', text: text.slice(0, 60), detail: `${el.tagName.toLowerCase()} ${el.scrollWidth} > ${el.clientWidth}`});
            }
        }
        return problems;
    });
}

async function check(page: Page, testInfo: TestInfo, label: string, route: string): Promise<string[]> {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const problems = await findProblems(page);
    if (problems.length > 0 || process.env.E2E_LAYOUT_SHOTS === '1') {
        await testInfo.attach(`${label} ${route}`, {body: await page.screenshot({fullPage: true}), contentType: 'image/png'});
    }
    return problems.map((p) => `${label} ${route}: ${p.kind} «${p.text}» (${p.detail})`);
}

for (const language of LANGUAGES) {
    for (const viewport of VIEWPORTS) {
        test(`вёрстка: ${language}, ${viewport.name} ${viewport.width}px`, async ({page, request}, testInfo) => {
            test.setTimeout(240_000);
            await page.setViewportSize({width: viewport.width, height: viewport.height});
            const token = await loginNewPlayer(page, request, 'layout');
            // Язык — из профиля (таск 17.7): иначе при входе он перекрыл бы язык браузера.
            await page.request.patch(`${API}/api/v1/profile/me/settings`, {
                data: {language}, headers: {Authorization: `Bearer ${token}`},
            });
            const me = await (await page.request.get(`${API}/api/v1/profile/me`, {headers: {Authorization: `Bearer ${token}`}})).json();
            const failures: string[] = [];
            try {
                for (const route of ROUTES) {
                    const path = route === 'PROFILE' ? `/profile/${encodeURIComponent(me.username)}` : route;
                    failures.push(...await check(page, testInfo, `${language} ${viewport.width}`, path));
                }
            } finally {
                // Игрок общий для прогона, а остальные сценарии написаны против русского интерфейса — вернуть язык.
                await page.request.patch(`${API}/api/v1/profile/me/settings`, {
                    data: {language: 'ru'}, headers: {Authorization: `Bearer ${token}`},
                });
            }
            expect(failures).toEqual([]);
        });
    }
}
