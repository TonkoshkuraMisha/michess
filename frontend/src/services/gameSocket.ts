// --- FILE: frontend/src/services/gameSocket.ts ---

import {API_BASE_URL, WS_BASE_URL} from '../config/api';

type EventCallback = (data: any) => void;

const RECONNECT_DELAY_MS = 1500;
const RATE_LIMITED_RECONNECT_DELAY_MS = 15000;

class AuthExpiredError extends Error {}

class RateLimitedError extends Error {}

/**
 * Одноразовый тикет для WebSocket. JWT в адрес WebSocket не кладём: адреса попадают в логи
 * сервера и прокси. Тикет получаем по HTTP с токеном в заголовке, он действует ~30 с и один раз.
 */
async function fetchWsTicket(token: string): Promise<string> {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/ws-ticket`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`},
    });
    if (res.status === 401) throw new AuthExpiredError('Сессия истекла');
    if (res.status === 429) throw new RateLimitedError('Слишком частые переподключения');
    if (!res.ok) throw new Error(`ws-ticket: HTTP ${res.status}`);
    const data = await res.json();
    return data.ticket;
}

class GameWebSocketService {
    private ws: WebSocket | null = null;
    private currentToken: string | null = null;
    private listeners: { [event: string]: EventCallback[] } = {};
    private pendingMessages: string[] = [];
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Идёт запрос тикета; номер попытки отсекает устаревшие (после disconnect или смены токена).
    private connecting = false;
    private attempt = 0;

    connect(token: string) {
        if (!token) return;

        // Если токен сменился (выход и вход под другим игроком), переоткрываем соединение
        if (this.currentToken && this.currentToken !== token) {
            this.closeSocket();
            this.attempt += 1;
            this.connecting = false;
        }

        this.currentToken = token;

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        if (this.connecting) return;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        void this.openSocket(token);
    }

    private async openSocket(token: string) {
        this.connecting = true;
        const attempt = ++this.attempt;

        let ticket: string;
        try {
            ticket = await fetchWsTicket(token);
        } catch (err) {
            if (attempt !== this.attempt) return;
            this.connecting = false;
            if (err instanceof AuthExpiredError) {
                this.handleAuthExpired();
            } else {
                console.warn('Не удалось получить тикет WebSocket:', err);
                this.scheduleReconnect(err instanceof RateLimitedError ? RATE_LIMITED_RECONNECT_DELAY_MS : RECONNECT_DELAY_MS);
            }
            return;
        }

        if (attempt !== this.attempt || this.currentToken !== token) return;  // отключились, пока ждали
        this.connecting = false;

        const wsUrl = `${WS_BASE_URL}/api/v1/ws/matchmaking?ticket=${encodeURIComponent(ticket)}`;
        // Обработчики привязаны к своему сокету: закрытый ранее сокет (смена токена, повторное
        // подключение) сообщает о закрытии с задержкой, и без проверки его onclose обнулял бы
        // ссылку на уже новый сокет — тот оставался бы жить, а следующий send() открывал
        // второе соединение, и каждое событие приходило бы дважды.
        const socket = new WebSocket(wsUrl);
        this.ws = socket;

        socket.onopen = () => {
            if (this.ws !== socket) return;
            while (this.pendingMessages.length > 0 && socket.readyState === WebSocket.OPEN) {
                const msg = this.pendingMessages.shift();
                if (msg) {
                    socket.send(msg);
                }
            }
        };

        socket.onmessage = (event) => {
            if (this.ws !== socket) return;
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

        socket.onclose = (event) => {
            if (this.ws !== socket) return;
            this.ws = null;
            if (event.code === 1008) {
                // Тикет недействителен или токены отозваны (смена пароля, выход на всех устройствах)
                this.handleAuthExpired();
                return;
            }
            if (this.currentToken && event.code !== 1000) {
                this.scheduleReconnect(RECONNECT_DELAY_MS);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket ошибка:', error);
        };
    }

    private scheduleReconnect(delayMs: number) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.currentToken) {
                this.connect(this.currentToken);
            }
        }, delayMs);
    }

    private handleAuthExpired() {
        // Токен истёк или отозван — очищаем его и уведомляем приложение
        this.currentToken = null;
        this.pendingMessages = [];
        localStorage.removeItem('token');
        window.dispatchEvent(new Event('michess-auth-expired'));
    }

    private closeSocket() {
        if (this.ws) {
            try {
                this.ws.close(1000);
            } catch {
                // ignore
            }
            this.ws = null;
        }
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
        this.attempt += 1;  // отменяет запрос тикета, если он ещё идёт
        this.connecting = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.closeSocket();
    }
}

export const gameSocket = new GameWebSocketService();
