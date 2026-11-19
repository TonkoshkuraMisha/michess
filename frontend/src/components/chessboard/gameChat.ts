// --- FILE: frontend/src/components/chessboard/gameChat.ts ---
// Чат партии: разбор события chat_message и отправка сообщения по общему WebSocket (services/gameSocket). Сервер
// (src/api/websockets.py, действие chat_message) обрезает текст до CHAT_TEXT_MAX знаков и пускает писать только игроков
// партии. Быстрая фраза уходит кодом (preset), и каждый видит её на своём языке. Общий для главной доски
// (hooks/useGameSocket.ts) и партии Фишера с человеком (chess960/Chess960LiveGame.tsx, хук useGameChat).

import {useEffect, useState} from 'react';
import {gameSocket} from '../../services/gameSocket';
import {isChatPreset} from './types';
import type {ChatMessageItem, ChatPresetId} from './types';

/** Длина своего сообщения — как обрезает сервер (raw_text[:140] в src/api/websockets.py). */
export const CHAT_TEXT_MAX = 140;
/** Сколько последних сообщений держится в памяти страницы. */
export const CHAT_HISTORY = 50;

/** Сообщение из события chat_message; пустое или без отправителя — null. */
export function chatItemFrom(data: { sender?: string; text?: string; preset?: unknown; timestamp?: number }): ChatMessageItem | null {
    const preset = isChatPreset(data.preset) ? data.preset : undefined;
    if (!data.sender || (!data.text && !preset)) return null;
    return {sender: data.sender, text: preset ? '' : data.text ?? '', ...(preset ? {preset} : {}), timestamp: data.timestamp || Date.now()};
}

/** Добавить сообщение в ленту, оставив последние CHAT_HISTORY. */
export const appendChat = (list: ChatMessageItem[], item: ChatMessageItem) => [...list.slice(-(CHAT_HISTORY - 1)), item];

/** Отправить свой текст в чат партии; пустой не уходит. Возвращает, ушло ли сообщение. */
export function sendChatText(gameId: number, text: string): boolean {
    const message = text.trim();
    if (!message) return false;
    gameSocket.send('chat_message', {game_id: gameId, text: message.slice(0, CHAT_TEXT_MAX)});
    return true;
}

/** Отправить быструю фразу кодом. */
export function sendChatPreset(gameId: number, preset: ChatPresetId): void {
    gameSocket.send('chat_message', {game_id: gameId, preset});
}

/**
 * Чат одной партии для страниц вне главной доски: подписка на chat_message этой партии, лента и поле ввода.
 * Смена партии (реванш) очищает ленту.
 */
export function useGameChat(gameId: number | null) {
    const [messages, setMessages] = useState<ChatMessageItem[]>([]);
    const [input, setInput] = useState('');
    useEffect(() => {
        setMessages([]);
        if (gameId === null) return;
        const onChat = (data: { game_id?: number | string; sender?: string; text?: string; preset?: unknown; timestamp?: number }) => {
            if (Number(data.game_id) !== gameId) return;
            const item = chatItemFrom(data);
            if (item) setMessages((list) => appendChat(list, item));
        };
        gameSocket.on('chat_message', onChat);
        return () => gameSocket.off('chat_message', onChat);
    }, [gameId]);
    return {
        messages, input, setInput,
        send: () => {
            if (gameId !== null && sendChatText(gameId, input)) setInput('');
        },
        sendPreset: (preset: ChatPresetId) => {
            if (gameId !== null) sendChatPreset(gameId, preset);
        },
    };
}
