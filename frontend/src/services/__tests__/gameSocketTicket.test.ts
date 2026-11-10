// --- FILE: frontend/src/services/__tests__/gameSocketTicket.test.ts ---

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {gameSocket} from '../gameSocket';

class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static instances: FakeWebSocket[] = [];
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((e: {data: string}) => void) | null = null;
    onclose: ((e: {code: number}) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;

    constructor(public url: string) {
        FakeWebSocket.instances.push(this);
    }

    send() {
    }

    close() {
    }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('gameSocket: подключение по одноразовому тикету', () => {
    let storage: Map<string, string>;
    let events: string[];

    beforeEach(() => {
        FakeWebSocket.instances = [];
        storage = new Map([['token', 'jwt.secret.token']]);
        events = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => storage.get(k) ?? null,
            setItem: (k: string, v: string) => storage.set(k, v),
            removeItem: (k: string) => storage.delete(k),
        });
        vi.stubGlobal('window', {dispatchEvent: (e: Event) => events.push(e.type)});
    });

    afterEach(() => {
        gameSocket.disconnect();
        vi.unstubAllGlobals();
    });

    it('кладёт в адрес WebSocket тикет, а не JWT', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => ({ticket: 'one-time'})});
        vi.stubGlobal('fetch', fetchMock);

        gameSocket.connect('jwt.secret.token');
        await flush();

        expect(fetchMock).toHaveBeenCalledOnce();
        const [, init] = fetchMock.mock.calls[0];
        expect(init.headers.Authorization).toBe('Bearer jwt.secret.token');
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(FakeWebSocket.instances[0].url).toContain('ticket=one-time');
        expect(FakeWebSocket.instances[0].url).not.toContain('jwt.secret.token');
    });

    it('при 401 на запрос тикета разлогинивает и не подключается', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false, status: 401}));

        gameSocket.connect('jwt.secret.token');
        await flush();

        expect(FakeWebSocket.instances).toHaveLength(0);
        expect(storage.has('token')).toBe(false);
        expect(events).toContain('michess-auth-expired');
    });

    it('закрытие с кодом 1008 (сессия отозвана) разлогинивает', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => ({ticket: 't'})}));

        gameSocket.connect('jwt.secret.token');
        await flush();
        FakeWebSocket.instances[0].onclose?.({code: 1008});

        expect(storage.has('token')).toBe(false);
        expect(events).toContain('michess-auth-expired');
    });

    it('не открывает сокет, если отключились, пока ждали тикет', async () => {
        let resolveFetch: (v: unknown) => void = () => {
        };
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => (resolveFetch = r))));

        gameSocket.connect('jwt.secret.token');
        gameSocket.disconnect();
        resolveFetch({ok: true, status: 200, json: async () => ({ticket: 'late'})});
        await flush();

        expect(FakeWebSocket.instances).toHaveLength(0);
    });
});
