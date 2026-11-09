// --- FILE: frontend/src/services/gameSocket.ts ---

import {WS_BASE_URL} from '../config/api';

type EventCallback = (data: any) => void;

class GameWebSocketService {
    private ws: WebSocket | null = null;
    private currentToken: string | null = null;
    private listeners: { [event: string]: EventCallback[] } = {};
    private pendingMessages: string[] = [];
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    connect(token: string) {
        if (!token) return;

        // Если токен сменился (выход и вход под другим игроком), переоткрываем соединение
        if (this.ws && this.currentToken && this.currentToken !== token) {
            try {
                this.ws.close(1000);
            } catch {
                // ignore
            }
            this.ws = null;
        }

        this.currentToken = token;

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        const wsUrl = `${WS_BASE_URL}/api/v1/ws/matchmaking?token=${encodeURIComponent(token)}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            while (this.pendingMessages.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
                const msg = this.pendingMessages.shift();
                if (msg) {
                    this.ws.send(msg);
                }
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const eventType = data.event;

                if (this.listeners[eventType]) {
                    this.listeners[eventType].forEach(cb => cb(data));
                }
                if (this.listeners['*']) {
                    this.listeners['*'].forEach(cb => cb(data));
                }
            } catch (e) {
                console.error('Ошибка парсинга JSON от WebSocket:', e);
            }
        };

        this.ws.onclose = (event) => {
            this.ws = null;
            if (event.code === 1008) {
                // Токен истёк или невалиден — очищаем его и уведомляем приложение
                localStorage.removeItem('token');
                window.dispatchEvent(new Event('michess-auth-expired'));
                return;
            }
            if (this.currentToken && event.code !== 1000) {
                this.reconnectTimer = setTimeout(() => {
                    if (this.currentToken) {
                        this.connect(this.currentToken);
                    }
                }, 1500);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket ошибка:', error);
        };
    }

    on(event: string, callback: EventCallback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        if (!this.listeners[event].includes(callback)) {
            this.listeners[event].push(callback);
        }
    }

    off(event: string, callback: EventCallback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    send(action: string, payload: any = {}) {
        const serialized = JSON.stringify({action, ...payload});

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(serialized);
            return;
        }

        const fallbackToken = this.currentToken || localStorage.getItem('token');
        if (fallbackToken) {
            this.pendingMessages.push(serialized);
            this.connect(fallbackToken);
        } else {
            console.error('Невозможно отправить сообщение: пользователь не авторизован');
        }
    }

    disconnect() {
        this.currentToken = null;
        this.pendingMessages = [];
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.close(1000);
            } catch {
                // ignore
            }
            this.ws = null;
        }
    }
}

export const gameSocket = new GameWebSocketService();