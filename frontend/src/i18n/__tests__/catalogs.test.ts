// --- FILE: frontend/src/i18n/__tests__/catalogs.test.ts ---
// Целостность каталогов: одинаковые ключи гарантирует TypeScript (тип Messages), а этот тест — всё, что
// типами не выразить: одинаковые параметры во всех языках, полный набор форм числа, отсутствие пустых строк
// и букв чужого языка (так ловится строка, которую забыли перевести или скопировали из соседнего каталога).

import {describe, expect, it} from 'vitest';
import {
    CATALOGS,
    LANGUAGES,
    isPlural,
    placeholders,
    requiredPluralCategories,
    type Language,
    type Plural,
} from '../index';

type Leaf = { key: string; value: string | Plural };

function leaves(node: unknown, prefix = ''): Leaf[] {
    if (typeof node === 'string' || isPlural(node)) return [{key: prefix, value: node as string | Plural}];
    return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
        leaves(child, prefix ? `${prefix}.${key}` : key));
}

const byLanguage = Object.fromEntries(
    LANGUAGES.map((language) => [language, new Map(leaves(CATALOGS[language]).map((leaf) => [leaf.key, leaf.value]))]),
) as Record<Language, Map<string, string | Plural>>;

const texts = (value: string | Plural): string[] => (typeof value === 'string' ? [value] : Object.values(value.forms));
const paramSet = (value: string | Plural): string[] =>
    [...new Set(texts(value).flatMap(placeholders))].filter((name) => name !== 'count').sort();

// Буквы, которых нет в языке: в украинском не бывает ы/э/ъ/ё, в русском — і/ї/є/ґ.
const FOREIGN_LETTERS: Record<Language, RegExp> = {
    en: /[Ѐ-ӿ]/,
    uk: /[ыэъёЫЭЪЁ]/,
    ru: /[іїєґІЇЄҐ]/,
};

describe('каталоги сообщений', () => {
    const keys = [...byLanguage.en.keys()];

    it('во всех языках одни и те же ключи', () => {
        for (const language of LANGUAGES) {
            expect([...byLanguage[language].keys()].sort()).toEqual([...keys].sort());
        }
    });

    it.each(keys)('«%s»: одинаковые параметры во всех языках', (key) => {
        const expected = paramSet(byLanguage.en.get(key)!);
        for (const language of LANGUAGES) {
            expect(paramSet(byLanguage[language].get(key)!), `${language}: ${key}`).toEqual(expected);
        }
    });

    it.each(LANGUAGES)('%s: все формы множественного числа на месте и с {count}', (language) => {
        const required = requiredPluralCategories(language);
        for (const [key, value] of byLanguage[language]) {
            if (!isPlural(value)) continue;
            for (const category of required) {
                expect(value.forms[category], `${language}: ${key} — нет формы ${category}`).toBeTruthy();
                expect(value.forms[category], `${language}: ${key}.${category}`).toContain('{count}');
            }
        }
    });

    it.each(LANGUAGES)('%s: нет пустых строк и букв чужого языка', (language) => {
        for (const [key, value] of byLanguage[language]) {
            for (const text of texts(value)) {
                expect(text.trim(), `${language}: ${key} пуст`).not.toBe('');
                expect(FOREIGN_LETTERS[language].test(text), `${language}: ${key} = «${text}»`).toBe(false);
            }
        }
    });

    it('ключ в виде формы числа один и тот же во всех языках', () => {
        for (const key of keys) {
            const kinds = LANGUAGES.map((language) => isPlural(byLanguage[language].get(key)));
            expect(new Set(kinds).size, key).toBe(1);
        }
    });
});
