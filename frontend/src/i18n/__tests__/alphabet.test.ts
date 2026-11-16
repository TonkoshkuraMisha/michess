// Каталоги на своём алфавите: в украинском нет русских букв (ы, э, ъ, ё), в русском — украинских (і, ї, є, ґ);
// в английском нет кириллицы. Ловит тексты, скопированные в чужой каталог без перевода.

import {describe, expect, it} from 'vitest';
import {en} from '../messages/en';
import {uk} from '../messages/uk';
import {ru} from '../messages/ru';

function flatten(value: unknown, prefix = ''): [string, string][] {
    if (typeof value === 'string') return [[prefix, value]];
    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, inner]) => flatten(inner, prefix ? `${prefix}.${key}` : key));
    }
    return [];
}

// Имена собственные и цитаты, где «чужая» буква законна (ключ → причина).
const ALLOWED: Record<string, RegExp> = {};

function offenders(catalog: unknown, forbidden: RegExp): string[] {
    return flatten(catalog)
        .filter(([key, text]) => forbidden.test(text) && !(ALLOWED[key]?.test(text)))
        .map(([key, text]) => `${key}: ${text.slice(0, 100)}`);
}

describe('алфавит каталогов', () => {
    it('каталоги прочитаны целиком', () => {
        expect(flatten(uk).length).toBeGreaterThan(3000);
        expect(flatten(ru).length).toBe(flatten(uk).length);
    });

    it('украинский — без русских букв', () => {
        const found = offenders(uk, /[ыэъёЫЭЪЁ]/);
        expect(found, `\n${found.join('\n')}`).toEqual([]);
    });

    it('русский — без украинских букв', () => {
        const found = offenders(ru, /[іїєґІЇЄҐ]/);
        expect(found, `\n${found.join('\n')}`).toEqual([]);
    });

    it('английский — без кириллицы', () => {
        const found = offenders(en, /[Ѐ-ӿ]/);
        expect(found, `\n${found.join('\n')}`).toEqual([]);
    });
});

// Тексты контента (уроки, классика, курсы): поля uk / ru / en внутри JSON.
const CONTENT = import.meta.glob<unknown>('../../content/**/*.json', {eager: true, import: 'default'});

function localized(value: unknown, path: string, out: [string, string, string][]) {
    if (Array.isArray(value)) {
        value.forEach((inner, i) => localized(inner, `${path}[${i}]`, out));
    } else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
            if ((key === 'uk' || key === 'ru' || key === 'en') && typeof inner === 'string') out.push([`${path}.${key}`, key, inner]);
            else localized(inner, `${path}.${key}`, out);
        }
    }
}

describe('алфавит текстов контента', () => {
    it('uk / ru / en в JSON — на своём алфавите', () => {
        const texts: [string, string, string][] = [];
        for (const [file, data] of Object.entries(CONTENT)) localized(data, file.replace('../../content/', ''), texts);
        expect(texts.length).toBeGreaterThan(500);
        const forbidden: Record<string, RegExp> = {uk: /[ыэъёЫЭЪЁ]/, ru: /[іїєґІЇЄҐ]/, en: /[Ѐ-ӿ]/};
        const found = texts.filter(([, lang, text]) => forbidden[lang].test(text)).map(([path, , text]) => `${path}: ${text.slice(0, 90)}`);
        expect(found, `\n${found.join('\n')}`).toEqual([]);
    });
});
