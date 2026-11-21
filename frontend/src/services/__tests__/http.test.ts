// --- FILE: frontend/src/services/__tests__/http.test.ts ---
// Общий запрос к API (services/http.ts): адрес /api/v1, токен входа и Content-Type для JSON-тела, ответ 204 без тела,
// отказ сервера — UiError с кодом ошибки, нет сети — UiError «нет связи».

import {afterEach, describe, expect, it, vi} from 'vitest';
import {UiError} from '../apiErrors';
import {setToken} from '../authToken';
import {apiRequest} from '../http';
import type {MessageKey} from '../../i18n';

function stubFetch(response: Partial<Response> | Error) {
    const fetchMock = vi.fn(async () => {
        if (response instanceof Error) throw response;
        return {ok: true, status: 200, json: async () => ({}), ...response} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('apiRequest', () => {
    it('адрес /api/v1, токен входа и JSON-тело с заголовком', async () => {
        setToken('jwt');
        const fetchMock = stubFetch({json: async () => ({id: 7})});
        const result = await apiRequest<{ id: number }>('/feed/posts', {method: 'POST', body: JSON.stringify({body: 'hi'})});
        expect(result).toEqual({id: 7});
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/api\/v1\/feed\/posts$/);
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({'Content-Type': 'application/json', Authorization: 'Bearer jwt', 'X-Request-ID': expect.stringMatching(/^[a-z0-9]{16}$/)});
    });

    it('без входа и без тела — без заголовков; свои заголовки дополняют общие', async () => {
        const fetchMock = stubFetch({});
        await apiRequest('/watch/archive');
        await apiRequest('/watch/archive', {headers: {'X-Test': '1'}});
        expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({'X-Request-ID': expect.any(String)});
        expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toEqual({'X-Request-ID': expect.any(String), 'X-Test': '1'});
    });

    it('204 — без тела', async () => {
        stubFetch({status: 204, json: async () => {
            throw new Error('no body');
        }});
        await expect(apiRequest('/imports/1', {method: 'DELETE'})).resolves.toBeUndefined();
    });

    it('запасной текст может зависеть от статуса: 429 без тела — «слишком много попыток»', async () => {
        stubFetch({ok: false, status: 429, json: async () => {
            throw new Error('not json');
        }});
        const fallback = (status: number): MessageKey => (status === 429 ? 'auth.tooManyAttempts' : 'auth.wrongCredentials');
        const refused = await apiRequest('/auth/login', {method: 'POST'}, fallback).catch((err: unknown) => err);
        expect((refused as UiError).ui).toEqual(expect.objectContaining({key: 'auth.tooManyAttempts'}));
    });

    it('отказ сервера — UiError с кодом; нет сети — «нет связи»', async () => {
        stubFetch({ok: false, status: 404, json: async () => ({detail: {code: 'puzzle_not_found', message: 'Puzzle not found'}})});
        const refused = await apiRequest('/feed/posts/1').catch((err: unknown) => err);
        expect(refused).toBeInstanceOf(UiError);
        expect((refused as UiError).ui).toEqual(expect.objectContaining({key: 'serverErrors.puzzle_not_found'}));

        stubFetch(new TypeError('Failed to fetch'));
        const offline = await apiRequest('/feed/posts/1').catch((err: unknown) => err);
        expect((offline as UiError).ui).toEqual(expect.objectContaining({key: 'common.noConnection'}));
    });
});
