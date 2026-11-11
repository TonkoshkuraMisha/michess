// --- FILE: frontend/src/config/boardAppearance.ts ---

export interface BoardTheme {
    id: string;
    name: string;
    light: string;
    dark: string;
    coordLight: string;
    coordDark: string;
    border: string;
    useWoodGrain: boolean;
    isDarkBoard?: boolean;
}

export interface PieceSetConfig {
    id: string;
    name: string;
    shortName: string;
    folder: string;
    scalePercent: number;
    description: string;
    /** Автор и лицензия набора — показываются на странице «О проекте» (см. ATTRIBUTION.md). */
    author: string;
    license: string;
}

export const BOARD_THEMES: Record<string, BoardTheme> = {
    walnut: {
        id: 'walnut',
        name: 'Орех',
        light: '#DFC8A2',
        dark: '#966C46',
        coordLight: '#6E4B2A',
        coordDark: '#F3E5AB',
        border: '#2A1810',
        useWoodGrain: true,
        isDarkBoard: true
    },
    maple: {
        id: 'maple',
        name: 'Клён',
        light: '#F0D9B5',
        dark: '#B58863',
        coordLight: '#8C6239',
        coordDark: '#F0D9B5',
        border: '#3D2314',
        useWoodGrain: false,
        isDarkBoard: false
    },
    tournament: {
        id: 'tournament',
        name: 'Турнирная',
        light: '#EBECD0',
        dark: '#739552',
        coordLight: '#537133',
        coordDark: '#EBECD0',
        border: '#263318',
        useWoodGrain: false,
        isDarkBoard: false
    },
    slate: {
        id: 'slate',
        name: 'Графит',
        light: '#DEE3E6',
        dark: '#788A94',
        coordLight: '#4E5D66',
        coordDark: '#DEE3E6',
        border: '#1F292E',
        useWoodGrain: false,
        isDarkBoard: true
    },
    sapphire: {
        id: 'sapphire',
        name: 'Сапфир',
        light: '#ECEFF4',
        dark: '#6E88AC',
        coordLight: '#435B7D',
        coordDark: '#ECEFF4',
        border: '#233142',
        useWoodGrain: false,
        isDarkBoard: false
    }
};

// Только наборы со свободной лицензией, допускающей любое использование. Список должен совпадать
// с scripts/setup_piece_sets.py и ATTRIBUTION.md — это проверяет tests/test_assets_licensing.py.
export const PIECE_SETS: Record<string, PieceSetConfig> = {
    merida: {
        id: 'merida',
        name: 'Мерида (Классика)',
        shortName: 'Мерида',
        folder: 'merida',
        scalePercent: 93,
        description: 'Классические книжные фигуры с широкой короной',
        author: 'Armando Hernandez Marroquin',
        license: 'GPL-2.0-or-later'
    },
    outline: {
        id: 'outline',
        name: 'Контур',
        shortName: 'Контур',
        folder: 'outline',
        scalePercent: 94,
        description: 'Мерида с контрастной окантовкой — хорошо читается на тёмных досках',
        author: 'michess, на основе Merida (Armando Hernandez Marroquin)',
        license: 'GPL-2.0-or-later'
    },
    cburnett: {
        id: 'cburnett',
        name: 'Стаунтон (Турнирный)',
        shortName: 'Стаунтон',
        folder: 'cburnett',
        scalePercent: 92,
        description: 'Чистый современный турнирный стандарт',
        author: 'Colin M.L. Burnett',
        license: 'GPL-2.0-or-later'
    },
    chessnut: {
        id: 'chessnut',
        name: 'Орех (Плоский)',
        shortName: 'Орех',
        folder: 'chessnut',
        scalePercent: 92,
        description: 'Плоские современные фигуры с мягкими формами',
        author: 'Alexis Luengas',
        license: 'Apache-2.0'
    },
    fantasy: {
        id: 'fantasy',
        name: 'Фэнтези (Объёмный)',
        shortName: 'Фэнтези',
        folder: 'fantasy',
        scalePercent: 93,
        description: 'Объёмные фигуры с подробной прорисовкой',
        author: 'Maurizio Monge',
        license: 'MIT'
    },
    rhosgfx: {
        id: 'rhosgfx',
        name: 'Графика (Минимализм)',
        shortName: 'Графика',
        folder: 'rhosgfx',
        scalePercent: 92,
        description: 'Лаконичные геометричные фигуры',
        author: 'RhosGFX',
        license: 'CC0-1.0'
    }
};

/** Наборы, убранные из-за лицензии, — сохранённый выбор игрока переводится на близкий свободный. */
const RETIRED_PIECE_SETS: Record<string, string> = {
    cardinal: 'outline',
    maestro: 'fantasy',
    alpha: 'merida'
};

export function getSavedBoardThemeKey(): string {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('michess_board_theme');
        if (saved && BOARD_THEMES[saved]) return saved;
    }
    return 'walnut';
}

export function getSavedPieceSetKey(): string {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('michess_piece_set');
        if (saved && PIECE_SETS[saved]) return saved;
        if (saved && RETIRED_PIECE_SETS[saved]) return RETIRED_PIECE_SETS[saved];
    }
    return 'merida';
}

export function getPieceSvgUrl(pieceSetKey: string, color: string, type: string): string {
    const setConfig = PIECE_SETS[pieceSetKey] || PIECE_SETS.merida;
    return `/assets/pieces/${setConfig.folder}/${color}${type.toUpperCase()}.svg`;
}

export function getHarmoniousPieceStyle(
    pieceSetKey: string,
    boardThemeKey: string,
    pieceColor: string
): { width: string; height: string; filter: string } {
    const setConfig = PIECE_SETS[pieceSetKey] || PIECE_SETS.merida;
    const theme = BOARD_THEMES[boardThemeKey] || BOARD_THEMES.walnut;
    const isWhite = pieceColor === 'w';
    const size = `${setConfig.scalePercent}%`;

    if (setConfig.id === 'outline') {
        return {
            width: size,
            height: size,
            filter: 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.45))'
        };
    }

    if (theme.id === 'walnut' || theme.id === 'maple') {
        return {
            width: size,
            height: size,
            filter: isWhite
                ? 'sepia(0.08) brightness(1.01) drop-shadow(0 2px 2.5px rgba(0, 0, 0, 0.55))'
                : 'drop-shadow(0 0 1px rgba(255, 248, 225, 0.55)) drop-shadow(0 2.5px 3px rgba(0, 0, 0, 0.6))'
        };
    }

    return {
        width: size,
        height: size,
        filter: isWhite
            ? 'drop-shadow(0 2px 2.5px rgba(0, 0, 0, 0.5))'
            : 'drop-shadow(0 0 1px rgba(255, 255, 255, 0.5)) drop-shadow(0 2.5px 3px rgba(0, 0, 0, 0.55))'
    };
}
