// Дымовая проверка: каждый маршрут приложения открывается без падения — гостем и с входом, когда сервер отвечает
// ошибкой и когда сети нет. Список маршрутов берётся из App.tsx, параметры подставляются образцами.

import {act, render} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import App from '../App';
import {setToken} from '../services/authToken';

vi.mock('../services/gameSocket', () => ({
    gameSocket: {connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), on: vi.fn(), off: vi.fn()},
}));

const SOURCE = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf-8');
const SAMPLES: Record<string, string> = {
    inviteCode: 'abc', sectionId: 'rook', theme: 'back_rank_mate', gameId: '1', exerciseId: 'vancura',
    lessonId: 'tactics-pin', programId: 'first_steps', trainerId: 'structure_quiz', targetUsername: 'alice',
    championId: 'capablanca', arenaId: '1', code: 'abc', positionId: '1', repertoireId: '1', tournamentId: '1',
};
const ROUTES = [...new Set([...SOURCE.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]))]
    .filter((path) => path !== '*')
    .map((path) => path.replace(/:(\w+)/g, (_, name: string) => SAMPLES[name] ?? '1'));

afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
});

async function open(path: string, fetchMode: 'error' | 'offline', logged: boolean): Promise<string[]> {
    setToken(logged ? 'jwt' : null);
    vi.stubGlobal('fetch', vi.fn(async () => {
        if (fetchMode === 'offline') throw new TypeError('Failed to fetch');
        return {ok: false, status: 500, json: async () => ({detail: {code: 'internal_error'}}), text: async () => ''} as Response;
    }));
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const text = args.map(String).join(' ');
        if (/The above error occurred|Uncaught|is not a function|Cannot read properties/.test(text)) errors.push(text.slice(0, 200));
    });
    try {
        const view = await act(async () => render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>));
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
        view.unmount();
    } catch (error) {
        errors.push(`${path}: ${String(error).slice(0, 200)}`);
    } finally {
        spy.mockRestore();
    }
    return errors;
}

describe('все маршруты открываются', () => {
    it('маршруты найдены, страница действительно рисуется', async () => {
        expect(ROUTES.length).toBeGreaterThan(40);
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: false, status: 404, json: async () => ({})}) as Response));
        const view = await act(async () => render(<MemoryRouter initialEntries={['/learn/course']}><App/></MemoryRouter>));
        expect(view.getByTestId('supercourse-page')).toBeInTheDocument();
        view.unmount();
    });

    for (const [mode, logged] of [['error', false], ['error', true], ['offline', true]] as const) {
        it(`сервер: ${mode}, ${logged ? 'с входом' : 'гость'}`, async () => {
            const failures: string[] = [];
            for (const path of ROUTES) failures.push(...(await open(path, mode, logged)));
            expect(failures, `\n${failures.join('\n')}`).toEqual([]);
        }, 120_000);
    }
});
