// --- FILE: frontend/src/services/themes.ts ---
// Реестр тактических приёмов (таск 13.0): коды, разделы и родители — с сервера (GET /api/v1/themes), названия и
// объяснения — из каталогов (themes.<код>.name / .short / .explain) на языке игрока.

import {API_BASE_URL} from '../config/api';
import {hasMessage, uiMessage} from '../i18n';
import type {I18n} from '../i18n';
import {UiError} from './apiErrors';

export type ThemeSection = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';
export type ThemeTextPart = 'name' | 'short' | 'explain';

export interface ThemeInfo {
    code: string;
    section: ThemeSection;
    parent: string | null;
    sources: ('D' | 'L' | 'M')[];
    minimums: [number, number, number, number];
}

export interface ThemeRegistry {
    sections: ThemeSection[];
    themes: ThemeInfo[];
}

let cached: Promise<ThemeRegistry> | null = null;

export function fetchThemeRegistry(): Promise<ThemeRegistry> {
    if (!cached) {
        cached = fetch(`${API_BASE_URL}/api/v1/themes`)
            .then((res) => {
                if (!res.ok) throw new UiError(uiMessage('common.networkError'));
                return res.json() as Promise<ThemeRegistry>;
            })
            .then((registry) => ({...registry, themes: registry.themes.filter((theme) => isKnownTheme(theme.code))}))
            .catch((err) => {
                cached = null;
                throw err;
            });
    }
    return cached;
}

/** Для тестов: сбросить закэшированный реестр. */
export function resetThemeRegistryCache(): void {
    cached = null;
}

/** Тема известна клиенту (есть тексты): новая тема сервера без текстов у старого клиента не показывается. */
export function isKnownTheme(code: string): boolean {
    return /^[a-z][a-z0-9_]*$/.test(code) && hasMessage(`themes.${code}.name`);
}

/** Название, краткое или подробное объяснение темы на языке игрока; неизвестная тема — её код. */
export function themeText(code: string, part: ThemeTextPart, t: I18n['t']): string {
    const key = `themes.${code}.${part}`;
    return hasMessage(key) ? t(key as never) : code;
}

/** Темы раздела в порядке реестра. */
export function themesOfSection(registry: ThemeRegistry, section: ThemeSection): ThemeInfo[] {
    return registry.themes.filter((theme) => theme.section === section);
}

/** Дочерние темы (например, виды вилки). */
export function childThemes(registry: ThemeRegistry, code: string): ThemeInfo[] {
    return registry.themes.filter((theme) => theme.parent === code);
}
