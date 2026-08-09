import { describe, it, expect } from 'vitest';
import { gameSocket } from '../gameSocket';

describe('GameWebSocketService', () => {
  it('should be defined', () => {
    expect(gameSocket).toBeDefined();
    expect(typeof gameSocket.connect).toBe('function');
    expect(typeof gameSocket.send).toBe('function');
  });
});