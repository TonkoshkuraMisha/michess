// Доски (таск 18.1): координаты читаются на каждой доске (контраст WCAG ≥ 4,5), текстуры существуют, имена — в каталогах.

import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {BOARD_THEMES, DEFAULT_LAST_MOVE, lastMoveColor, textureLayerStyle} from '../boardAppearance';
import {CATALOGS, LANGUAGES} from '../../i18n';

function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const themes = Object.values(BOARD_THEMES);

describe('доски', () => {
    it('не меньше 22 досок, id совпадает с ключом', () => {
        expect(themes.length).toBeGreaterThanOrEqual(22);
        for (const [key, theme] of Object.entries(BOARD_THEMES)) expect(theme.id).toBe(key);
    });

    it.each(themes.map((theme) => [theme.id, theme] as const))('%s: координаты контрастны клетке (WCAG ≥ 4,5)', (_id, theme) => {
        expect(contrast(theme.coordLight, theme.light)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.coordDark, theme.dark)).toBeGreaterThanOrEqual(4.5);
    });

    it('у каждой доски есть название на трёх языках', () => {
        for (const language of LANGUAGES) {
            const names = CATALOGS[language].appearance.themes as Record<string, string>;
            for (const theme of themes) expect(names[theme.id], `${language}: ${theme.id}`).toBeTruthy();
        }
    });

    it('файлы текстур на месте', () => {
        for (const theme of themes) {
            if (theme.texture) expect(existsSync(resolve(__dirname, '../../../public/assets/textures', theme.texture.file)), theme.id).toBe(true);
        }
    });

    it('слой текстуры: режим наложения, рамка без слоя при 0, штриховка только на тёмных полях', () => {
        expect(textureLayerStyle(BOARD_THEMES.walnut, 'frame')).toMatchObject({opacity: 0.25, mixBlendMode: 'multiply'});
        expect(textureLayerStyle(BOARD_THEMES.glass, 'square')?.mixBlendMode).toBe('screen');
        expect(textureLayerStyle(BOARD_THEMES.maple, 'square')).toBeNull();
        expect(textureLayerStyle(BOARD_THEMES.newspaper, 'frame')).toBeNull();
        expect(textureLayerStyle(BOARD_THEMES.newspaper, 'square', false)).toBeNull();
        expect(textureLayerStyle(BOARD_THEMES.newspaper, 'square', true)?.backgroundImage).toContain('hatch.svg');
        expect(lastMoveColor(BOARD_THEMES.maple)).toBe(DEFAULT_LAST_MOVE);
        expect(lastMoveColor(BOARD_THEMES.neon)).not.toBe(DEFAULT_LAST_MOVE);
    });
});

describe('рамка фокуса клетки (таск 26.3, WCAG 1.4.11)', () => {
    // Рамка двухцветная — чёрная и белая (index.css, .board-square:focus-visible): на любой клетке любой темы хотя бы
    // один цвет должен отличаться от клетки с контрастом не ниже 3:1, иначе фокус с клавиатуры не видно.
    const RING = ['#000000', '#FFFFFF'];
    const MIN_NON_TEXT_CONTRAST = 3;

    it.each(themes.map((theme) => [theme.id, theme] as const))('%s: рамка видна на светлой и тёмной клетке', (_id, theme) => {
        for (const square of [theme.light, theme.dark]) {
            expect(Math.max(...RING.map((ring) => contrast(ring, square)))).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
        }
    });

    it('стиль рамки — эти два цвета', () => {
        const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
        const rule = css.slice(css.indexOf('.board-square:focus-visible'));
        for (const ring of RING) expect(rule).toContain(ring);
    });
});
