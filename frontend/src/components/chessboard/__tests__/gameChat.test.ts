// --- FILE: frontend/src/components/chessboard/__tests__/gameChat.test.ts ---
// Чат партии (gameChat.ts): разбор события chat_message, лента последних CHAT_HISTORY сообщений, отправка текста
// (обрезка до CHAT_TEXT_MAX, пустой не уходит) и быстрой фразы кодом.

import {afterEach, describe, expect, it, vi} from 'vitest';
import {appendChat, CHAT_HISTORY, CHAT_TEXT_MAX, chatItemFrom, sendChatPreset, sendChatText} from '../gameChat';
import {gameSocket} from '../../../services/gameSocket';

afterEach(() => vi.restoreAllMocks());

describe('чат партии', () => {
    it('сообщение из события: текст или код быстрой фразы; пустое и без отправителя — null', () => {
        expect(chatItemFrom({sender: 'bob', text: 'Привет', timestamp: 5})).toEqual({sender: 'bob', text: 'Привет', timestamp: 5});
        expect(chatItemFrom({sender: 'bob', text: 'игнор', preset: 'good_luck', timestamp: 5}))
            .toEqual({sender: 'bob', text: '', preset: 'good_luck', timestamp: 5});
        expect(chatItemFrom({sender: 'bob', preset: 'nonsense'})).toBeNull();
        expect(chatItemFrom({text: 'кто?'})).toBeNull();
    });

    it('лента хранит последние CHAT_HISTORY сообщений', () => {
        let list = Array.from({length: CHAT_HISTORY}, (_, i) => ({sender: 'a', text: String(i), timestamp: i}));
        list = appendChat(list, {sender: 'a', text: 'new', timestamp: 99});
        expect(list).toHaveLength(CHAT_HISTORY);
        expect(list[0].text).toBe('1');
        expect(list.at(-1)?.text).toBe('new');
    });

    it('отправка: текст обрезается, пустой не уходит; быстрая фраза — кодом', () => {
        const send = vi.spyOn(gameSocket, 'send').mockImplementation(() => undefined);
        expect(sendChatText(7, '   ')).toBe(false);
        expect(send).not.toHaveBeenCalled();
        expect(sendChatText(7, ` ${'x'.repeat(CHAT_TEXT_MAX + 10)} `)).toBe(true);
        expect(send).toHaveBeenLastCalledWith('chat_message', {game_id: 7, text: 'x'.repeat(CHAT_TEXT_MAX)});
        sendChatPreset(7, 'thanks');
        expect(send).toHaveBeenLastCalledWith('chat_message', {game_id: 7, preset: 'thanks'});
    });
});
