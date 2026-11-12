// Мастерская соперников: гостевые персоналии в localStorage и их перенос в профиль после входа.

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    DEFAULT_CONFIG,
    GUEST_STORAGE_KEY,
    MAX_PERSONALITIES,
    createPersonality,
    deleteGuestPersonality,
    importGuestPersonalities,
    offerGuestPersonalityTransfer,
    readGuestPersonalities,
    saveGuestPersonality,
} from '../personalities';
import {UiError} from '../apiErrors';

const draft = (name: string, aggression = 0) => ({name, config: {...DEFAULT_CONFIG, aggression}});

function mockFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

/** Сообщение из UiError, брошенной функцией (гостевые ошибки — те же коды, что у сервера). */
function thrownUi(fn: () => unknown) {
    try {
        fn();
    } catch (err) {
        if (err instanceof UiError) return err.ui;
        throw err;
    }
    throw new Error('ничего не брошено');
}

describe('гостевые персоналии', () => {
    it('сохраняются, обновляются и удаляются в localStorage', () => {
        const created = saveGuestPersonality(draft('Гамбитёр', 80));
        expect(readGuestPersonalities()).toHaveLength(1);

        saveGuestPersonality(draft('Гамбитёр', -40), created.id as string);
        expect(readGuestPersonalities()[0].config.aggression).toBe(-40);

        deleteGuestPersonality(created.id as string);
        expect(readGuestPersonalities()).toEqual([]);
        expect(localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    });

    it('имя уникально без учёта регистра, и действует лимит', () => {
        saveGuestPersonality(draft('Tactician'));
        expect(thrownUi(() => saveGuestPersonality(draft('TACTICIAN'))))
            .toEqual({key: 'serverErrors.personality_duplicate'});

        for (let i = 1; i < MAX_PERSONALITIES; i++) saveGuestPersonality(draft(`Bot_${i}`));
        expect(thrownUi(() => saveGuestPersonality(draft('Overflow'))))
            .toEqual({key: 'serverErrors.personality_limit', params: {max: 20}});
    });

    it('испорченное хранилище не роняет страницу', () => {
        localStorage.setItem(GUEST_STORAGE_KEY, '{not json');
        expect(readGuestPersonalities()).toEqual([]);
    });
});

describe('перенос в профиль', () => {
    it('перенесённые удаляются из браузера, пропущенные остаются', async () => {
        saveGuestPersonality(draft('Fresh'));
        saveGuestPersonality(draft('Existing'));
        const fetchMock = mockFetch(200, {
            created: [{id: 7, name: 'Fresh', config: DEFAULT_CONFIG, created_at: '', updated_at: ''}],
            skipped: [{name: 'Existing', reason: 'personality_duplicate', params: {}}],
        });

        const result = await importGuestPersonalities('jwt');

        expect(result.skipped[0].name).toBe('Existing');
        expect(readGuestPersonalities().map((p) => p.name)).toEqual(['Existing']);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/api\/v1\/bots\/personalities\/import$/);
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
        expect(JSON.parse(init.body as string).items).toHaveLength(2);
    });

    it('без гостевых персоналий ничего не спрашивает и не шлёт', async () => {
        const fetchMock = mockFetch(200, {});
        const confirm = vi.fn(() => true);
        expect(await offerGuestPersonalityTransfer('jwt', confirm)).toBeNull();
        expect(confirm).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('отказ игрока оставляет персоналии в браузере', async () => {
        saveGuestPersonality(draft('Keep'));
        const fetchMock = mockFetch(200, {});
        expect(await offerGuestPersonalityTransfer('jwt', () => false)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(readGuestPersonalities()).toHaveLength(1);
    });

    it('ошибка сервера показывает его текст и ничего не теряет', async () => {
        saveGuestPersonality(draft('Keep'));
        mockFetch(409, {detail: 'Не больше 20 соперников в мастерской — удалите лишних'});
        await expect(importGuestPersonalities('jwt')).rejects.toThrow(/Не больше 20/);
        expect(readGuestPersonalities()).toHaveLength(1);
    });
});

describe('сервер', () => {
    it('создание шлёт имя и конфиг с токеном', async () => {
        const fetchMock = mockFetch(201, {id: 1, ...draft('Гамбитёр'), created_at: '', updated_at: ''});
        const saved = await createPersonality('jwt', draft('Гамбитёр', 60));
        expect(saved.id).toBe(1);
        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string).config.aggression).toBe(60);
    });
});
