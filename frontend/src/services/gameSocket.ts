// --- FILE: frontend/src/services/gameSocket.ts ---
// Соединение WebSocket с сервером (/api/v1/ws/matchmaking) — одно на вкладку: партии, лобби, уведомления. Вход — по
// одноразовому тикету (POST /auth/ws-ticket), токен в адрес не попадает. При обрыве соединение восстанавливается
// само (пауза RECONNECT_DELAY_MS; после отказа «слишком часто» — дольше); сообщения, отправленные без связи, уходят
// после подключения. Компоненты подписываются на события по имени (on / off), действия отправляют через send(имя,
// данные). Сервер — src/api/websockets.py: имя действия ищется в ACTION_HANDLERS, ответы и рассылки приходят
// сообщениями {event: имя, …данные}; подписка на '*' получает все события.

import {API_BASE_URL, WS_BASE_URL} from '../config/api';
import {clearToken, getToken} from './authToken';
import {addBreadcrumb} from './breadcrumbs';

type EventCallback = (data: any) => void;

/** Пауза перед повторным подключением после обрыва или сбоя выдачи тикета. */
const RECONNECT_DELAY_MS = 1500;
/** Пауза после отказа 429 на выдаче тикета: частые попытки только продлевают блокировку. */
const RATE_LIMITED_RECONNECT_DELAY_MS = 15000;

/** Сервер ответил 401 на запрос тикета: токен истёк или отозван. */
class AuthExpiredError extends Error {}

/** Сервер ответил 429 на запрос тикета: слишком частые подключения. */
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
    if (res.status === 401) throw new AuthExpiredError('Session expired');
    if (res.status === 429) throw new RateLimitedError('Too many reconnects');
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

    /** Открыть соединение (или оставить уже открытое); при смене токена прежнее соединение закрывается. */
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

    /** Получить тикет и открыть сокет; ошибка тикета — выход (401) или повтор через паузу (429 и прочее). */
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
                console.warn('Failed to get a WebSocket ticket:', err);
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
            addBreadcrumb('socket', 'open');
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
                if (eventType !== 'clock_update') addBreadcrumb('socket', `event ${String(eventType)}`);

                if (this.listeners[eventType]) {
                    this.listeners[eventType].forEach(cb => cb(data));
                }
                if (this.listeners['*']) {
                    this.listeners['*'].forEach(cb => cb(data));
                }
            } catch (e) {
                console.error('Failed to parse WebSocket JSON:', e);
            }
        };

        socket.onclose = (event) => {
            if (this.ws !== socket) return;
            addBreadcrumb('socket', `close ${event.code}`);
            this.ws = null;
            if (event.code === 1008) {
                // Тикет недействителен или токены отозваны (смена пароля, выход на всех устройствах)
                this.handleAuthExpired();
                return;
            }
            // 1000 — обычное закрытие (так закрывает сокет и сам клиент в closeSocket): переподключаться незачем.
            if (this.currentToken && event.code !== 1000) {
                this.scheduleReconnect(RECONNECT_DELAY_MS);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
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
        // Токен истёк или отозван — очищаем его и уведомляем приложение. Интерфейс выходит по clearToken()
        // (подписка onTokenChange в App.tsx); событие regence-auth-expired слушают только тесты.
        this.currentToken = null;
        this.pendingMessages = [];
        clearToken();
        window.dispatchEvent(new Event('regence-auth-expired'));
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

    /** Подписка на событие сервера по имени ('*' — на все); повторная подписка той же функцией не дублируется. */
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

    /**
     * Отправить действие {action, …payload}. Без открытого соединения сообщение ждёт в очереди и уходит после
     * подключения (подключение запускается здесь же); если игрок не вошёл — сообщение теряется с записью в консоль.
     */
    send(action: string, payload: any = {}) {
        const serialized = JSON.stringify({action, ...payload});

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(serialized);
            return;
        }

        const fallbackToken = this.currentToken || getToken();
        if (fallbackToken) {
            this.pendingMessages.push(serialized);
            this.connect(fallbackToken);
        } else {
            console.error('Cannot send a message: the user is not logged in');
        }
    }

    /** Закрыть соединение насовсем (выход игрока): очередь сообщений и запланированное переподключение сбрасываются. */
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

/** Единственный экземпляр на вкладку: им пользуются доска и её хуки, шапка и личные сообщения, шахматы Фишера. */
export const gameSocket = new GameWebSocketService();
