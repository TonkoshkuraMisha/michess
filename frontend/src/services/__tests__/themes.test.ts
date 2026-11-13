// Реестр тактических приёмов на клиенте (таск 13.0).

import {afterEach, describe, expect, it, vi} from 'vitest';
import {makeI18n} from '../../i18n';
import {
    childThemes, fetchThemeRegistry, isKnownTheme, resetThemeRegistryCache, themeText, themesOfSection,
} from '../themes';
import type {ThemeRegistry} from '../themes';

const REGISTRY: ThemeRegistry = {
    sections: ['A', 'B'],
    themes: [
        {code: 'fork', section: 'A', parent: null, sources: ['D', 'L'], minimums: [25, 25, 20, 15]},
        {code: 'fork_knight', section: 'A', parent: 'fork', sources: ['D'], minimums: [25, 25, 20, 15]},
        {code: 'pin', section: 'B', parent: null, sources: ['D', 'L'], minimums: [25, 25, 20, 15]},
        {code: 'brand_new_theme', section: 'B', parent: null, sources: ['M'], minimums: [25, 25, 20, 15]},
    ],
};

afterEach(() => {
    vi.unstubAllGlobals();
    resetThemeRegistryCache();
});

describe('реестр тем', () => {
    it('загружается один раз; темы без текстов у клиента не показываются', async () => {
        const fetchMock = vi.fn(async () => ({ok: true, status: 200, json: async () => REGISTRY}) as Response);
        vi.stubGlobal('fetch', fetchMock);
        const registry = await fetchThemeRegistry();
        await fetchThemeRegistry();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(registry.themes.map((t) => t.code)).toEqual(['fork', 'fork_knight', 'pin']);
        expect(themesOfSection(registry, 'A').map((t) => t.code)).toEqual(['fork', 'fork_knight']);
        expect(childThemes(registry, 'fork').map((t) => t.code)).toEqual(['fork_knight']);
    });

    it('ошибка сети — повторная попытка снова идёт в сеть', async () => {
        const fetchMock = vi.fn(async () => ({ok: false, status: 503, json: async () => ({})}) as Response);
        vi.stubGlobal('fetch', fetchMock);
        await expect(fetchThemeRegistry()).rejects.toBeTruthy();
        await expect(fetchThemeRegistry()).rejects.toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('тексты на трёх языках, неизвестная тема — код', () => {
        const ru = makeI18n('ru').t;
        const en = makeI18n('en').t;
        const uk = makeI18n('uk').t;
        expect(themeText('fork_knight', 'name', ru)).toBe('Вилка конём');
        expect(themeText('fork_knight', 'name', en)).toBe('Knight fork');
        expect(themeText('fork_knight', 'name', uk)).toBe('Вилка конем');
        expect(themeText('pin', 'explain', uk)).toContain('зв’язана');
        expect(themeText('mystery', 'name', ru)).toBe('mystery');
        expect(isKnownTheme('mate_in_3')).toBe(true);
        expect(isKnownTheme('Bad Code')).toBe(false);
    });
});
