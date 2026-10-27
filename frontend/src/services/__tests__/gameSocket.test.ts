// --- FILE: frontend/src/services/__tests__/gameSocket.test.ts ---

import {describe, it, expect} from 'vitest';
import {gameSocket} from '../gameSocket';
import {API_BASE_URL, WS_BASE_URL} from '../../config/api';

describe('GameWebSocketService & API Config', () => {
    it('should be defined', () => {
        expect(gameSocket).toBeDefined();
    });

    it('should provide valid default API_BASE_URL and WS_BASE_URL', () => {
        expect(API_BASE_URL).toMatch(/^https?:\/\//);
        expect(WS_BASE_URL).toMatch(/^wss?:\/\//);
    });
});