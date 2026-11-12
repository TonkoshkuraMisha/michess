// --- FILE: frontend/src/components/chessboard/GameChatPanel.tsx ---

import {MessageSquare, Send} from 'lucide-react';
import {useI18n} from '../../i18n';
import {QUICK_CHAT_PRESETS} from './types';
import type {ChatMessageItem, ChatPresetId} from './types';

export interface GameChatPanelProps {
    messages: ChatMessageItem[];
    chatInput: string;
    onChatInputChange: (value: string) => void;
    onSendMessage: () => void;
    onSendPreset: (preset: ChatPresetId) => void;
    /** Кнопка «выйти из просмотра» видна только зрителю, не участникам партии. */
    isSpectator: boolean;
    onLeaveSpectate: () => void;
}

/** Чат партии: лента сообщений, быстрые реплики и поле ввода. Виден только в PvP/просмотре. */
export function GameChatPanel({
    messages, chatInput, onChatInputChange, onSendMessage, onSendPreset, isSpectator, onLeaveSpectate,
}: GameChatPanelProps) {
    const {t} = useI18n();
    return (
        <div className="bg-acacia-dark p-2 rounded-md border border-amber-900/50 flex flex-col gap-1.5 shrink-0">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-amber-400 font-bold">
                <span className="flex items-center gap-1.5">
                    <MessageSquare size={13}/> {t('chat.title')}
                </span>
                {isSpectator && (
                    <button
                        type="button"
                        onClick={onLeaveSpectate}
                        className="text-rose-300 hover:text-rose-200 underline text-xs font-sans cursor-pointer"
                    >
                        {t('chat.leaveSpectating')}
                    </button>
                )}
            </div>

            <div
                className="h-16 overflow-y-auto bg-black/40 rounded p-2 text-xs space-y-1 font-sans border border-amber-950/50 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                {messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-boxwood/45 italic">
                        {t(isSpectator ? 'chat.emptySpectator' : 'chat.emptyPlayer')}
                    </div>
                ) : (
                    messages.map((msg, i) => (
                        <div key={i} className="leading-snug wrap-break-word">
                            <span className="font-bold text-amber-300 mr-1.5">{msg.sender}:</span>
                            <span className="text-boxwood-light">{msg.preset ? t(`chat.presets.${msg.preset}`) : msg.text}</span>
                        </div>
                    ))
                )}
            </div>

            {/* Писать в чат партии могут только игроки (сервер отклоняет сообщения зрителей). */}
            {isSpectator && (
                <div className="text-xs text-boxwood/60 italic">{t('chat.spectatorReadOnly')}</div>
            )}

            {!isSpectator && <div className="flex flex-wrap gap-1">
                {QUICK_CHAT_PRESETS.map((preset) => (
                    <button
                        key={preset}
                        type="button"
                        onClick={() => onSendPreset(preset)}
                        className="px-2 py-0.5 rounded bg-black/40 hover:bg-amber-900/50 border border-amber-800/40 text-xs text-amber-200 transition cursor-pointer"
                    >
                        {t(`chat.presets.${preset}`)}
                    </button>
                ))}
            </div>}

            {!isSpectator && <form
                onSubmit={(e) => {
                    e.preventDefault();
                    onSendMessage();
                }}
                className="flex gap-1.5"
            >
                <input
                    type="text"
                    maxLength={140}
                    value={chatInput}
                    onChange={(e) => onChatInputChange(e.target.value)}
                    placeholder={t('chat.placeholder')}
                    className="flex-1 bg-black/50 border border-amber-800/50 rounded px-2.5 py-1 text-xs text-amber-100 outline-none focus:border-amber-500 font-sans"
                />
                <button
                    type="submit"
                    className="px-3 py-1 bg-amber-700 hover:bg-amber-600 text-amber-100 rounded text-xs font-bold flex items-center justify-center transition cursor-pointer"
                    title={t('chat.send')}
                    aria-label={t('chat.send')}
                >
                    <Send size={13}/>
                </button>
            </form>}
        </div>
    );
}
