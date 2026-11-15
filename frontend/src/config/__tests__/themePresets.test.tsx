// Темы-комплекты (таск 18.3): части существуют, применение пишет все настройки, предпросмотр рисует позицию.

import {render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {THEME_PRESETS, applyPreset, findPreset, getSavedPresetId, presetIsValid} from '../themePresets';
import {getSavedBoardThemeKey, getSavedPieceSetKey} from '../boardAppearance';
import {getSavedPagePalette, getSavedPagePattern} from '../pageBackground';
import {SOUND_SETS, soundEngine} from '../../services/soundEngine';
import {ThemePreview} from '../../components/settings/ThemePreview';

afterEach(() => {
    localStorage.clear();
    soundEngine.setSoundSet('wood');
    document.body.removeAttribute('style');
});

describe('темы-комплекты', () => {
    it('шесть комплектов, разные, все части существуют', () => {
        expect(THEME_PRESETS).toHaveLength(6);
        expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(6);
        for (const preset of THEME_PRESETS) {
            expect(presetIsValid(preset), preset.id).toBe(true);
            expect(SOUND_SETS[preset.sound], preset.id).toBeDefined();
        }
    });

    it('применение выставляет доску, фигуры, фон, звуки и запоминает комплект', () => {
        applyPreset(findPreset('study')!);
        expect(getSavedBoardThemeKey()).toBe('leather');
        expect(getSavedPieceSetKey()).toBe('mpchess');
        expect(getSavedPagePattern()).toBe('manuscript');
        expect(getSavedPagePalette()).toBe('parchment');
        expect(soundEngine.getSoundSet()).toBe('wood');
        expect(getSavedPresetId()).toBe('study');
        applyPreset(findPreset('night')!);
        expect(soundEngine.getSoundSet()).toBe('soft');
        expect(localStorage.getItem('michess_sound_set')).toBe('soft');
        expect(findPreset('nope')).toBeUndefined();
    });

    it('предпросмотр — живая позиция: 32 поля с фигурами из набора комплекта', () => {
        render(<ThemePreview preset={findPreset('kids')!}/>);
        const images = screen.getByTestId('preview-kids').querySelectorAll('img');
        expect(images.length).toBe(32);
        expect(images[0].getAttribute('src')).toContain('/assets/pieces/totoy/');
    });
});
