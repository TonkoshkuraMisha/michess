// --- FILE: frontend/src/config/boardAppearance.ts ---

import {t} from '../i18n';

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
        get name() {
            return t('appearance.themes.walnut');
        },
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
        get name() {
            return t('appearance.themes.maple');
        },
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
        get name() {
            return t('appearance.themes.tournament');
        },
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
        get name() {
            return t('appearance.themes.slate');
        },
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
        get name() {
            return t('appearance.themes.sapphire');
        },
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
        get name() {
            return t('appearance.pieceSets.merida.name');
        },
        get shortName() {
            return t('appearance.pieceSets.merida.shortName');
        },
        folder: 'merida',
        scalePercent: 93,
        get description() {
            return t('appearance.pieceSets.merida.description');
        },
        author: 'Armando Hernandez Marroquin',
        license: 'GPL-2.0-or-later'
    },
    outline: {
        id: 'outline',
        get name() {
            return t('appearance.pieceSets.outline.name');
        },
        get shortName() {
            return t('appearance.pieceSets.outline.shortName');
        },
        folder: 'outline',
        scalePercent: 94,
        get description() {
            return t('appearance.pieceSets.outline.description');
        },
        get author() {
            return t('appearance.outlineAuthor');
        },
        license: 'GPL-2.0-or-later'
    },
    cburnett: {
        id: 'cburnett',
        get name() {
            return t('appearance.pieceSets.cburnett.name');
        },
        get shortName() {
            return t('appearance.pieceSets.cburnett.shortName');
        },
        folder: 'cburnett',
        scalePercent: 92,
        get description() {
            return t('appearance.pieceSets.cburnett.description');
        },
        author: 'Colin M.L. Burnett',
        license: 'GPL-2.0-or-later'
    },
    chessnut: {
        id: 'chessnut',
        get name() {
            return t('appearance.pieceSets.chessnut.name');
        },
        get shortName() {
            return t('appearance.pieceSets.chessnut.shortName');
        },
        folder: 'chessnut',
        scalePercent: 92,
        get description() {
            return t('appearance.pieceSets.chessnut.description');
        },
        author: 'Alexis Luengas',
        license: 'Apache-2.0'
    },
    fantasy: {
        id: 'fantasy',
        get name() {
            return t('appearance.pieceSets.fantasy.name');
        },
        get shortName() {
            return t('appearance.pieceSets.fantasy.shortName');
        },
        folder: 'fantasy',
        scalePercent: 93,
        get description() {
            return t('appearance.pieceSets.fantasy.description');
        },
        author: 'Maurizio Monge',
        license: 'MIT'
    },
    rhosgfx: {
        id: 'rhosgfx',
        get name() {
            return t('appearance.pieceSets.rhosgfx.name');
        },
        get shortName() {
            return t('appearance.pieceSets.rhosgfx.shortName');
        },
        folder: 'rhosgfx',
        scalePercent: 92,
        get description() {
            return t('appearance.pieceSets.rhosgfx.description');
        },
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
