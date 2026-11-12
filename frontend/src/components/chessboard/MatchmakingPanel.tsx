// --- FILE: frontend/src/components/chessboard/MatchmakingPanel.tsx ---

import {Loader2, Users, Link2, Check, Copy} from 'lucide-react';
import {useI18n} from '../../i18n';

export interface MatchmakingPanelProps {
    gameId: number | null;
    gameOverResult: string | null;
    /** Тип партии, которая сейчас на доске. */
    isRatedGame: boolean;
    /** Тип новых партий: вызов в лобби и приглашение по ссылке. */
    ratedChoice: boolean;
    onRatedChoiceChange: (rated: boolean) => void;
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
    gameId, gameOverResult, isRatedGame, ratedChoice, onRatedChoiceChange,
    isSearching, onStartMatchmaking, onCancelMatchmaking,
    showInvitePanel, onToggleInvitePanel, inviteColorPref, onInviteColorPrefChange,
    createdInviteCode, inviteCopied, onCreatePrivateInvite, onCopyInviteLink,
}: MatchmakingPanelProps) {
    const {t} = useI18n();
    return (
        <>
            {!gameId && (
                <div
                    role="radiogroup"
                    aria-label={t('matchmaking.gameType')}
                    className="grid grid-cols-2 gap-1 p-0.5 bg-black/45 rounded border border-amber-900/50"
                >
                    {([[true, t('common.rated'), t('matchmaking.ratedHint')],
                        [false, t('common.casual'), t('matchmaking.casualHint')]] as const).map(([rated, label, hint]) => (
                        <button
                            key={String(rated)}
                            type="button"
                            role="radio"
                            aria-checked={ratedChoice === rated}
                            title={hint}
                            disabled={isSearching}
                            onClick={() => onRatedChoiceChange(rated)}
                            className={`py-1 px-2 rounded text-xs font-bold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                                ratedChoice === rated ? 'bg-amber-700 text-white' : 'text-boxwood/70 hover:text-amber-200'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

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
                        {t(isSearching ? 'matchmaking.cancelSearch' : 'matchmaking.findOpponent')}
                    </button>

                    <button
                        type="button"
                        onClick={onToggleInvitePanel}
                        className={`px-2.5 py-1.5 rounded-md border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow ${
                            showInvitePanel
                                ? 'bg-amber-700 text-white border-amber-400'
                                : 'bg-black/45 hover:bg-black/65 text-amber-200 border-amber-700/50'
                        }`}
                        title={t('matchmaking.withFriendHint')}
                    >
                        <Link2 size={14}/> {t('matchmaking.withFriend')}
                    </button>
                </div>
            ) : (
                <div className="text-center py-1.5 px-3 rounded bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 text-xs sm:text-sm font-bold">
                    {gameOverResult
                        ? t('matchmaking.gameFinished', {result: gameOverResult})
                        : t(isRatedGame ? 'matchmaking.ratedInProgress' : 'matchmaking.casualInProgress')}
                </div>
            )}

            {showInvitePanel && !gameId && (
                <div className="p-2 rounded bg-black/45 border border-amber-700/40 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-200">
                        <span>{t('matchmaking.friendColor')}</span>
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
                                    {t(c === 'white' ? 'matchmaking.colorWhite' : c === 'black' ? 'matchmaking.colorBlack' : 'matchmaking.colorRandom')}
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
                            <Link2 size={13}/> {t('matchmaking.createLink')}
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
                                {t(inviteCopied ? 'matchmaking.copied' : 'matchmaking.copy')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
