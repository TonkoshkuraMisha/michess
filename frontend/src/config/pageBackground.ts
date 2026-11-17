// --- FILE: frontend/src/config/pageBackground.ts ---
// Фон страницы (таск 18.1): тихий тайл с тиснёным узором (собственные SVG в /assets/patterns, CC0) и палитра.
// Тиснение — светлый и тёмный штрих, поэтому один тайл подходит к любой тёмной палитре. «Пергамент» — приглушённый
// тёплый тон: интерфейс тёмный, на светлом фоне текст вне карточек не читался бы.

export const PAGE_PATTERNS = [
    'none', 'celtic', 'map', 'manuscript', 'circuit', 'bauhaus', 'marble',
    // Таск 31.1: осенние листья, паркет «ёлочкой», тетрадь в клетку.
    'leaves', 'parquet', 'notebook',
] as const;
export type PagePattern = (typeof PAGE_PATTERNS)[number];

export const PAGE_PALETTES = {
    room: '#2C221C', teal: '#12323C', parchment: '#3B3022',
    // Таск 31.1: сумерки осеннего парка, бутылочная зелень клуба, чернила школьной тетради.
    autumn: '#3A2814', bottle: '#1F3028', ink: '#252C3D',
} as const;
export type PagePalette = keyof typeof PAGE_PALETTES;

const PATTERN_KEY = 'michess_page_pattern';
const PALETTE_KEY = 'michess_page_palette';

function read(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function getSavedPagePattern(): PagePattern {
    const saved = read(PATTERN_KEY);
    return (PAGE_PATTERNS as readonly string[]).includes(saved ?? '') ? saved as PagePattern : 'none';
}

export function getSavedPagePalette(): PagePalette {
    const saved = read(PALETTE_KEY);
    return saved && saved in PAGE_PALETTES ? saved as PagePalette : 'room';
}

export function pageBackgroundStyle(pattern: PagePattern, palette: PagePalette): { backgroundColor: string; backgroundImage: string } {
    return {
        backgroundColor: PAGE_PALETTES[palette],
        backgroundImage: pattern === 'none' ? 'none' : `url('/assets/patterns/${pattern}.svg')`,
    };
}

/** Применить к странице (при запуске и при смене в настройках) и запомнить выбор. */
export function applyPageBackground(pattern = getSavedPagePattern(), palette = getSavedPagePalette(), persist = false): void {
    if (persist) {
        try {
            localStorage.setItem(PATTERN_KEY, pattern);
            localStorage.setItem(PALETTE_KEY, palette);
        } catch {
            // Хранилище недоступно — фон всё равно меняется до перезагрузки.
        }
    }
    if (typeof document === 'undefined') return;
    const style = pageBackgroundStyle(pattern, palette);
    document.body.style.backgroundColor = style.backgroundColor;
    document.body.style.backgroundImage = style.backgroundImage;
}
