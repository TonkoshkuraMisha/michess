// --- FILE: frontend/src/services/__tests__/gameSocket.test.ts ---

import {describe, it, expect} from 'vitest';
import {gameSocket} from '../gameSocket';
import {API_BASE_URL, WS_BASE_URL} from '../../config/api';
import {
    BOARD_THEMES,
    PIECE_SETS,
    getPieceSvgUrl,
    getHarmoniousPieceStyle
} from '../../config/boardAppearance';

describe('GameWebSocketService & API Config', () => {
    it('should be defined', () => {
        expect(gameSocket).toBeDefined();
    });

    it('should provide valid default API_BASE_URL and WS_BASE_URL', () => {
        expect(API_BASE_URL).toMatch(/^https?:\/\//);
        expect(WS_BASE_URL).toMatch(/^wss?:\/\//);
    });

    it('should provide 5 piece sets and 5 board themes with harmonious styles', () => {
        expect(Object.keys(PIECE_SETS).length).toBe(5);
        expect(Object.keys(BOARD_THEMES).length).toBe(5);

        for (const setKey of Object.keys(PIECE_SETS)) {
            expect(getPieceSvgUrl(setKey, 'w', 'q')).toContain(`/assets/pieces/${setKey}/wQ.svg`);
            for (const themeKey of Object.keys(BOARD_THEMES)) {
                const whiteStyle = getHarmoniousPieceStyle(setKey, themeKey, 'w');
                const blackStyle = getHarmoniousPieceStyle(setKey, themeKey, 'b');
                expect(whiteStyle.width).toMatch(/^\d+%$/);
                expect(blackStyle.filter.length).toBeGreaterThan(5);
            }
        }
    });
});
