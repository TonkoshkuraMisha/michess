// --- FILE: frontend/src/services/profileSettings.ts ---
// Настройки профиля на сервере (таск 17.7): язык интерфейса, режим «помощник перевода», тема-комплект и аватар —
// PATCH /api/v1/profile/me/settings (src/api/profile.py, поля таблицы users). Читаются они вместе с профилем
// (GET /profile/me в App.tsx). Флаг режима перевода — маленькое общее хранилище: его выставляет App по профилю и
// переключает страница настроек.

import {API_BASE_URL} from '../config/api';
import type {Language} from '../i18n';
import {getToken} from './authToken';

/** Настройки профиля, как их возвращает сервер после сохранения. */
export interface ProfileSettings {
    language: Language | null;
    translation_helper: boolean;
    /** Ключ темы-комплекта (config/themePresets.ts). */
    theme_preset: string | null;
    /** Аватар — код фигуры и номер фона вида «wN-3» (сервер проверяет формат). */
    avatar: string | null;
}

/**
 * Сохранить часть настроек: сервер меняет только присланные поля и возвращает все четыре. null — игрок не вошёл или
 * сервер отказал (причина отказа не разбирается).
 */
export async function saveProfileSettings(body: Partial<ProfileSettings>): Promise<ProfileSettings | null> {
    const token = getToken();
    if (!token) return null;
    const res = await fetch(`${API_BASE_URL}/api/v1/profile/me/settings`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify(body),
    });
    return res.ok ? res.json() as Promise<ProfileSettings> : null;
}

let helperOn = false;
const listeners = new Set<() => void>();

/** Включён ли режим «помощник перевода» (значение в памяти страницы, не в localStorage). */
export function isTranslationHelperOn(): boolean {
    return helperOn;
}

/** Переключить режим и оповестить подписчиков; на сервер значение отправляет вызывающий (saveProfileSettings). */
export function setTranslationHelper(value: boolean): void {
    if (helperOn === value) return;
    helperOn = value;
    listeners.forEach((listener) => listener());
}

/** Подписка на переключение режима (для useSyncExternalStore); возвращает функцию отписки. */
export function subscribeTranslationHelper(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
