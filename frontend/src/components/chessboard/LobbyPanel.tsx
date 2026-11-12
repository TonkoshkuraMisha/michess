// --- FILE: frontend/src/components/chessboard/LobbyPanel.tsx ---

import {Radio, Play, Eye} from 'lucide-react';
import type {LiveGameItem, QueuePlayer} from './types';
import {useI18n} from '../../i18n';

export interface LobbyPanelProps {
    lobbyTab: 'lobby' | 'live';
    onLobbyTabChange: (tab: 'lobby' | 'live') => void;
    queuePlayers: QueuePlayer[];
    liveGames: LiveGameItem[];
    isSearching: boolean;
    gameId: number | null;
    gameOverResult: string | null;
    onAcceptChallenge: (targetUserId: number) => void;
    onSpectateGame: (gameId: number) => void;
}

/** Вкладка «Лобби/Live»: открытые вызовы на матчмейкинг и список идущих сейчас PvP-партий. */
export function LobbyPanel({
    lobbyTab, onLobbyTabChange, queuePlayers, liveGames, isSearching, gameId, gameOverResult,
    onAcceptChallenge, onSpectateGame,
}: LobbyPanelProps) {
    const {t, rich} = useI18n();
    return (
        <div className="flex-1 min-h-0 bg-acacia-dark rounded-md border border-amber-900/50 p-2.5 flex flex-col shadow-inner">
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/40 rounded border border-amber-900/40 mb-2 shrink-0">
                <button
                    type="button"
                    onClick={() => onLobbyTabChange('lobby')}
                    className={`py-1.5 px-2 rounded text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        lobbyTab === 'lobby'
                            ? 'bg-amber-700 text-amber-100 shadow'
                            : 'text-boxwood/70 hover:text-amber-200'
                    }`}
                >
                    <span>{t('lobby.challenges')}</span>
                    <span className="text-xs font-mono px-1.5 rounded bg-black/40">{queuePlayers.length}</span>
                </button>
                <button
                    type="button"
                    onClick={() => onLobbyTabChange('live')}
                    className={`py-1.5 px-2 rounded text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        lobbyTab === 'live'
                            ? 'bg-amber-700 text-amber-100 shadow'
                            : 'text-boxwood/70 hover:text-amber-200'
                    }`}
                >
                    <Radio size={13} className={liveGames.length > 0 ? 'text-emerald-400 animate-pulse' : ''}/>
                    <span>{t('lobby.live')}</span>
                    <span className="text-xs font-mono px-1.5 rounded bg-black/40">{liveGames.length}</span>
                </button>
            </div>

            <div
                className="flex-1 min-h-0 overflow-y-auto space-y-2 text-sm [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                {lobbyTab === 'lobby' ? (
                    queuePlayers.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center p-4 text-boxwood/60 text-center text-xs sm:text-sm">
                            <span>
                                {isSearching
                                    ? t('lobby.waiting')
                                    : t('lobby.empty')}
                            </span>
                        </div>
                    ) : (
                        queuePlayers.map((p) => (
                            <div
                                key={p.user_id}
                                className="p-2.5 bg-black/45 rounded-md border border-amber-600/30 flex justify-between items-center hover:border-amber-500/60 transition"
                            >
                                <div>
                                    <span className="text-amber-300 font-bold text-sm">{p.username || t('lobby.unknownPlayer')}</span>
                                    <div className="text-xs text-boxwood/75 font-mono">
                                        {t('lobby.challengeLine', {
                                            rating: p.rating,
                                            base: Math.round(p.base_time_ms / 60000),
                                            inc: (p.increment_ms || 0) / 1000,
                                        })}
                                        {p.rated === false && (
                                            <span className="ml-1.5 px-1.5 rounded bg-sky-900/60 text-sky-200 font-sans">
                                                {t('lobby.casualBadge')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={!!gameId && !gameOverResult}
                                    onClick={() => onAcceptChallenge(p.user_id)}
                                    className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-emerald-100 rounded text-xs font-bold transition flex items-center gap-1.5 shadow cursor-pointer"
                                >
                                    <Play size={13}/> {t('lobby.accept')}
                                </button>
                            </div>
                        ))
                    )
                ) : (
                    liveGames.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center p-4 text-boxwood/60 text-center text-xs sm:text-sm">
                            <span>{t('lobby.noLiveGames')}</span>
                        </div>
                    ) : (
                        liveGames.map((lg) => (
                            <div
                                key={lg.game_id}
                                className="p-2.5 bg-black/45 rounded-md border border-amber-600/30 flex justify-between items-center hover:border-amber-500/60 transition gap-2"
                            >
                                <div className="min-w-0">
                                    <div className="text-boxwood/50 font-bold truncate text-sm">
                                        {rich('board.versus', {
                                            white: <span key="white" className="text-amber-200">{lg.white_username || t('common.white')}</span>,
                                            black: <span key="black" className="text-amber-200">{lg.black_username || t('common.black')}</span>,
                                        })}
                                    </div>
                                    <div className="text-xs text-boxwood/75 font-mono">
                                        {Math.round(lg.base_time_ms / 60000)}+{(lg.increment_ms || 0) / 1000} •
                                        👁 {lg.spectators_count}
                                        {lg.is_rated === false && (
                                            <span className="ml-1.5 px-1.5 rounded bg-sky-900/60 text-sky-200 font-sans">
                                                {t('lobby.casualBadge')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={!!gameId && !gameOverResult}
                                    onClick={() => onSpectateGame(lg.game_id)}
                                    className="px-3 py-1.5 bg-amber-800 hover:bg-amber-700 disabled:opacity-40 text-amber-100 rounded text-xs font-bold transition flex items-center gap-1.5 shrink-0 shadow cursor-pointer"
                                >
                                    <Eye size={13}/> {t('lobby.watch')}
                                </button>
                            </div>
                        ))
                    )
                )}
            </div>
        </div>
    );
}
