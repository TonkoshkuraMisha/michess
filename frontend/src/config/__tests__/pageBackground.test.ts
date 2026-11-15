// Фон страницы (таск 18.1): узор и палитра применяются к странице и запоминаются; неизвестное — к значениям по умолчанию.

import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {PAGE_PATTERNS, applyPageBackground, getSavedPagePalette, getSavedPagePattern, pageBackgroundStyle} from '../pageBackground';

afterEach(() => {
    localStorage.clear();
    document.body.removeAttribute('style');
});

describe('фон страницы', () => {
    it('по умолчанию — без узора, цвет клубной комнаты', () => {
        expect(getSavedPagePattern()).toBe('none');
        expect(getSavedPagePalette()).toBe('room');
        expect(pageBackgroundStyle('none', 'room')).toEqual({backgroundColor: '#2C221C', backgroundImage: 'none'});
    });

    it('выбор применяется и запоминается; мусор в хранилище игнорируется', () => {
        applyPageBackground('celtic', 'teal', true);
        expect(document.body.style.backgroundImage).toContain('/assets/patterns/celtic.svg');
        expect(getSavedPagePattern()).toBe('celtic');
        expect(getSavedPagePalette()).toBe('teal');
        localStorage.setItem('michess_page_pattern', 'unknown');
        localStorage.setItem('michess_page_palette', 'pink');
        expect(getSavedPagePattern()).toBe('none');
        expect(getSavedPagePalette()).toBe('room');
    });

    it('файлы узоров на месте', () => {
        for (const pattern of PAGE_PATTERNS.filter((p) => p !== 'none')) {
            expect(existsSync(resolve(__dirname, '../../../public/assets/patterns', `${pattern}.svg`)), pattern).toBe(true);
        }
    });
});
