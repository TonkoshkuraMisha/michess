// --- FILE: frontend/src/config/boardAppearance.ts ---
// Оформление доски: темы (цвета клеток, рамка, текстура, цвет подсветки последнего хода) и наборы фигур с автором и
// лицензией каждого набора — они показываются на странице «О проекте» и записаны в ATTRIBUTION.md. Выбор игрока
// хранится в браузере.

import {t} from '../i18n';

export interface BoardTheme {
    id: string;
    name: string;
    light: string;
    dark: string;
    coordLight: string;
    coordDark: string;
    border: string;
    /** Процедурная текстура (таск 18.1) поверх цвета: рамки и клеток, с режимом наложения. */
    texture?: BoardTexture;
    /** Подсветка последнего хода под эту доску; по умолчанию — янтарная. */
    lastMove?: string;
    isDarkBoard?: boolean;
}

export interface BoardTexture {
    /** Файл в /assets/textures (собственная работа проекта, ATTRIBUTION.md). */
    file: string;
    /** Непрозрачность на рамке и на клетках (0 — не накладывать). */
    frame: number;
    square: number;
    blend: 'multiply' | 'screen';
    /** Только на тёмных полях (штриховка газетной диаграммы). */
    darkOnly?: boolean;
}

export const DEFAULT_LAST_MOVE = 'rgba(252, 211, 77, 0.38)';

/** Стиль слоя текстуры клетки или рамки; null — слой не нужен. */
export function textureLayerStyle(theme: BoardTheme, where: 'frame' | 'square', isDark = false): {
    backgroundImage: string; opacity: number; mixBlendMode: 'multiply' | 'screen'
} | null {
    const texture = theme.texture;
    if (!texture) return null;
    const opacity = where === 'frame' ? texture.frame : texture.square;
    if (!opacity || (where === 'square' && texture.darkOnly && !isDark)) return null;
    return {backgroundImage: `url('/assets/textures/${texture.file}')`, opacity, mixBlendMode: texture.blend};
}

export function lastMoveColor(theme: BoardTheme): string {
    return theme.lastMove ?? DEFAULT_LAST_MOVE;
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
        coordLight: '#6C4E32',
        coordDark: '#FFFEFE',
        border: '#2A1810',
        texture: {file: 'wood-grain.svg', frame: 0.25, square: 0.15, blend: 'multiply'},
        isDarkBoard: true
    },
    maple: {
        id: 'maple',
        get name() {
            return t('appearance.themes.maple');
        },
        light: '#F0D9B5',
        dark: '#B58863',
        coordLight: '#775A41',
        coordDark: '#2B2721',
        border: '#3D2314',
        isDarkBoard: false
    },
    tournament: {
        id: 'tournament',
        get name() {
            return t('appearance.themes.tournament');
        },
        light: '#EBECD0',
        dark: '#739552',
        coordLight: '#56703E',
        coordDark: '#23231F',
        border: '#263318',
        isDarkBoard: false
    },
    slate: {
        id: 'slate',
        get name() {
            return t('appearance.themes.slate');
        },
        light: '#DEE3E6',
        dark: '#788A94',
        coordLight: '#58656C',
        coordDark: '#1D1E1E',
        border: '#1F292E',
        isDarkBoard: true
    },
    sapphire: {
        id: 'sapphire',
        get name() {
            return t('appearance.themes.sapphire');
        },
        light: '#ECEFF4',
        dark: '#6E88AC',
        coordLight: '#576B88',
        coordDark: '#1C1D1D',
        border: '#233142',
        isDarkBoard: false
    },
    oak: {
        id: 'oak',
        get name() {
            return t('appearance.themes.oak');
        },
        light: '#E8D3AE',
        dark: '#B98D5C',
        coordLight: '#715638',
        coordDark: '#312C25',
        border: '#4A3220',
        texture: {file: 'wood-fine.svg', frame: 0.3, square: 0.22, blend: 'multiply'},
        isDarkBoard: false
    },
    cherry: {
        id: 'cherry',
        get name() {
            return t('appearance.themes.cherry');
        },
        light: '#E9C9A7',
        dark: '#9C5A3C',
        coordLight: '#7E4931',
        coordDark: '#F8EDE1',
        border: '#3B1D12',
        texture: {file: 'wood-fine.svg', frame: 0.3, square: 0.2, blend: 'multiply'},
        isDarkBoard: true
    },
    ebony: {
        id: 'ebony',
        get name() {
            return t('appearance.themes.ebony');
        },
        light: '#C9B79C',
        dark: '#3E2E25',
        coordLight: '#3E2E25',
        coordDark: '#C9B79C',
        border: '#120B07',
        texture: {file: 'wood-fine.svg', frame: 0.35, square: 0.25, blend: 'multiply'},
        lastMove: 'rgba(232, 176, 76, 0.45)',
        isDarkBoard: true
    },
    marble: {
        id: 'marble',
        get name() {
            return t('appearance.themes.marble');
        },
        light: '#F2F0EA',
        dark: '#B9B5AC',
        coordLight: '#6D6B65',
        coordDark: '#464644',
        border: '#5E5A52',
        texture: {file: 'marble.svg', frame: 0.35, square: 0.3, blend: 'multiply'},
        isDarkBoard: false
    },
    malachite: {
        id: 'malachite',
        get name() {
            return t('appearance.themes.malachite');
        },
        light: '#E3EBE2',
        dark: '#4F7A63',
        coordLight: '#486F5A',
        coordDark: '#F6F9F6',
        border: '#1D3326',
        texture: {file: 'marble.svg', frame: 0.35, square: 0.28, blend: 'multiply'},
        isDarkBoard: true
    },
    stone: {
        id: 'stone',
        get name() {
            return t('appearance.themes.stone');
        },
        light: '#CFCBC3',
        dark: '#7D776E',
        coordLight: '#59544E',
        coordDark: '#040404',
        border: '#2E2A25',
        texture: {file: 'stone.svg', frame: 0.4, square: 0.3, blend: 'multiply'},
        isDarkBoard: false
    },
    glass: {
        id: 'glass',
        get name() {
            return t('appearance.themes.glass');
        },
        light: '#D8EEF4',
        dark: '#6FA3B8',
        coordLight: '#4A6D7B',
        coordDark: '#2D3233',
        border: '#1E3A46',
        texture: {file: 'glass.svg', frame: 0.6, square: 0.5, blend: 'screen'},
        isDarkBoard: false
    },
    steel: {
        id: 'steel',
        get name() {
            return t('appearance.themes.steel');
        },
        light: '#D5D8DC',
        dark: '#8A9098',
        coordLight: '#585C61',
        coordDark: '#262728',
        border: '#2B2F34',
        texture: {file: 'brushed-metal.svg', frame: 0.4, square: 0.3, blend: 'multiply'},
        isDarkBoard: false
    },
    leather: {
        id: 'leather',
        get name() {
            return t('appearance.themes.leather');
        },
        light: '#C9A07A',
        dark: '#6E4127',
        coordLight: '#57331F',
        coordDark: '#D7B99D',
        border: '#2A160C',
        texture: {file: 'leather.svg', frame: 0.35, square: 0.3, blend: 'multiply'},
        isDarkBoard: true
    },
    vinyl: {
        id: 'vinyl',
        get name() {
            return t('appearance.themes.vinyl');
        },
        light: '#E8EDF2',
        dark: '#4C6B8A',
        coordLight: '#4C6B8A',
        coordDark: '#E8EDF2',
        border: '#1E2B38',
        isDarkBoard: true
    },
    newspaper: {
        id: 'newspaper',
        get name() {
            return t('appearance.themes.newspaper');
        },
        light: '#FFFFFF',
        dark: '#C9C9C9',
        coordLight: '#757575',
        coordDark: '#525252',
        border: '#111111',
        texture: {file: 'hatch.svg', frame: 0, square: 0.55, blend: 'multiply', darkOnly: true},
        lastMove: 'rgba(120, 120, 120, 0.35)',
        isDarkBoard: false
    },
    contrast: {
        id: 'contrast',
        get name() {
            return t('appearance.themes.contrast');
        },
        light: '#FFF8D6',
        dark: '#3D6FC2',
        coordLight: '#3D6FC2',
        coordDark: '#FFF8D6',
        border: '#000000',
        lastMove: 'rgba(255, 196, 0, 0.6)',
        isDarkBoard: true
    },
    chalkboard: {
        id: 'chalkboard',
        get name() {
            return t('appearance.themes.chalkboard');
        },
        light: '#3F6B4E',
        dark: '#2C4E39',
        coordLight: '#DBE1DD',
        coordDark: '#A9BCAF',
        border: '#5A3A22',
        texture: {file: 'chalk.svg', frame: 0.25, square: 0.3, blend: 'screen'},
        lastMove: 'rgba(255, 255, 255, 0.22)',
        isDarkBoard: true
    },
    neon: {
        id: 'neon',
        get name() {
            return t('appearance.themes.neon');
        },
        light: '#2B2350',
        dark: '#15102B',
        coordLight: '#93919D',
        coordDark: '#827D98',
        border: '#0A0716',
        lastMove: 'rgba(255, 64, 200, 0.4)',
        isDarkBoard: true
    },
    stained: {
        id: 'stained',
        get name() {
            return t('appearance.themes.stained');
        },
        light: '#E8C77A',
        dark: '#7A3B5E',
        coordLight: '#7A3B5E',
        coordDark: '#E8C77A',
        border: '#1A1014',
        texture: {file: 'stained-glass.svg', frame: 0.4, square: 0.45, blend: 'multiply'},
        lastMove: 'rgba(120, 200, 255, 0.4)',
        isDarkBoard: true
    },
    parchment: {
        id: 'parchment',
        get name() {
            return t('appearance.themes.parchment');
        },
        light: '#EFE2C2',
        dark: '#C2A878',
        coordLight: '#716146',
        coordDark: '#413D34',
        border: '#3F2E1A',
        texture: {file: 'paper.svg', frame: 0.4, square: 0.35, blend: 'multiply'},
        isDarkBoard: false
    },
    expert: {
        id: 'expert',
        get name() {
            return t('appearance.themes.expert');
        },
        light: '#D9D9D9',
        dark: '#8F8F8F',
        coordLight: '#5D5D5D',
        coordDark: '#272727',
        border: '#3A3A3A',
        lastMove: 'rgba(90, 160, 255, 0.35)',
        isDarkBoard: false
    },
    // Таск 31.1 (идея владельца): осенний парк и клуб пятидесятых. Цвета — свои, текстура дерева — та же, что у «Ореха».
    autumn: {
        id: 'autumn',
        get name() {
            return t('appearance.themes.autumn');
        },
        // Золото липы и ржавчина кленового листа; рамка — каштан.
        light: '#EFD79A',
        dark: '#A4552B',
        coordLight: '#7A3D1C',
        coordDark: '#FBEBC4',
        border: '#3A2212',
        texture: {file: 'wood-grain.svg', frame: 0.3, square: 0.12, blend: 'multiply'},
        isDarkBoard: true
    },
    club50: {
        id: 'club50',
        get name() {
            return t('appearance.themes.club50');
        },
        // Клубная доска середины века: кремовые поля и бутылочно-зелёное сукно в ореховой раме.
        light: '#EADFC4',
        dark: '#4F6B53',
        coordLight: '#3A5240',
        coordDark: '#F7F0DC',
        border: '#3B2A1C',
        texture: {file: 'wood-grain.svg', frame: 0.35, square: 0.06, blend: 'multiply'},
        isDarkBoard: true
    },
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
    },
    mpchess: {
        id: 'mpchess',
        get name() {
            return t('appearance.pieceSets.mpchess.name');
        },
        get shortName() {
            return t('appearance.pieceSets.mpchess.shortName');
        },
        folder: 'mpchess',
        scalePercent: 92,
        get description() {
            return t('appearance.pieceSets.mpchess.description');
        },
        author: 'Maxime Chupin',
        license: 'GPL-3.0-or-later'
    },
    celtic: {
        id: 'celtic',
        get name() {
            return t('appearance.pieceSets.celtic.name');
        },
        get shortName() {
            return t('appearance.pieceSets.celtic.shortName');
        },
        folder: 'celtic',
        scalePercent: 93,
        get description() {
            return t('appearance.pieceSets.celtic.description');
        },
        author: 'Maurizio Monge',
        license: 'MIT'
    },
    spatial: {
        id: 'spatial',
        get name() {
            return t('appearance.pieceSets.spatial.name');
        },
        get shortName() {
            return t('appearance.pieceSets.spatial.shortName');
        },
        folder: 'spatial',
        scalePercent: 93,
        get description() {
            return t('appearance.pieceSets.spatial.description');
        },
        author: 'Maurizio Monge',
        license: 'MIT'
    },
    papercut: {
        id: 'papercut',
        get name() {
            return t('appearance.pieceSets.papercut.name');
        },
        get shortName() {
            return t('appearance.pieceSets.papercut.shortName');
        },
        folder: 'papercut',
        scalePercent: 92,
        get description() {
            return t('appearance.pieceSets.papercut.description');
        },
        author: 'Nikolay Anzarov',
        license: 'CC-BY-4.0'
    },
    totoy: {
        id: 'totoy',
        get name() {
            return t('appearance.pieceSets.totoy.name');
        },
        get shortName() {
            return t('appearance.pieceSets.totoy.shortName');
        },
        folder: 'totoy',
        scalePercent: 90,
        get description() {
            return t('appearance.pieceSets.totoy.description');
        },
        author: 'Kosal Sen',
        license: 'CC-BY-4.0'
    },
    pirouetti: {
        id: 'pirouetti',
        get name() {
            return t('appearance.pieceSets.pirouetti.name');
        },
        get shortName() {
            return t('appearance.pieceSets.pirouetti.shortName');
        },
        folder: 'pirouetti',
        scalePercent: 92,
        get description() {
            return t('appearance.pieceSets.pirouetti.description');
        },
        author: 'pirouetti',
        license: 'AGPL-3.0-or-later'
    },
    pixel: {
        id: 'pixel',
        get name() {
            return t('appearance.pieceSets.pixel.name');
        },
        get shortName() {
            return t('appearance.pieceSets.pixel.shortName');
        },
        folder: 'pixel',
        scalePercent: 90,
        get description() {
            return t('appearance.pieceSets.pixel.description');
        },
        author: 'therealqtpi',
        license: 'AGPL-3.0-or-later'
    },
    firi: {
        id: 'firi',
        get name() {
            return t('appearance.pieceSets.firi.name');
        },
        get shortName() {
            return t('appearance.pieceSets.firi.shortName');
        },
        folder: 'firi',
        scalePercent: 92,
        get description() {
            return t('appearance.pieceSets.firi.description');
        },
        author: 'James Faure',
        license: 'CC-BY-4.0'
    },
    shapes: {
        id: 'shapes',
        get name() {
            return t('appearance.pieceSets.shapes.name');
        },
        get shortName() {
            return t('appearance.pieceSets.shapes.shortName');
        },
        folder: 'shapes',
        scalePercent: 88,
        get description() {
            return t('appearance.pieceSets.shapes.description');
        },
        author: 'flugsio',
        license: 'CC-BY-SA-4.0'
    },
    letter: {
        id: 'letter',
        get name() {
            return t('appearance.pieceSets.letter.name');
        },
        get shortName() {
            return t('appearance.pieceSets.letter.shortName');
        },
        folder: 'letter',
        scalePercent: 88,
        get description() {
            return t('appearance.pieceSets.letter.description');
        },
        author: 'usolando',
        license: 'AGPL-3.0-or-later'
    },
    // Собственный набор проекта (таск 18.2): по мотивам льюисских шахмат XII века, scripts/build_lewis_pieces.py.
    lewis: {
        id: 'lewis',
        get name() {
            return t('appearance.pieceSets.lewis.name');
        },
        get shortName() {
            return t('appearance.pieceSets.lewis.shortName');
        },
        folder: 'lewis',
        scalePercent: 94,
        get description() {
            return t('appearance.pieceSets.lewis.description');
        },
        author: 'regence',
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
        const saved = localStorage.getItem('regence_board_theme');
        if (saved && BOARD_THEMES[saved]) return saved;
    }
    return 'walnut';
}

export function getSavedPieceSetKey(): string {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('regence_piece_set');
        if (saved && PIECE_SETS[saved]) return saved;
        if (saved && RETIRED_PIECE_SETS[saved]) return RETIRED_PIECE_SETS[saved];
    }
    return 'merida';
}

// Отдельная тема для разбора партий (таск 18.3): своя доска и фигуры в просмотре партии; без записи — как в игре.
const ANALYSIS_BOARD_KEY = 'regence_analysis_board_theme';
const ANALYSIS_PIECES_KEY = 'regence_analysis_piece_set';

function readKey(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function hasAnalysisAppearance(): boolean {
    const board = readKey(ANALYSIS_BOARD_KEY);
    return Boolean(board && BOARD_THEMES[board]);
}

export function getAnalysisBoardThemeKey(): string {
    const board = readKey(ANALYSIS_BOARD_KEY);
    return board && BOARD_THEMES[board] ? board : getSavedBoardThemeKey();
}

export function getAnalysisPieceSetKey(): string {
    const pieces = readKey(ANALYSIS_PIECES_KEY);
    return pieces && PIECE_SETS[pieces] && hasAnalysisAppearance() ? pieces : getSavedPieceSetKey();
}

/** Задать тему разбора (или null — как в игре). */
export function setAnalysisAppearance(board: string | null, pieces: string | null): void {
    try {
        if (board && pieces) {
            localStorage.setItem(ANALYSIS_BOARD_KEY, board);
            localStorage.setItem(ANALYSIS_PIECES_KEY, pieces);
        } else {
            localStorage.removeItem(ANALYSIS_BOARD_KEY);
            localStorage.removeItem(ANALYSIS_PIECES_KEY);
        }
    } catch {
        // Хранилище недоступно — разбор показывается в теме игры.
    }
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
