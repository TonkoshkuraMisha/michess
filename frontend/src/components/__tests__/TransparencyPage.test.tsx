// «Как мы измеряем силу ботов» (таск 24.3): таблица «заявлено / измерено ±95 %», журналы прогонов, выгрузка своих
// партий в PGN и описание открытого API.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TransparencyPage} from '../TransparencyPage';
import {resetBotCatalogCache} from '../../services/botCatalog';
import {setToken} from '../../services/authToken';

const CATALOG = {
    calibration: {date: '2026-11-16', games: 116},
    historical: [
        {id: 'morphy', declared_rating: 2100, rating: 2143, measured: true, games: 56, ci95: 98,
            live: {rating: 1980, games: 64, offset: 30}},
        {id: 'philidor', declared_rating: 1850, rating: 1850, measured: false, games: 0, ci95: null},
    ],
    archetypes: [{id: 'blunderer', config: {}, declared_rating: 900, rating: 848, measured: true, games: 96, ci95: 109}],
};
const RUNS = {
    calibration: {date: '2026-11-16', games: 116, anchors: [1350, 1600], anchor_movetime_s: 1},
    runs: [
        {name: '2026-11-16_masters.log', date: '2026-11-16', title: 'masters', kind: 'log', size: 6411},
        {name: '2026-11-14_style.pgn', date: '2026-11-14', title: 'style', kind: 'pgn', size: 254127},
    ],
};
const TUNING = {
    entries: [{key: 'archetype:blunderer', created_at: '2026-11-17T12:00:00Z', games: 20, measured: 1012, target: 900,
        randomness: [40, 45], blunder_guard_cp: [200, 220]}],
    rules: {games: 20, drift: 75},
};
const PUBLIC = {
    version: 1, rate_limit: {requests: 60, window_s: 60},
    endpoints: ['/api/v1/public', '/api/v1/public/players/{username}/games.pgn', '/api/v1/public/new-thing'],
};

function stub(pgn = '[Event "a"]\n\n1. e4 *\n\n[Event "b"]\n\n1. d4 *\n') {
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        calls.push([u, init]);
        if (u.endsWith('/account/games.pgn')) {
            return {ok: true, text: async () => pgn, headers: new Headers({'X-Total-Count': pgn ? '2' : '0'})} as Response;
        }
        if (u.includes('/calibration/runs/')) return {ok: true, text: async () => '[1/2] morphy — anchor:1850: 1-0'} as Response;
        const body = u.endsWith('/bots/catalog') ? CATALOG : u.endsWith('/calibration/runs') ? RUNS
            : u.endsWith('/bots/tuning-log') ? TUNING : PUBLIC;
        return {ok: true, json: async () => body} as Response;
    }));
    return calls;
}

const renderPage = () => act(async () => {
    render(<MemoryRouter><TransparencyPage username="misha"/></MemoryRouter>);
});

beforeEach(() => {
    resetBotCatalogCache();
    vi.stubGlobal('URL', Object.assign(URL, {createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn()}));
});
afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
});

describe('прозрачность', () => {
    it('журнал подстройки самоигрой (таск 32.3): что измерено и как сдвинуты ползунки', async () => {
        stub();
        await renderPage();
        const row = screen.getByTestId('tuning-archetype:blunderer');
        expect(row).toHaveTextContent('1012 против 900 (партий: 20)');
        expect(row).toHaveTextContent('40 → 45');
        expect(row).toHaveTextContent('200 → 220');
        expect(screen.getByTestId('transparency-tuning')).toHaveTextContent('После 20 партий');
    });

    it('память ботов: рейтинг по партиям с людьми и поправка силы (таск 32.1)', async () => {
        stub();
        await renderPage();
        expect(screen.getByTestId('live-morphy')).toHaveTextContent('1980 (64)');
        expect(screen.getByTestId('live-morphy')).toHaveTextContent('поправка +30');
        expect(screen.getByTestId('live-philidor')).toHaveTextContent('—');
        expect(screen.getByTestId('transparency-memory')).toHaveTextContent('Боты также учатся на своих партиях');
    });

    it('таблица: измеренные — с погрешностью и числом партий, остальные — «заявлено»; сортировка по силе', async () => {
        stub();
        await renderPage();
        const morphy = screen.getByTestId('strength-morphy');
        expect(morphy).toHaveTextContent('Пол Чарльз Морфи');
        expect(morphy).toHaveTextContent('2143 ±98');
        expect(morphy).toHaveTextContent('измерено');
        const philidor = screen.getByTestId('strength-philidor');
        expect(philidor).toHaveTextContent('1850');
        expect(philidor).toHaveTextContent('заявлено');
        expect(philidor).not.toHaveTextContent('±');
        expect(screen.getByTestId('strength-archetype:blunderer')).toHaveTextContent('Ротозей');
        const order = Array.from(document.querySelectorAll('[data-testid^="strength-"]')).map((row) => row.getAttribute('data-testid'));
        expect(order).toEqual(['strength-morphy', 'strength-philidor', 'strength-archetype:blunderer']);
        expect(screen.getByTestId('transparency-meta')).toHaveTextContent('партий: 116. Измерено ботов: 2 из 3.');
        expect(screen.getByText(/ограниченным до фиксированной силы \(1350, 1600\)/)).toBeInTheDocument();
    });

    it('журнал прогона открывается на странице, PGN — только ссылкой', async () => {
        const calls = stub();
        await renderPage();
        expect(screen.queryByTestId('run-show-2026-11-14_style.pgn')).toBeNull();
        await act(async () => fireEvent.click(screen.getByTestId('run-show-2026-11-16_masters.log')));
        expect(screen.getByTestId('run-text')).toHaveTextContent('morphy — anchor:1850: 1-0');
        expect(calls.some(([u]) => u.endsWith('/calibration/runs/2026-11-16_masters.log'))).toBe(true);
        await act(async () => fireEvent.click(screen.getByTestId('run-show-2026-11-16_masters.log')));
        expect(screen.queryByTestId('run-text')).toBeNull();
    });

    it('открытое API: лимит и адреса с пояснениями; незнакомый адрес — без пояснения', async () => {
        stub();
        await renderPage();
        expect(screen.getByTestId('transparency-api-limit')).toHaveTextContent('Лимит: 60 запросов за 60 с');
        expect(screen.getByText('GET /api/v1/public/players/{username}/games.pgn').parentElement).toHaveTextContent('те же партии одним файлом PGN');
        expect(screen.getByText('GET /api/v1/public/new-thing').parentElement?.children).toHaveLength(1);
    });

    it('свои партии: без входа — подсказка вместо кнопки, на сервер за партиями не ходим', async () => {
        const calls = stub();
        await renderPage();
        expect(screen.queryByTestId('transparency-export')).toBeNull();
        expect(screen.getByTestId('transparency-data')).toHaveTextContent('Войдите, чтобы скачать свои партии.');
        expect(calls.some(([u]) => u.endsWith('/account/games.pgn'))).toBe(false);
    });

    it('выгрузка партий: запрос с токеном и число партий; пусто — сообщение без файла', async () => {
        setToken('jwt');
        const calls = stub();
        await renderPage();
        await act(async () => fireEvent.click(screen.getByTestId('transparency-export')));
        const call = calls.find(([u]) => u.endsWith('/account/games.pgn'));
        expect(call?.[1]?.headers).toMatchObject({Authorization: 'Bearer jwt'});
        expect(screen.getByTestId('transparency-export-note')).toHaveTextContent('Партий в файле: 2.');
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

        stub('');
        await act(async () => fireEvent.click(screen.getByTestId('transparency-export')));
        expect(screen.getByTestId('transparency-export-note')).toHaveTextContent('У вас пока нет завершённых партий.');
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
});
