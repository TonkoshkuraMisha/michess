// --- FILE: frontend/src/components/chessboard/GameControlsPanel.tsx ---

import {useState} from 'react';
import {Flag, Handshake, X, RefreshCw, RotateCcw, Undo2, Eye, Download, Grid3x3} from 'lucide-react';
import type {NavigateFunction} from 'react-router-dom';
import {API_BASE_URL} from '../../config/api';

export type RematchStatus = 'none' | 'offered_by_me' | 'offered_by_opponent' | 'declined';

export interface GameControlsPanelProps {
    /** PvP-партия идёт, партия против исторического бота или свободная песочница/анализ. */
    mode: 'pvp' | 'bot' | 'sandbox';
    gameId: number | null;
    savedBotGameId: number | null;
    historyLength: number;
    gameOverResult: string | null;
    rematchStatus: RematchStatus;
    isBotThinking: boolean;
    whitePlayer: { username: string; rating: string };
    blackPlayer: { username: string; rating: string };
    navigate: NavigateFunction;
    onAbortGame: () => void;
    onResign: () => void;
    onOfferDraw: () => void;
    onAcceptRematch: () => void;
    onDeclineRematch: () => void;
    onOfferRematch: () => void;
    onResetSandbox: () => void;
    onUndoSandboxMove: () => void;
    /** Партия клубной лестницы: возврат хода запрещён. */
    undoLocked?: boolean;
    /** На свободной доске стоит позиция, загруженная из FEN (сброс доступен и без ходов). */
    hasCustomPosition?: boolean;
    /** Ставит на свободную доску позицию из FEN; возвращает текст ошибки или null. */
    onLoadFen?: (fen: string) => string | null;
}

/**
 * Кнопки управления партией под журналом ходов — три независимых режима (PvP/бот/песочница),
 * т.к. набор доступных действий (сдача vs отмена, реванш vs возврат в лобби...) разный у каждого.
 */
export function GameControlsPanel({
    mode, gameId, savedBotGameId, historyLength, gameOverResult, rematchStatus, isBotThinking,
    whitePlayer, blackPlayer, navigate, onAbortGame, onResign, onOfferDraw, onAcceptRematch,
    onDeclineRematch, onOfferRematch, onResetSandbox, onUndoSandboxMove, undoLocked = false, hasCustomPosition = false, onLoadFen,
}: GameControlsPanelProps) {
    const [fenInput, setFenInput] = useState('');
    const [fenError, setFenError] = useState<string | null>(null);

    const submitFen = (e: React.FormEvent) => {
        e.preventDefault();
        if (!onLoadFen || !fenInput.trim()) return;
        const error = onLoadFen(fenInput);
        setFenError(error);
        if (!error) setFenInput('');
    };

    const navigateToReview = (reviewGameId: number, site?: string, blackRatingFallback = 1200) => navigate(`/game/${reviewGameId}`, {
        state: {
            game: {
                game_id: reviewGameId,
                white_username: whitePlayer.username,
                white_rating: Number(whitePlayer.rating) || 1200,
                black_username: blackPlayer.username,
                black_rating: Number(blackPlayer.rating) || blackRatingFallback,
                result: gameOverResult || '*',
                ...(site ? {site} : {}),
                finished_at: new Date().toISOString()
            }
        }
    });

    if (mode === 'pvp') {
        return (
            <div className="shrink-0 flex flex-col gap-1.5">
                <div className="grid grid-cols-2 gap-2">
                    {historyLength < 2 ? (
                        <button
                            type="button"
                            onClick={onAbortGame}
                            disabled={!!gameOverResult}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-950/90 text-amber-200 text-xs sm:text-sm font-bold rounded-md hover:bg-amber-900 transition shadow border border-amber-700/60 disabled:opacity-40 cursor-pointer"
                        >
                            <X size={15}/> Отменить игру
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onResign}
                            disabled={!!gameOverResult}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/85 text-red-200 text-xs sm:text-sm font-bold rounded-md hover:bg-red-900 transition shadow border border-red-800/50 disabled:opacity-40 cursor-pointer"
                        >
                            <Flag size={15}/> Сдаться
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onOfferDraw}
                        disabled={!!gameOverResult || historyLength < 2}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                    >
                        <Handshake size={15}/> Ничья
                    </button>
                </div>

                {gameOverResult && (
                    <div className="flex flex-col gap-1.5">
                        {rematchStatus === 'offered_by_opponent' ? (
                            <div
                                className="p-2 rounded-md bg-emerald-950/90 border border-emerald-500/60 flex flex-col gap-1.5 text-xs text-emerald-100 text-center shadow">
                                <span className="font-bold">Соперник предлагает реванш (со сменой цвета)!</span>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={onAcceptRematch}
                                        className="py-1.5 px-3 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded transition shadow cursor-pointer"
                                    >
                                        Принять реванш
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onDeclineRematch}
                                        className="py-1.5 px-3 bg-red-900/80 hover:bg-red-800 text-red-100 font-bold rounded transition cursor-pointer"
                                    >
                                        Отклонить
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    disabled={rematchStatus === 'offered_by_me' || rematchStatus === 'declined'}
                                    onClick={onOfferRematch}
                                    className="flex items-center justify-center gap-1.5 px-3 py-2 font-bold text-xs sm:text-sm rounded-md transition shadow bg-emerald-800 hover:bg-emerald-700 text-emerald-100 border border-emerald-500/50 disabled:opacity-50 cursor-pointer"
                                >
                                    <RefreshCw size={15}
                                               className={rematchStatus === 'offered_by_me' ? 'animate-spin' : ''}/>
                                    {rematchStatus === 'offered_by_me'
                                        ? 'Ждём ответа...'
                                        : rematchStatus === 'declined'
                                            ? 'Реванш отклонён'
                                            : 'Реванш'}
                                </button>
                                <button
                                    type="button"
                                    onClick={onResetSandbox}
                                    className="flex items-center justify-center gap-1.5 px-3 py-2 font-bold text-xs sm:text-sm rounded-md transition shadow bg-boxwood text-acacia-dark border border-amber-700/50 hover:bg-boxwood-light cursor-pointer"
                                >
                                    <RotateCcw size={15}/> В лобби
                                </button>
                            </div>
                        )}

                        {/* У отменённой партии нет ни ходов, ни PGN — разбирать и скачивать нечего. */}
                        {gameOverResult !== '*' && <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => gameId && navigateToReview(gameId)}
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 text-xs font-bold rounded-md transition shadow border border-emerald-600/50 cursor-pointer"
                            >
                                <Eye size={14}/> Разбор партии
                            </button>
                            <a
                                href={`${API_BASE_URL}/api/v1/profile/games/${gameId}/pgn`}
                                download
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#1A120B] hover:bg-black text-amber-400 text-xs font-bold rounded-md transition shadow border border-amber-800/60"
                            >
                                <Download size={14}/> Скачать PGN
                            </a>
                        </div>}
                    </div>
                )}
            </div>
        );
    }

    if (mode === 'bot') {
        return (
            <div className="shrink-0 flex flex-col gap-1.5">
                <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            disabled={historyLength === 0 || isBotThinking || !!gameOverResult || undoLocked}
                            title={undoLocked ? 'В партии лестницы ходы не возвращаются' : undefined}
                            onClick={onUndoSandboxMove}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                        >
                            <Undo2 size={15}/> Вернуть ход
                        </button>
                        {!gameOverResult ? (
                            <button
                                type="button"
                                onClick={onResign}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/85 text-red-200 text-xs sm:text-sm font-bold rounded-md hover:bg-red-900 transition shadow border border-red-800/50 cursor-pointer"
                            >
                                <Flag size={15}/> Сдаться
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={onOfferRematch}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-800 text-emerald-100 text-xs sm:text-sm font-bold rounded-md hover:bg-emerald-700 transition shadow border border-emerald-500/50 cursor-pointer"
                            >
                                <RefreshCw size={15}/> Реванш
                            </button>
                        )}
                    </div>

                    {savedBotGameId && (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => navigateToReview(savedBotGameId, 'Michess Bot Arena', 1850)}
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 text-xs font-bold rounded-md transition shadow border border-emerald-600/50 cursor-pointer"
                            >
                                <Eye size={14}/> Разбор партии
                            </button>
                            <a
                                href={`${API_BASE_URL}/api/v1/profile/games/${savedBotGameId}/pgn`}
                                download
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#1A120B] hover:bg-black text-amber-400 text-xs font-bold rounded-md transition shadow border border-amber-800/60"
                            >
                                <Download size={14}/> Скачать PGN
                            </a>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="shrink-0 flex flex-col gap-1.5">
            {onLoadFen && (
                <form onSubmit={submitFen} className="flex flex-col gap-1">
                    <div className="flex gap-1.5">
                        <input
                            type="text"
                            value={fenInput}
                            onChange={(e) => {
                                setFenInput(e.target.value);
                                setFenError(null);
                            }}
                            maxLength={100}
                            spellCheck={false}
                            aria-label="Позиция в записи FEN"
                            placeholder="Позиция (FEN)"
                            className="flex-1 min-w-0 px-2 py-1.5 rounded bg-black/40 border border-amber-900/60 text-boxwood-light text-xs font-mono outline-none focus:border-amber-500"
                        />
                        <button
                            type="submit"
                            disabled={!fenInput.trim()}
                            title="Поставить позицию на доску"
                            className="px-2.5 py-1.5 rounded border border-amber-700/50 bg-black/45 text-amber-200 text-xs font-bold hover:bg-black/65 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
                        >
                            <Grid3x3 size={13}/> Поставить
                        </button>
                    </div>
                    {fenError && <div role="alert" className="text-xs text-red-300">{fenError}</div>}
                </form>
            )}
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    disabled={historyLength === 0}
                    onClick={onUndoSandboxMove}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                >
                    <Undo2 size={15}/> Отменить ход
                </button>
                <button
                    type="button"
                    disabled={historyLength === 0 && !hasCustomPosition}
                    onClick={onResetSandbox}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-amber-300 text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                >
                    <RotateCcw size={15}/> Сбросить доску
                </button>
            </div>
        </div>
    );
}
