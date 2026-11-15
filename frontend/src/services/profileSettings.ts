// --- FILE: frontend/src/services/profileSettings.ts ---
// Настройки профиля на сервере (таск 17.7): язык интерфейса и режим «помощник перевода». Флаг режима —
// маленькое общее хранилище: его выставляет App по профилю и переключает страница настроек.

import {API_BASE_URL} from '../config/api';
import type {Language} from '../i18n';
import {getToken} from './authToken';

export interface ProfileSettings {
    language: Language | null;
    translation_helper: boolean;
    theme_preset: string | null;
}

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

export function isTranslationHelperOn(): boolean {
    return helperOn;
}

export function setTranslationHelper(value: boolean): void {
    if (helperOn === value) return;
    helperOn = value;
    listeners.forEach((listener) => listener());
}

export function subscribeTranslationHelper(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
