// --- FILE: frontend/src/i18n/catalogIndex.ts ---
// Плоский список «ключ → тексты» каталога (таск 17.7): словарь терминов проверяет по нему каталоги, а режим «помощник
// перевода» находит ключ по тексту, на который нажал игрок.

import {isPlural, type Language} from './core';
import {CATALOGS} from './index';

export interface CatalogEntry {
    key: string;
    /** Сама строка или все формы числа. */
    texts: string[];
}

function walk(node: unknown, prefix: string, out: CatalogEntry[]): void {
    if (typeof node === 'string') {
        out.push({key: prefix, texts: [node]});
    } else if (isPlural(node)) {
        out.push({key: prefix, texts: Object.values(node.forms).filter((v): v is string => typeof v === 'string')});
    } else if (node && typeof node === 'object') {
        for (const [key, child] of Object.entries(node)) walk(child, prefix ? `${prefix}.${key}` : key, out);
    }
}

const cache = new Map<Language, CatalogEntry[]>();

export function catalogEntries(language: Language): CatalogEntry[] {
    let entries = cache.get(language);
    if (!entries) {
        entries = [];
        walk(CATALOGS[language], '', entries);
        cache.set(language, entries);
    }
    return entries;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ключи, текст которых (с любыми подставленными параметрами) совпадает с показанным; точные совпадения — первыми. */
export function findKeysByText(language: Language, shown: string): string[] {
    const text = shown.replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const exact: string[] = [];
    const templated: string[] = [];
    for (const entry of catalogEntries(language)) {
        for (const template of entry.texts) {
            const normalized = template.replace(/\s+/g, ' ').trim();
            if (normalized === text) {
                exact.push(entry.key);
                break;
            }
            if (normalized.includes('{')) {
                const pattern = new RegExp(`^${normalized.split(/\{\w+\}/).map(escape).join('.+?')}$`, 's');
                if (pattern.test(text)) {
                    templated.push(entry.key);
                    break;
                }
            }
        }
    }
    return [...exact, ...templated];
}
