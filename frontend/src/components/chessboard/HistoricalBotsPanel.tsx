// --- FILE: frontend/src/components/chessboard/HistoricalBotsPanel.tsx ---

import {MessageSquareQuote} from 'lucide-react';
import {HISTORICAL_BOTS_LIST} from '../../config/champions';
import type {BotOpponentId, HistoricalBotId, HistoricalBotProfile} from '../../config/champions';

export interface HistoricalBotsPanelProps {
    selectedBotId: HistoricalBotId;
    onSelectBot: (id: HistoricalBotId) => void;
    selectedBotProfile: HistoricalBotProfile;
    activeBot: BotOpponentId | null;
    activeBotProfile: HistoricalBotProfile | null;
    gameId: number | null;
    gameOverResult: string | null;
    isBotThinking: boolean;
    botComment: string | null;
    onStartBotGame: (botId: HistoricalBotId, colorPref: 'white' | 'black' | 'random') => void;
    /** На свободной доске стоит своя позиция — партию с ботом можно начать с неё. */
    canStartFromPosition: boolean;
    startFromPosition: boolean;
    onStartFromPositionChange: (value: boolean) => void;
    /** Измеренная сила (GET /bots/catalog): id бота → рейтинг; без калибровки — заявленный. */
    measured?: Record<string, number>;
}

/** Выбор исторического бота, карточка с его девизом/рейтингом и кнопками старта партии. */
export function HistoricalBotsPanel({
    selectedBotId, onSelectBot, selectedBotProfile, activeBot, activeBotProfile, gameId,
    gameOverResult, isBotThinking, botComment, onStartBotGame,
    canStartFromPosition, startFromPosition, onStartFromPositionChange, measured = {},
}: HistoricalBotsPanelProps) {
    return (
        <div
            className="flex-1 min-h-0 bg-acacia-dark p-2.5 rounded-md border border-amber-700/40 flex flex-col justify-between gap-2 shadow-inner overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
            <div className="grid grid-cols-2 gap-1.5">
                {HISTORICAL_BOTS_LIST.map((botItem) => {
                    const isSelected = selectedBotId === botItem.id;
                    return (
                        <button
                            key={botItem.id}
                            type="button"
                            onClick={() => onSelectBot(botItem.id)}
                            className={`p-1.5 rounded-md text-left transition cursor-pointer flex items-center gap-2 border ${
                                isSelected
                                    ? 'bg-amber-800/80 text-white border-amber-400 shadow'
                                    : 'bg-black/35 text-boxwood/85 border-amber-900/40 hover:border-amber-600/50 hover:bg-black/55'
                            }`}
                        >
                            <img
                                src={botItem.avatar}
                                alt={botItem.shortName}
                                onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    if (!img.src.endsWith(botItem.fallbackAvatar)) {
                                        img.src = botItem.fallbackAvatar;
                                    }
                                }}
                                className={`w-8 h-8 rounded-full object-cover shrink-0 border ${
                                    isSelected ? 'border-amber-300' : 'border-amber-700/60'
                                }`}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold truncate leading-tight">
                                    {botItem.shortName}
                                </div>
                                <div className="text-[11px] font-mono text-amber-300/90">
                                    Эло {measured[botItem.id] ?? botItem.rating}{measured[botItem.id] ? ' изм.' : ''}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="p-2.5 rounded-md bg-black/40 border border-amber-800/50 flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                    <img
                        src={selectedBotProfile.avatar}
                        alt={selectedBotProfile.name}
                        onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (!img.src.endsWith(selectedBotProfile.fallbackAvatar)) {
                                img.src = selectedBotProfile.fallbackAvatar;
                            }
                        }}
                        className="w-12 h-12 rounded-lg object-cover border-2 border-amber-500/80 shadow-md shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                            <span className="text-sm font-bold text-amber-200 truncate">
                                {selectedBotProfile.name}
                            </span>
                            {activeBot === selectedBotProfile.id && !gameOverResult && (
                                <span
                                    className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-600/50 shrink-0">
                                    В игре
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-amber-400 font-semibold">
                            {selectedBotProfile.title}
                        </div>
                        <div className="text-[11px] text-boxwood/75 font-mono">
                            Годы: {selectedBotProfile.era} • Рейтинг ~{measured[selectedBotProfile.id] ?? selectedBotProfile.rating}
                            {measured[selectedBotProfile.id] ? ' (измерен)' : ''}
                        </div>
                    </div>
                </div>

                <p className="text-xs italic text-boxwood/90 leading-snug bg-black/30 p-2 rounded border border-amber-900/30">
                    «{selectedBotProfile.motto}»
                </p>

                {canStartFromPosition && (
                    <label className="flex items-center gap-2 text-xs text-amber-200 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={startFromPosition}
                            onChange={(e) => onStartFromPositionChange(e.target.checked)}
                            className="accent-amber-600"
                        />
                        Начать с позиции на доске
                    </label>
                )}

                <div className="grid grid-cols-3 gap-1.5">
                    <button
                        type="button"
                        disabled={!!gameId && !gameOverResult}
                        onClick={() => onStartBotGame(selectedBotId, 'white')}
                        className="py-1.5 px-2 text-xs font-bold rounded-md bg-boxwood text-acacia-dark hover:bg-boxwood-light disabled:opacity-40 transition cursor-pointer shadow"
                    >
                        ♔ Белыми
                    </button>
                    <button
                        type="button"
                        disabled={!!gameId && !gameOverResult}
                        onClick={() => onStartBotGame(selectedBotId, 'random')}
                        className="py-1.5 px-2 text-xs font-bold rounded-md bg-amber-700 text-white border border-amber-500/50 hover:bg-amber-600 disabled:opacity-40 transition cursor-pointer shadow"
                    >
                        🎲 Случайно
                    </button>
                    <button
                        type="button"
                        disabled={!!gameId && !gameOverResult}
                        onClick={() => onStartBotGame(selectedBotId, 'black')}
                        className="py-1.5 px-2 text-xs font-bold rounded-md bg-black/70 text-amber-200 border border-amber-700/60 hover:bg-black disabled:opacity-40 transition cursor-pointer shadow"
                    >
                        ♚ Чёрными
                    </button>
                </div>
            </div>

            {activeBotProfile && (
                <div className="p-2 rounded-md bg-black/55 border border-amber-600/40 text-xs text-amber-100">
                    <div className="font-bold text-amber-400 mb-0.5 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                            <MessageSquareQuote size={13}/> Мысль ({activeBotProfile.shortName}):
                        </span>
                        {isBotThinking && (
                            <span className="animate-pulse text-amber-300 font-mono text-[11px]">
                                обдумывает ход...
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-boxwood-light leading-snug">
                        {botComment || 'Посмотрим, как развернётся борьба за центр.'}
                    </div>
                </div>
            )}
        </div>
    );
}
