// --- FILE: frontend/src/i18n/messages/languageNames.ts ---
// Самоназвания языков. Не переводятся: в переключателе язык ищут по его собственному названию,
// поэтому «Українська» пишется по-украински при любом языке интерфейса.

import type {Language} from '../core';

export const LANGUAGE_NATIVE_NAMES: Record<Language, string> = {
    en: 'English',
    uk: 'Українська',
    ru: 'Русский',
};
