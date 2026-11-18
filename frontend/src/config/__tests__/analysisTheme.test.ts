// Отдельная тема для разбора партий (таск 18.3): без записи — как в игре; запись не трогает тему игры.

import {afterEach, describe, expect, it} from 'vitest';
import {
    getAnalysisBoardThemeKey, getAnalysisPieceSetKey, getSavedBoardThemeKey, getSavedPieceSetKey, hasAnalysisAppearance,
    setAnalysisAppearance,
} from '../boardAppearance';

afterEach(() => localStorage.clear());

describe('тема разбора', () => {
    it('по умолчанию совпадает с темой игры', () => {
        localStorage.setItem('regence_board_theme', 'oak');
        localStorage.setItem('regence_piece_set', 'cburnett');
        expect(hasAnalysisAppearance()).toBe(false);
        expect(getAnalysisBoardThemeKey()).toBe('oak');
        expect(getAnalysisPieceSetKey()).toBe('cburnett');
    });

    it('своя тема разбора не меняет тему игры; сброс возвращает «как в игре»', () => {
        localStorage.setItem('regence_board_theme', 'oak');
        setAnalysisAppearance('marble', 'celtic');
        expect(hasAnalysisAppearance()).toBe(true);
        expect([getAnalysisBoardThemeKey(), getAnalysisPieceSetKey()]).toEqual(['marble', 'celtic']);
        expect([getSavedBoardThemeKey(), getSavedPieceSetKey()]).toEqual(['oak', 'merida']);
        setAnalysisAppearance(null, null);
        expect(getAnalysisBoardThemeKey()).toBe('oak');
    });

    it('неизвестная доска в хранилище игнорируется', () => {
        localStorage.setItem('regence_analysis_board_theme', 'gone');
        localStorage.setItem('regence_analysis_piece_set', 'celtic');
        expect(hasAnalysisAppearance()).toBe(false);
        expect(getAnalysisPieceSetKey()).toBe('merida');
    });
});
