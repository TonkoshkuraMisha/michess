// --- FILE: frontend/src/components/chessboard/MatchmakingPanel.tsx ---

import {Loader2, Users, Link2, Check, Copy} from 'lucide-react';

export interface MatchmakingPanelProps {
    gameId: number | null;
    gameOverResult: string | null;
    isSearching: boolean;
    onStartMatchmaking: () => void;
    onCancelMatchmaking: () => void;
    showInvitePanel: boolean;
    onToggleInvitePanel: () => void;
    inviteColorPref: 'white' | 'black' | 'random';
    onInviteColorPrefChange: (pref: 'white' | 'black' | 'random') => void;
    createdInviteCode: string | null;
    inviteCopied: boolean;
    onCreatePrivateInvite: () => void;
    onCopyInviteLink: () => void;
}

/** Поиск соперника в рейтинговом лобби (или отмена), плюс создание ссылки для игры с другом. */
export function MatchmakingPanel({
    gameId, gameOverResult, isSearching, onStartMatchmaking, onCancelMatchmaking,
    showInvitePanel, onToggleInvitePanel, inviteColorPref, onInviteColorPrefChange,
    createdInviteCode, inviteCopied, onCreatePrivateInvite, onCopyInviteLink,
}: MatchmakingPanelProps) {
    return (
        <>
            {!gameId ? (
                <div className="grid grid-cols-[1fr_auto] gap-2">
                    <button
                        onClick={isSearching ? onCancelMatchmaking : onStartMatchmaking}
                        className={`flex items-center justify-center gap-2 px-3 py-1.5 font-bold text-xs sm:text-sm rounded-md transition shadow border cursor-pointer ${
                            isSearching
                                ? 'bg-red-900/85 text-red-100 border-red-700 hover:bg-red-900'
                                : 'bg-boxwood text-acacia-dark border-amber-700/50 hover:bg-boxwood-light'
                        }`}
                    >
                        {isSearching ? <Loader2 className="animate-spin" size={15}/> : <Users size={15}/>}
                        {isSearching ? 'Отменить поиск' : 'Найти соперника'}
                    </button>

                    <button
                        type="button"
                        onClick={onToggleInvitePanel}
                        className={`px-2.5 py-1.5 rounded-md border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow ${
                            showInvitePanel
                                ? 'bg-amber-700 text-white border-amber-400'
                                : 'bg-black/45 hover:bg-black/65 text-amber-200 border-amber-700/50'
                        }`}
                        title="Создать ссылку для игры с другом"
                    >
                        <Link2 size={14}/> С другом
                    </button>
                </div>
            ) : (
                <div className="text-center py-1.5 px-3 rounded bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 text-xs sm:text-sm font-bold">
                    {gameOverResult ? `Партия завершена (${gameOverResult})` : 'Идет рейтинговая партия'}
                </div>
            )}

            {showInvitePanel && !gameId && (
                <div className="p-2 rounded bg-black/45 border border-amber-700/40 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-200">
                        <span>Цвет в партии с другом:</span>
                        <div className="flex items-center gap-1 bg-black/50 p-0.5 rounded border border-amber-900/50">
                            {(['white', 'random', 'black'] as const).map(c => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => onInviteColorPrefChange(c)}
                                    className={`px-2 py-0.5 rounded text-xs font-bold transition cursor-pointer ${
                                        inviteColorPref === c ? 'bg-amber-700 text-white' : 'text-boxwood/70 hover:text-amber-200'
                                    }`}
                                >
                                    {c === 'white' ? '♔ Белые' : c === 'black' ? '♚ Чёрные' : '🎲 Случайно'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {!createdInviteCode ? (
                        <button
                            type="button"
                            onClick={onCreatePrivateInvite}
                            className="w-full py-1.5 px-3 rounded bg-amber-800/70 hover:bg-amber-700 text-amber-100 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow"
                        >
                            <Link2 size={13}/> Сгенерировать и скопировать ссылку
                        </button>
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <input
                                type="text"
                                readOnly
                                value={`${window.location.origin}/challenge/${createdInviteCode}`}
                                className="flex-1 bg-black/60 border border-amber-700/50 rounded px-2 py-1 text-xs font-mono text-amber-200 outline-none"
                            />
                            <button
                                type="button"
                                onClick={onCopyInviteLink}
                                className="px-2.5 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                            >
                                {inviteCopied ? <Check size={13}/> : <Copy size={13}/>}
                                {inviteCopied ? 'Скопировано' : 'Копия'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
