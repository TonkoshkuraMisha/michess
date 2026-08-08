type EventCallback = (data: any) => void;

class GameWebSocketService {
  private ws: WebSocket | null = null;
  private listeners: { [event: string]: EventCallback[] } = {};

  connect(token: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const wsUrl = `ws://127.0.0.1:8000/api/v1/ws/matchmaking?token=${token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('🔗 WebSocket соединение с сервером установлено');
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

    this.ws.onclose = () => {
      console.log('🔌 WebSocket соединение закрыто');
    };

    this.ws.onerror = (error) => {
      console.error('❌ WebSocket ошибка:', error);
    };
  }

  on(event: string, callback: EventCallback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event: string, callback: EventCallback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  send(action: string, payload: any = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, ...payload }));
    } else {
      console.error('Невозможно отправить сообщение: WebSocket не подключен');
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const gameSocket = new GameWebSocketService();