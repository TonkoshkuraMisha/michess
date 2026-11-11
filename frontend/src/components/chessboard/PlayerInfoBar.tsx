// --- FILE: frontend/src/components/chessboard/PlayerInfoBar.tsx ---

import {formatTime} from './hooks/useClock';
import type {HistoricalBotProfile} from '../../config/champions';

export interface PlayerInfoBarProps {
    boardWidthPx: number;
    isResizing: boolean;
    /** Аватар исторического бота вместо дефолтной пешки-заглушки — когда бот играет этой стороной. */
    botProfile: HistoricalBotProfile | null;
    isWhiteSide: boolean;
    /** Подпись, когда партия ещё не идёт (свободный анализ) — задаётся вызывающим, т.к. отличается для верхней/нижней панели. */
    idleLabel: string;
    /** Партия (PvP/бот/просмотр) идёт — иначе показываем idleLabel и превью времени вместо часов. */
    showGameInfo: boolean;
    playerInfo: { username: string; rating: string };
    /** Партия только что завершилась и сервер прислал изменение рейтинга (может отсутствовать для конкретной стороны). */
    hasRatingInfo: boolean;
    ratingDelta?: number;
    capturedSymbols: string[];
    advantage: number;
    timeMs: number;
    idlePreviewMs: number;
}

/**
 * Панель игрока над/под доской: аватар, имя, рейтинг (с изменением после партии), взятые
 * фигуры, перевес в материале и часы. Используется зеркально для верхней и нижней стороны.
 */
export function PlayerInfoBar({
    boardWidthPx, isResizing, botProfile, isWhiteSide, idleLabel, showGameInfo, playerInfo,
    hasRatingInfo, ratingDelta, capturedSymbols, advantage, timeMs, idlePreviewMs,
}: PlayerInfoBarProps) {
    return (
        <div
            style={{width: `${boardWidthPx}px`}}
            className={`bg-acacia-dark px-3 py-1.5 rounded-lg shadow-heavy border-2 border-amber-900/50 flex justify-between items-center text-boxwood-light shrink-0 ${isResizing ? 'transition-none' : 'transition-colors'}`}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                {botProfile ? (
                    <img
                        src={botProfile.avatar}
                        alt={botProfile.name}
                        onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (!img.src.endsWith(botProfile.fallbackAvatar)) {
                                img.src = botProfile.fallbackAvatar;
                            }
                        }}
                        className="w-9 h-9 rounded-md object-cover border-2 border-amber-500/70 shrink-0 shadow"
                    />
                ) : (
                    <div
                        className={`w-9 h-9 rounded-md flex items-center justify-center border border-amber-600/30 font-bold text-lg shrink-0 ${
                            isWhiteSide ? 'bg-boxwood text-acacia-dark' : 'bg-acacia text-amber-200'
                        }`}
                    >
                        {isWhiteSide ? '♙' : '♟'}
                    </div>
                )}
                <div className="min-w-0">
                    <div className="font-bold text-sm sm:text-base flex items-center gap-2 leading-tight">
                        <span className="truncate">
                            {showGameInfo ? playerInfo.username : idleLabel}
                        </span>
                        {showGameInfo && (
                            <span
                                className="text-xs px-1.5 py-0.5 rounded bg-black/45 text-amber-400 border border-amber-600/25 flex items-center gap-1 font-mono">
                                {playerInfo.rating}
                                {hasRatingInfo && (
                                    <span className={Number(ratingDelta) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                        ({Number(ratingDelta) >= 0 ? `+${ratingDelta}` : ratingDelta})
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-amber-200/90 min-h-[16px]">
                        <span className="tracking-tight truncate">{capturedSymbols.join('')}</span>
                        {advantage > 0 && (
                            <span className="text-[11px] font-mono font-bold px-1.5 rounded bg-amber-900/60 text-amber-300">
                                +{advantage}
                            </span>
                        )}
                    </div>
                </div>
            </div>
            <div
                className="bg-[#1A120B] px-3.5 py-1 rounded-md border-2 border-amber-700/50 shadow-inner font-mono text-xl sm:text-2xl font-bold tracking-wider text-amber-400 min-w-[116px] sm:min-w-[124px] text-center">
                {showGameInfo ? formatTime(timeMs) : formatTime(idlePreviewMs)}
            </div>
        </div>
    );
}
