// --- FILE: frontend/src/services/themes.ts ---
// Реестр тактических приёмов (таск 13.0): коды, разделы и родители — с сервера (GET /api/v1/themes), названия и
// объяснения — из каталогов (themes.<код>.name / .short / .explain) на языке игрока.
// Источник правды — src/services/themes.py (описание тем — docs/training/tactical-themes.md); маршрут —
// src/api/themes.py, открыт без входа.

import {API_BASE_URL} from '../config/api';
import {hasMessage, uiMessage} from '../i18n';
import type {I18n} from '../i18n';
import {UiError} from './apiErrors';

/** Разделы каталога приёмов A–L; названия разделов — в каталоге переводов. */
export type ThemeSection = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';
/** Какой текст темы нужен: название, краткое или подробное объяснение. */
export type ThemeTextPart = 'name' | 'short' | 'explain';

/** Тема реестра, как её отдаёт сервер. */
export interface ThemeInfo {
    /** Неизменный код темы — ключ в базе задач, в прогрессе игрока и в каталоге текстов. */
    code: string;
    section: ThemeSection;
    /** Код родительской темы (например, у видов вилки родитель — вилка); null — тема верхнего уровня. */
    parent: string | null;
    /** Чем размечаются задачи темы: D — детектор мотивов, L — тег открытой базы задач, M — ручная разметка. */
    sources: ('D' | 'L' | 'M')[];
    /** Сколько задач нужно на каждой из четырёх ступеней, чтобы тему можно было выдавать «по теме». */
    minimums: [number, number, number, number];
}

/** Ответ GET /api/v1/themes: разделы и темы в порядке каталога. */
export interface ThemeRegistry {
    sections: ThemeSection[];
    themes: ThemeInfo[];
}

let cached: Promise<ThemeRegistry> | null = null;

/**
 * Реестр тем: один запрос на вкладку (результат кэшируется), после ошибки следующий вызов идёт в сеть заново.
 * Темы, для которых у клиента ещё нет текстов (сервер новее), отбрасываются.
 */
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
