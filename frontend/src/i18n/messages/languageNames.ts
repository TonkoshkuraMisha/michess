// --- FILE: frontend/src/i18n/messages/languageNames.ts ---
// Самоназвания языков. Не переводятся: в переключателе язык ищут по его собственному названию,
// поэтому «Українська» пишется по-украински при любом языке интерфейса.

import type {Language} from '../core';

export const LANGUAGE_NATIVE_NAMES: Record<Language, string> = {
    en: 'English',
    uk: 'Українська',
    ru: 'Русский',
};

/**
 * Короткие подписи языков в компактном переключателе. Код языка в приложении — ISO 639-1 («uk» — украинский),
 * но в подписи украинский — «UA»: «UK» читается как Великобритания.
 */
export const LANGUAGE_SHORT_LABELS: Record<Language, string> = {
    en: 'EN',
    uk: 'UA',
    ru: 'RU',
};
