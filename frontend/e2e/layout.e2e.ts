/// <reference lib="dom" />
// Вёрстка на телефоне и на широком экране, на трёх языках (таски 17.6 и 17.7): страница не прокручивается вбок, текст
// не вылезает за экран и не обрезается в кнопках, ссылках и блоках со скрытым переполнением. Намеренное многоточие
// (`text-overflow: ellipsis`) и блоки со своей горизонтальной прокруткой (таблицы) — не ошибка. При ошибке к отчёту
// прикладывается снимок страницы; E2E_LAYOUT_SHOTS=1 — снимки всех страниц (для глаз).

import {expect, test} from '@playwright/test';
import type {Page, TestInfo} from '@playwright/test';
import {API, loginNewPlayer} from './helpers.ts';

const LANGUAGES = ['ru', 'en', 'uk'] as const;
// Телефоны — от самого узкого распространённого (360 px) до крупного (430 px, таск 24.2). Длиннее всего тексты на
// узком экране, поэтому 360 — на всех языках; 430 — на русском, чтобы поймать то, что ломается на границе раскладки.
const VIEWPORTS = [
    {name: 'phone', width: 360, height: 780, languages: LANGUAGES},
    {name: 'phone', width: 430, height: 932, languages: ['ru'] as const},
    {name: 'wide', width: 1600, height: 900, languages: LANGUAGES},
];
// Страницы без параметров и разделы, у которых есть своя первая страница.
const ROUTES = [
    '/', '/puzzles', '/learn', '/learn/basics', '/learn/classics', '/learn/endgames', '/learn/mates', '/train', '/tools',
    '/watch', '/guess', '/train/games', '/tournaments', '/arenas', '/teams', '/study', '/leaderboard', '/about', '/settings', '/moderation',
    '/learn/course', '/library', '/programs', '/exam', '/workout', '/repertoire', '/play/960', '/train/structure_quiz',
    '/import', '/transparency', '/time-machine', '/masters', 'PROFILE',
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
    for (const viewport of VIEWPORTS.filter((v) => (v.languages as readonly string[]).includes(language))) {
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

// Шапка гостя (без входа): кнопок в ней больше, чем у вошедшего игрока, а название сайта появляется только с
// определённой ширины — на границе шапка однажды вылезла за экран (380–407 px). Основной прогон идёт со входом и
// этого не видит, поэтому гость проверяется отдельно, по всем ширинам телефона.
test('вёрстка: шапка гостя на телефонах 360–480 px', async ({browser}, testInfo) => {
    const failures: string[] = [];
    for (const width of [360, 375, 380, 390, 400, 412, 420, 430, 440, 460, 480]) {
        const context = await browser.newContext({viewport: {width, height: 800}, locale: 'ru-RU'});
        const page = await context.newPage();
        for (const route of ['/about', '/time-machine']) {
            failures.push(...await check(page, testInfo, `гость ${width}`, route));
        }
        await context.close();
    }
    expect(failures).toEqual([]);
});

// Шапка на планшетах и ноутбуках (768–1440 px): между телефоном и широким экраном её раньше никто не проверял,
// и она не помещалась — гостю до ~1200 px, вошедшему игроку с длинным именем до 1366 px (кнопка входа и меню
// профиля уезжали за экран, страница прокручивалась вбок). Теперь на этих ширинах в меню — значки с подсказками,
// подписи появляются с 1360 px (у вошедшего игрока самая длинная — с 1500 px). Шрифт интерфейса системный: в
// сборке для CI (Linux) он шире, чем на Windows, поэтому пороги подобраны по широкому шрифту, а этот тест —
// их настоящая проверка. Гость и вошедший игрок проверяются отдельно: состав шапки у них разный.
// 640–720 px — граница, где у вошедшего игрока появляются имя и название сайта.
const HEADER_WIDTHS = [640, 700, 720, 768, 820, 1024, 1180, 1280, 1340, 1360, 1366, 1440, 1500, 1536];

test('вёрстка: шапка гостя на планшетах и ноутбуках 640–1440 px', async ({browser}, testInfo) => {
    test.setTimeout(240_000);
    const failures: string[] = [];
    for (const locale of ['ru-RU', 'en-US', 'uk-UA']) {
        for (const width of HEADER_WIDTHS) {
            const context = await browser.newContext({viewport: {width, height: 800}, locale});
            const page = await context.newPage();
            failures.push(...await check(page, testInfo, `гость ${locale} ${width}`, '/about'));
            await context.close();
        }
    }
    expect(failures).toEqual([]);
});

test('вёрстка: шапка вошедшего игрока на планшетах и ноутбуках 640–1440 px', async ({page, request}, testInfo) => {
    test.setTimeout(240_000);
    const token = await loginNewPlayer(page, request, 'layout');
    const failures: string[] = [];
    try {
        for (const language of ['en', 'ru']) {
            await page.request.patch(`${API}/api/v1/profile/me/settings`, {
                data: {language}, headers: {Authorization: `Bearer ${token}`},
            });
            for (const width of HEADER_WIDTHS) {
                await page.setViewportSize({width, height: 800});
                failures.push(...await check(page, testInfo, `игрок ${language} ${width}`, '/about'));
            }
        }
    } finally {
        await page.request.patch(`${API}/api/v1/profile/me/settings`, {
            data: {language: 'ru'}, headers: {Authorization: `Bearer ${token}`},
        });
    }
    expect(failures).toEqual([]);
});
