// --- FILE: frontend/src/i18n/index.tsx ---
// Текущий язык и перевод. Язык — модульное хранилище (useSyncExternalStore), а не React-контекст: перевод
// нужен и вне компонентов (сервис WebSocket, звуки, конфиги), и компоненты работают без обёртки-провайдера —
// в том числе в тестах, где их отрисовывают поодиночке.

import {Fragment, useMemo, useSyncExternalStore, type ReactNode} from 'react';
import {enUS, ru as ruDateLocale, uk as ukDateLocale, type Locale} from 'date-fns/locale';
import {
    detectLanguage,
    interpolate,
    interpolateParts,
    isLanguage,
    isPlural,
    lookup,
    selectPlural,
    type Language,
    type Params,
    type PluralKey,
    type TextKey,
} from './core';
import {en, type Messages} from './messages/en';
import {uk} from './messages/uk';
import {ru} from './messages/ru';

export * from './core';
export {LANGUAGE_NATIVE_NAMES} from './messages/languageNames';
export type {Messages};

export const CATALOGS: Record<Language, Messages> = {en, uk, ru};

export type MessageKey = TextKey<Messages>;
export type MessagePluralKey = PluralKey<Messages>;

const DATE_LOCALES: Record<Language, Locale> = {en: enUS, uk: ukDateLocale, ru: ruDateLocale};

export const LANGUAGE_STORAGE_KEY = 'michess_language';

function readStoredLanguage(): Language | null {
    try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        return isLanguage(stored) ? stored : null;
    } catch {
        return null;
    }
}

function browserLanguages(): readonly string[] {
    if (typeof navigator === 'undefined') return [];
    return navigator.languages?.length ? navigator.languages : [navigator.language ?? ''];
}

let currentLanguage: Language = readStoredLanguage() ?? detectLanguage(browserLanguages());
const listeners = new Set<() => void>();

function applyDocumentLanguage(language: Language) {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
}

applyDocumentLanguage(currentLanguage);

export function getLanguage(): Language {
    return currentLanguage;
}

export function setLanguage(language: Language, {persist = true}: { persist?: boolean } = {}): void {
    if (persist) {
        try {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
        } catch {
            // приватный режим или запрет хранилища — язык просто не запомнится
        }
    }
    if (language === currentLanguage) return;
    currentLanguage = language;
    applyDocumentLanguage(language);
    listeners.forEach((listener) => listener());
}

export function subscribeLanguage(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function reportMissing(language: Language, key: string) {
    if (import.meta.env.DEV) console.error(`[i18n] missing message "${key}" for language ${language}`);
}

export function translate(language: Language, key: MessageKey, params?: Params): string {
    const value = lookup(CATALOGS[language], key);
    if (typeof value === 'string') return interpolate(value, params);
    reportMissing(language, key);
    const fallback = lookup(CATALOGS.en, key);
    return typeof fallback === 'string' ? interpolate(fallback, params) : key;
}

export function translatePlural(language: Language, key: MessagePluralKey, count: number, params?: Params): string {
    const value = lookup(CATALOGS[language], key);
    const message = isPlural(value) ? value : lookup(CATALOGS.en, key);
    if (!isPlural(message)) {
        reportMissing(language, key);
        return key;
    }
    return interpolate(selectPlural(language, message, count), {count, ...params});
}

/** Перевод на текущем языке — для кода вне компонентов. В компонентах — useI18n(), чтобы перерисоваться при смене. */
export function t(key: MessageKey, params?: Params): string {
    return translate(currentLanguage, key, params);
}

export function tp(key: MessagePluralKey, count: number, params?: Params): string {
    return translatePlural(currentLanguage, key, count, params);
}

/** Локаль date-fns текущего языка — для форматирования дат вне компонентов. */
export function getDateLocale(): Locale {
    return DATE_LOCALES[currentLanguage];
}

export interface I18n {
    language: Language;
    t: (key: MessageKey, params?: Params) => string;
    tp: (key: MessagePluralKey, count: number, params?: Params) => string;
    /** Сообщение, в которое подставлены элементы (ссылки, выделение): предложение целиком остаётся в каталоге. */
    rich: (key: MessageKey, params: Record<string, ReactNode | string | number>) => ReactNode;
    dateLocale: Locale;
    setLanguage: (language: Language) => void;
}

export function makeI18n(language: Language): I18n {
    return {
        language,
        t: (key, params) => translate(language, key, params),
        tp: (key, count, params) => translatePlural(language, key, count, params),
        rich: (key, params) => {
            const template = translate(language, key);
            const parts = interpolateParts<ReactNode>(template, params);
            return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
        },
        dateLocale: DATE_LOCALES[language],
        setLanguage,
    };
}

export function useI18n(): I18n {
    const language = useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
    return useMemo(() => makeI18n(language), [language]);
}

/**
 * Сообщение для показа: ключ каталога с параметрами (переводится при каждом показе — значит, и после смены
 * языка) или текст как есть (имя, присланное сервером, или текст ошибки, кода которой клиент ещё не знает).
 * Параметр сам может быть сообщением: «Бот не смог сделать ход: {detail}», где detail — ошибка сервера.
 */
export type UiMessage = { key: MessageKey; params?: Record<string, MessageParam> } | { text: string };

export type MessageParam = string | number | UiMessage;

export function uiMessage(key: MessageKey, params?: Record<string, MessageParam>): UiMessage {
    return params ? {key, params} : {key};
}

/** Есть ли такой ключ-строка в каталоге (эталон — английский): для кодов, пришедших с сервера. */
export function hasMessage(key: string): key is MessageKey {
    return typeof lookup(CATALOGS.en, key) === 'string';
}

export function renderUiMessage(message: UiMessage, translateFn: I18n['t']): string {
    if ('text' in message) return message.text;
    if (!message.params) return translateFn(message.key);
    const rendered: Params = {};
    for (const [name, param] of Object.entries(message.params)) {
        rendered[name] = typeof param === 'object' ? renderUiMessage(param, translateFn) : param;
    }
    return translateFn(message.key, rendered);
}
