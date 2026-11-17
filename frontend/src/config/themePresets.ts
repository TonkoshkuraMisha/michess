// --- FILE: frontend/src/config/themePresets.ts ---
// Темы-комплекты (таск 18.3): доска (с рамкой) + фигуры + фон зала + набор звуков «в один клик». Вошедший игрок хранит
// выбор в профиле (переходит между устройствами), гость — в браузере. Применение — запись тех же ключей, что
// выставляют отдельные настройки, поэтому любую часть комплекта можно потом поменять вручную.

import {BOARD_THEMES, PIECE_SETS} from './boardAppearance';
import {applyPageBackground} from './pageBackground';
import type {PagePalette, PagePattern} from './pageBackground';
import {soundEngine} from '../services/soundEngine';
import type {SoundSetId} from '../services/soundEngine';

export type PresetId = 'club' | 'marble_hall' | 'study' | 'tournament' | 'night' | 'kids'
    | 'autumn_park' | 'club_1950s' | 'chess_school';

export interface ThemePreset {
    id: PresetId;
    board: string;
    pieces: string;
    pattern: PagePattern;
    palette: PagePalette;
    sound: SoundSetId;
}

export const THEME_PRESETS: ThemePreset[] = [
    {id: 'club', board: 'walnut', pieces: 'merida', pattern: 'none', palette: 'room', sound: 'wood'},
    {id: 'marble_hall', board: 'marble', pieces: 'celtic', pattern: 'marble', palette: 'teal', sound: 'marble'},
    {id: 'study', board: 'leather', pieces: 'mpchess', pattern: 'manuscript', palette: 'parchment', sound: 'wood'},
    {id: 'tournament', board: 'vinyl', pieces: 'cburnett', pattern: 'none', palette: 'room', sound: 'soft'},
    {id: 'night', board: 'ebony', pieces: 'spatial', pattern: 'celtic', palette: 'teal', sound: 'soft'},
    {id: 'kids', board: 'tournament', pieces: 'totoy', pattern: 'bauhaus', palette: 'room', sound: 'bright'},
    // Таск 31.1 (идея владельца): осень в шахматном парке, клубный зал пятидесятых, школьный кружок.
    {id: 'autumn_park', board: 'autumn', pieces: 'cburnett', pattern: 'leaves', palette: 'autumn', sound: 'wood'},
    {id: 'club_1950s', board: 'club50', pieces: 'merida', pattern: 'parquet', palette: 'bottle', sound: 'wood'},
    {id: 'chess_school', board: 'chalkboard', pieces: 'merida', pattern: 'notebook', palette: 'ink', sound: 'soft'},
];

export const PRESET_STORAGE_KEY = 'michess_theme_preset';

export function findPreset(id: string | null | undefined): ThemePreset | undefined {
    return THEME_PRESETS.find((preset) => preset.id === id);
}

export function getSavedPresetId(): string | null {
    try {
        return localStorage.getItem(PRESET_STORAGE_KEY);
    } catch {
        return null;
    }
}

/** Применить комплект: доска, фигуры, фон страницы, звуки; запомнить в браузере. */
export function applyPreset(preset: ThemePreset): void {
    try {
        localStorage.setItem('michess_board_theme', preset.board);
        localStorage.setItem('michess_piece_set', preset.pieces);
        localStorage.setItem(PRESET_STORAGE_KEY, preset.id);
    } catch {
        // Хранилище недоступно — фон и звук всё равно поменяются до перезагрузки.
    }
    applyPageBackground(preset.pattern, preset.palette, true);
    soundEngine.setSoundSet(preset.sound);
}

/** Все части комплекта существуют (проверяет тест). */
export function presetIsValid(preset: ThemePreset): boolean {
    return Boolean(BOARD_THEMES[preset.board] && PIECE_SETS[preset.pieces]);
}
