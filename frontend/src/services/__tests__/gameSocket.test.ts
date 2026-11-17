// --- FILE: frontend/src/services/__tests__/gameSocket.test.ts ---

import {describe, it, expect} from 'vitest';
import {gameSocket} from '../gameSocket';
import {isLearningPath, resolveMoveSound, setCheckSounds, soundEngine} from '../soundEngine';
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

    it('звук шаха — только в обучающих разделах', () => {
        for (const path of ['/learn', '/learn/course', '/learn/basics/check', '/puzzles', '/train/forks', '/workout',
            '/programs/beginner', '/guess/12', '/repertoire/5/drill']) {
            expect(isLearningPath(path), path).toBe(true);
        }
        for (const path of ['/', '/challenge/abc', '/play/960', '/play/960/live', '/tournaments/7', '/arenas/3', '/watch',
            '/game/42', '/repertoire/5', '/learners', '/trainers']) {
            expect(isLearningPath(path), path).toBe(false);
        }
    });

    it('should classify chess SAN notation into accurate sound events', () => {
        expect(resolveMoveSound('Nf3')).toBe('move');
        expect(resolveMoveSound('exd5')).toBe('capture');
        expect(resolveMoveSound('O-O')).toBe('castle');
        expect(resolveMoveSound('O-O-O')).toBe('castle');
        // В партиях звука шаха нет: ход с шахом звучит как обычный ход, взятие или превращение.
        setCheckSounds(false);
        expect(resolveMoveSound('Qh4#')).toBe('move');
        expect(resolveMoveSound('Bb5+')).toBe('move');
        expect(resolveMoveSound('Qxf7#')).toBe('capture');
        expect(resolveMoveSound('a8=N+')).toBe('promote');
        expect(resolveMoveSound('e8=Q')).toBe('promote');
        // В обучении — есть.
        setCheckSounds(true);
        expect(resolveMoveSound('Qh4#')).toBe('check');
        expect(resolveMoveSound('Bb5+')).toBe('check');
        expect(resolveMoveSound('a8=N+')).toBe('check');
        setCheckSounds(false);

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

    it('should provide 17 piece sets and 22 board themes with harmonious styles', () => {
        expect(Object.keys(PIECE_SETS).length).toBe(17);
        expect(Object.keys(BOARD_THEMES).length).toBe(24);

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