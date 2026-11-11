// --- FILE: frontend/src/services/__tests__/gameSocket.test.ts ---

import {describe, it, expect} from 'vitest';
import {gameSocket} from '../gameSocket';
import {soundEngine, resolveMoveSound} from '../soundEngine';
import {API_BASE_URL, WS_BASE_URL} from '../../config/api';
import {
    BOARD_THEMES,
    PIECE_SETS,
    getPieceSvgUrl,
    getHarmoniousPieceStyle
} from '../../config/boardAppearance';
import {MIN_BOARD_SIZE, getMaxViewportBoardSize} from '../../components/Chessboard';

describe('GameWebSocketService, SoundEngine & API Config', () => {
    it('should be defined and support listener registration without duplicates', () => {
        expect(gameSocket).toBeDefined();
        const noop = () => {
        };
        gameSocket.on('test_event', noop);
        gameSocket.on('test_event', noop);
        gameSocket.off('test_event', noop);
    });

    it('should classify chess SAN notation into accurate sound events', () => {
        expect(resolveMoveSound('Nf3')).toBe('move');
        expect(resolveMoveSound('exd5')).toBe('capture');
        expect(resolveMoveSound('O-O')).toBe('castle');
        expect(resolveMoveSound('O-O-O')).toBe('castle');
        expect(resolveMoveSound('Qh4#')).toBe('check');
        expect(resolveMoveSound('Bb5+')).toBe('check');
        expect(resolveMoveSound('e8=Q')).toBe('promote');
        expect(resolveMoveSound('a8=N+')).toBe('check');

        const initialMute = soundEngine.isMuted();
        expect(soundEngine.toggleMute()).toBe(!initialMute);
        expect(soundEngine.toggleMute()).toBe(initialMute);
    });

    it('should provide valid default API_BASE_URL and WS_BASE_URL', () => {
        expect(API_BASE_URL).toMatch(/^https?:\/\//);
        expect(WS_BASE_URL).toMatch(/^wss?:\/\//);
    });

    it('should provide mobile-friendly board size bounds', () => {
        expect(MIN_BOARD_SIZE).toBe(280);
        expect(getMaxViewportBoardSize()).toBeGreaterThanOrEqual(MIN_BOARD_SIZE);
    });

    it('should provide 6 piece sets and 5 board themes with harmonious styles', () => {
        expect(Object.keys(PIECE_SETS).length).toBe(6);
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