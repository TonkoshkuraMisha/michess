// --- FILE: frontend/src/i18n/core.ts ---
// Механизм каталогов сообщений: языки, множественное число, подстановка параметров, типизированные ключи.
// Тексты — в messages/*.ts; три каталога обязаны иметь одни и те же ключи (это проверяет TypeScript через тип
// Messages) и одни и те же параметры и формы числа (это проверяет тест i18n.test.ts).

export const LANGUAGES = ['en', 'uk', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';


export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Формы одного сообщения для разных чисел. Какие нужны — решает Intl.PluralRules языка. */
export interface Plural {
    readonly kind: 'plural';
    readonly forms: Partial<Record<PluralCategory, string>> & { other: string };
}

/** Сообщение с формами числа: plural({one: '{count} game', other: '{count} games'}). */
export function plural(forms: Plural['forms']): Plural {
    return {kind: 'plural', forms};
}

export function isPlural(value: unknown): value is Plural {
    return typeof value === 'object' && value !== null && (value as Plural).kind === 'plural';
}

// --- типы ключей -----------------------------------------------------------------------------------------

type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`;

/** Ключи обычных сообщений: «settings.title», «auth.login.submit»... */
export type TextKey<T, P extends string = ''> = {
    [K in keyof T & string]: T[K] extends string
        ? Join<P, K>
        : T[K] extends Plural
            ? never
            : TextKey<T[K], Join<P, K>>;
}[keyof T & string];

/** Ключи сообщений с формами числа. */
export type PluralKey<T, P extends string = ''> = {
    [K in keyof T & string]: T[K] extends string
        ? never
        : T[K] extends Plural
            ? Join<P, K>
            : PluralKey<T[K], Join<P, K>>;
}[keyof T & string];

export type Params = Record<string, string | number>;

// --- подстановка -------------------------------------------------------------------------------------------

const PLACEHOLDER = /\{(\w+)\}/g;

/** Имена параметров шаблона в порядке появления (для проверки каталогов). */
export function placeholders(template: string): string[] {
    return Array.from(template.matchAll(PLACEHOLDER), (match) => match[1]);
}

/**
 * Подставляет параметры в шаблон. Отсутствующий параметр остаётся видимым как {имя} — так ошибку видно на
 * экране и в тестах, а не получается тихо «undefined».
 */
export function interpolate(template: string, params?: Params): string {
    if (!params) return template;
    return template.replace(PLACEHOLDER, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
}

/**
 * Разбивает шаблон на куски: строки и подставленные значения любого типа (например, React-элементы — ссылки
 * внутри предложения). Предложение остаётся целым в каталоге, в код уходит только «куда вставить».
 */
export function interpolateParts<T>(template: string, params: Record<string, T | string | number>): Array<T | string> {
    const parts: Array<T | string> = [];
    let last = 0;
    for (const match of template.matchAll(PLACEHOLDER)) {
        const index = match.index ?? 0;
        if (index > last) parts.push(template.slice(last, index));
        const name = match[1];
        const value = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : match[0];
        parts.push(typeof value === 'number' ? String(value) : value);
        last = index + match[0].length;
    }
    if (last < template.length) parts.push(template.slice(last));
    return parts;
}

const pluralRulesCache = new Map<Language, Intl.PluralRules>();

export function pluralCategory(language: Language, count: number): PluralCategory {
    let rules = pluralRulesCache.get(language);
    if (!rules) {
        rules = new Intl.PluralRules(language);
        pluralRulesCache.set(language, rules);
    }
    return rules.select(count) as PluralCategory;
}

/** Нужные языку формы числа (для проверки каталогов): en — one/other, uk и ru — one/few/many/other. */
export function requiredPluralCategories(language: Language): PluralCategory[] {
    return new Intl.PluralRules(language).resolvedOptions().pluralCategories as PluralCategory[];
}

export function selectPlural(language: Language, value: Plural, count: number): string {
    const category = pluralCategory(language, count);
    return value.forms[category] ?? value.forms.other;
}

/** Значение по пути «a.b.c» в каталоге или undefined. */
export function lookup(catalog: unknown, key: string): unknown {
    let node: unknown = catalog;
    for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null || isPlural(node)) return undefined;
        node = (node as Record<string, unknown>)[part];
    }
    return node;
}

/** Выбор языка по списку языков браузера: украинский и русский — свои, всё остальное — английский. */
export function detectLanguage(preferred: readonly string[]): Language {
    for (const tag of preferred) {
        const base = tag.toLowerCase().split('-')[0];
        if ((LANGUAGES as readonly string[]).includes(base)) return base as Language;
    }
    return DEFAULT_LANGUAGE;
}

export function isLanguage(value: unknown): value is Language {
    return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
