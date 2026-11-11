// --- FILE: frontend/src/test/mocks.ts ---
// Общие тестовые дублёры для компонентных тестов Chessboard: gameSocket (WS не поднимаем —
// просто фиксируем send() и позволяем тесту вручную дёргать зарегистрированные обработчики
// событий) и маршрутизатор fetch по префиксу URL.

import {vi, type Mock} from 'vitest';

export function emitSocketEvent(onMock: Mock, event: string, data: any) {
    const call = onMock.mock.calls.find(([name]: [string]) => name === event);
    call?.[1]?.(data);
}

type FetchHandler = () => unknown;

/**
 * vi.fn() для global.fetch: сравнивает URL по includes() с ключами handlers (порядок проверки —
 * порядок объявления) и возвращает {ok: true, json: () => handler()}. Непойманные запросы —
 * {ok: false} (ровно то, что делает graceful-деградация в самом компоненте).
 */
export function mockFetchRouter(handlers: Record<string, FetchHandler>) {
    return vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        for (const [pattern, handler] of Object.entries(handlers)) {
            if (url.includes(pattern)) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => handler(),
                    text: async () => JSON.stringify(handler()),
                } as Response;
            }
        }
        return {ok: false, status: 404, json: async () => ({}), text: async () => ''} as Response;
    });
}
