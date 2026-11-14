// Токен входа в памяти и refresh-cookie (таск 17.5).

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {clearToken, getToken, logout, onTokenChange, refreshSession, restoreSession, setToken} from '../authToken';

/** JWT с полем exp (подпись клиенту не нужна). */
function jwt(expSeconds: number): string {
    const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
    return `${b64({alg: 'HS256'})}.${b64({sub: '1', exp: expSeconds})}.signature`;
}

const ok = (body: unknown) => ({ok: true, status: 200, json: async () => body}) as Response;
const unauthorized = () => ({ok: false, status: 401, json: async () => ({})}) as Response;

beforeEach(() => {
    clearToken();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('сессия входа', () => {
    it('при загрузке убирает старый токен из localStorage и восстанавливает вход по cookie', async () => {
        localStorage.setItem('token', 'old-day-long-jwt');
        const fetchMock = vi.fn(async () => ok({access_token: 'fresh'}));
        vi.stubGlobal('fetch', fetchMock);

        expect(await restoreSession()).toBe('fresh');
        expect(getToken()).toBe('fresh');
        expect(localStorage.getItem('token')).toBeNull();
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/api\/v1\/auth\/refresh$/);
        expect(init).toMatchObject({method: 'POST', credentials: 'include'});
    });

    it('одновременные обновления делят один запрос', async () => {
        const fetchMock = vi.fn(async () => ok({access_token: 'fresh'}));
        vi.stubGlobal('fetch', fetchMock);
        await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('без сессии — гость; неудача не стирает вход, случившийся во время запроса', async () => {
        let answer: (r: Response) => void = () => undefined;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
            answer = resolve;
        })));
        const pending = refreshSession();
        setToken('logged-in-meanwhile');
        answer(unauthorized());
        expect(await pending).toBeNull();
        expect(getToken()).toBe('logged-in-meanwhile');

        clearToken();
        vi.stubGlobal('fetch', vi.fn(async () => unauthorized()));
        expect(await refreshSession()).toBeNull();
        expect(getToken()).toBeNull();
    });

    it('токен обновляется за минуту до истечения', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
        const fetchMock = vi.fn(async () => ok({access_token: 'next'}));
        vi.stubGlobal('fetch', fetchMock);
        setToken(jwt(Date.now() / 1000 + 15 * 60));  // 15 минут

        await vi.advanceTimersByTimeAsync(13 * 60 * 1000);
        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60 * 1000 + 10);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(getToken()).toBe('next');
    });

    it('выход сразу забывает токен и стирает сессию на сервере', async () => {
        const fetchMock = vi.fn(async () => ({ok: true, status: 204}) as Response);
        vi.stubGlobal('fetch', fetchMock);
        const seen: (string | null)[] = [];
        const unsubscribe = onTokenChange((token) => seen.push(token));
        setToken('t');

        await logout();
        unsubscribe();
        expect(getToken()).toBeNull();
        expect(seen).toEqual(['t', null]);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/api\/v1\/auth\/logout$/);
        expect(init).toMatchObject({method: 'POST', credentials: 'include'});
    });
});
