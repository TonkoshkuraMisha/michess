// Единый словарь шахматных терминов (таск 17.7): термин в каталоге пишется одинаково везде.

import {describe, expect, it} from 'vitest';
import {LANGUAGES} from '../index';
import {GLOSSARY} from '../messages/glossary';
import {catalogEntries, findKeysByText} from '../catalogIndex';

describe('словарь терминов', () => {
    it('у каждого термина есть все три языка, без повторов', () => {
        expect(new Set(GLOSSARY.map((term) => term.id)).size).toBe(GLOSSARY.length);
        for (const term of GLOSSARY) for (const language of LANGUAGES) expect(term[language].trim()).not.toBe('');
    });

    for (const language of LANGUAGES) {
        it(`в каталоге ${language} нет нежелательных написаний терминов`, () => {
            const problems: string[] = [];
            for (const term of GLOSSARY) {
                for (const source of term.avoid?.[language] ?? []) {
                    const pattern = new RegExp(`(?<!\\p{L})${source}`, 'iu');
                    for (const entry of catalogEntries(language)) {
                        if (entry.texts.some((text) => pattern.test(text))) problems.push(`${term.id}: ${entry.key} ~ /${source}/`);
                    }
                }
            }
            expect(problems).toEqual([]);
        });
    }

    it('нежелательные варианты не совпадают с самим термином', () => {
        for (const term of GLOSSARY) {
            for (const language of LANGUAGES) {
                for (const source of term.avoid?.[language] ?? []) {
                    expect(new RegExp(`(?<!\\p{L})${source}`, 'iu').test(term[language])).toBe(false);
                }
            }
        }
    });

    it('в словах кириллицы нет латинских букв-двойников', () => {
        const mixed = /\p{Script=Cyrillic}[a-zA-Z]|[a-zA-Z]\p{Script=Cyrillic}/u;
        for (const language of ['uk', 'ru'] as const) {
            const bad = catalogEntries(language).filter((entry) => entry.texts.some((text) => mixed.test(text))).map((e) => e.key);
            expect(bad).toEqual([]);
        }
    });
});

describe('поиск ключа по тексту', () => {
    it('находит точный текст и шаблон с параметрами', () => {
        expect(findKeysByText('ru', 'Сквозной удар')).toContain('themes.skewer.name');
        expect(findKeysByText('ru', 'Жалоба отправлена')).toEqual(['moderation.reportSent']);
        expect(findKeysByText('ru', 'от magnus')).toContain('moderation.from');
        expect(findKeysByText('ru', '   ')).toEqual([]);
    });
});
