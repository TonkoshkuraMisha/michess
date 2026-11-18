// --- FILE: frontend/src/components/chessboard/GameControlsPanel.tsx ---
// Кнопки управления партией под списком ходов. Три режима с разным набором действий: партия с человеком (отмена до
// первых ходов, сдача, ничья, берсерк в арене, реванш), партия с ботом (возврат хода, сдача, ничья, реванш) и
// свободная доска (сброс, возврат хода, позиция из FEN). После партии с человеком или с ботом — «Разбор» (страница
// /game/{id}) и скачивание PGN (GET /profile/games/{id}/pgn). Сам компонент ничего не отправляет: действия
// выполняет Chessboard (WebSocket для партии с человеком, хук useBotGame для бота).

import {useState} from 'react';
import {Flag, Handshake, X, RefreshCw, RotateCcw, Undo2, Eye, Download, Grid3x3, Zap} from 'lucide-react';
import type {NavigateFunction} from 'react-router-dom';
import {API_BASE_URL} from '../../config/api';
import {useI18n} from '../../i18n';

/** Состояние реванша после партии с человеком (события WebSocket rematch_offered и rematch_declined). */
export type RematchStatus = 'none' | 'offered_by_me' | 'offered_by_opponent' | 'declined';

export interface GameControlsPanelProps {
    /** Партия с человеком (идёт или только что окончена), партия с ботом (любым) или свободная доска. */
    mode: 'pvp' | 'bot' | 'sandbox';
    gameId: number | null;
    /** id партии с ботом в архиве — появляется после сохранения (/bots/save-game); без него разбора и PGN нет. */
    savedBotGameId: number | null;
    historyLength: number;
    gameOverResult: string | null;
    rematchStatus: RematchStatus;
    isBotThinking: boolean;
    whitePlayer: { username: string; rating: string };
    blackPlayer: { username: string; rating: string };
    navigate: NavigateFunction;
    onAbortGame: () => void;
    /** Партия арены до своего первого хода (33.3): «берсерк» — половина времени без добавки ради лишнего очка. */
    onBerserk?: () => void;
    onResign: () => void;
    onOfferDraw: () => void;
    onAcceptRematch: () => void;
    onDeclineRematch: () => void;
    onOfferRematch: () => void;
    /** Сброс свободной доски; после партии с человеком тот же обработчик — кнопка «В лобби». */
    onResetSandbox: () => void;
    /** Возврат хода: на свободной доске и в партии с ботом (там — вместе с ответом бота). */
    onUndoSandboxMove: () => void;
    /** Идёт партия клубной лестницы или турнира: возврат хода запрещён. */
    undoLocked?: boolean;
    /** На свободной доске стоит позиция, загруженная из FEN (сброс доступен и без ходов). */
    hasCustomPosition?: boolean;
    /** Ставит на свободную доску позицию из FEN; возвращает текст ошибки или null. */
    onLoadFen?: (fen: string) => string | null;
    /** Партия турнира: реванша нет — после партии ведёт плашка турнира (следующая партия, таблица). */
    hideRematch?: boolean;
}

/**
 * Кнопки управления партией под журналом ходов — три независимых режима (PvP/бот/песочница),
 * т.к. набор доступных действий (сдача vs отмена, реванш vs возврат в лобби...) разный у каждого.
 */
export function GameControlsPanel({
    mode, gameId, savedBotGameId, historyLength, gameOverResult, rematchStatus, isBotThinking,
    whitePlayer, blackPlayer, navigate, onAbortGame, onResign, onOfferDraw, onAcceptRematch,
    onDeclineRematch, onOfferRematch, onResetSandbox, onUndoSandboxMove, undoLocked = false, hasCustomPosition = false, onLoadFen,
    hideRematch = false, onBerserk,
}: GameControlsPanelProps) {
    const {t} = useI18n();
    const [fenInput, setFenInput] = useState('');
    const [fenError, setFenError] = useState<string | null>(null);

    const submitFen = (e: React.FormEvent) => {
        e.preventDefault();
        if (!onLoadFen || !fenInput.trim()) return;
        const error = onLoadFen(fenInput);
        setFenError(error);
        if (!error) setFenInput('');
    };

    // Переход к разбору: имена, рейтинги и итог передаются в state маршрута — страница партии (GameViewer) берёт
    // их в первую очередь, а заголовки PGN — когда state нет (прямой заход по адресу). Запасной рейтинг — для
    // стороны без числа в карточке.
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

    // Партия с человеком: пока сделано меньше двух полуходов — «Отменить» (партия не засчитывается), дальше —
    // «Сдаться»; ничью можно предложить с того же момента.
    if (mode === 'pvp') {
        return (
            <div className="shrink-0 flex flex-col gap-1.5">
                {onBerserk && !gameOverResult && (
                    <button
                        type="button"
                        onClick={onBerserk}
                        title={t('controls.berserkHint')}
                        data-testid="berserk-button"
                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-950/90 text-orange-200 text-xs sm:text-sm font-bold rounded-md hover:bg-orange-900 transition shadow border border-orange-600/60 cursor-pointer"
                    >
                        <Zap size={15}/> {t('controls.berserk')}
                    </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                    {historyLength < 2 ? (
                        <button
                            type="button"
                            onClick={onAbortGame}
                            disabled={!!gameOverResult}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-950/90 text-amber-200 text-xs sm:text-sm font-bold rounded-md hover:bg-amber-900 transition shadow border border-amber-700/60 disabled:opacity-40 cursor-pointer"
                        >
                            <X size={15}/> {t('controls.abort')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onResign}
                            disabled={!!gameOverResult}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/85 text-red-200 text-xs sm:text-sm font-bold rounded-md hover:bg-red-900 transition shadow border border-red-800/50 disabled:opacity-40 cursor-pointer"
                        >
                            <Flag size={15}/> {t('controls.resign')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onOfferDraw}
                        disabled={!!gameOverResult || historyLength < 2}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                    >
                        <Handshake size={15}/> {t('controls.offerDraw')}
                    </button>
                </div>

                {gameOverResult && (
                    <div className="flex flex-col gap-1.5">
                        {rematchStatus === 'offered_by_opponent' ? (
                            <div
                                className="p-2 rounded-md bg-emerald-950/90 border border-emerald-500/60 flex flex-col gap-1.5 text-xs text-emerald-100 text-center shadow">
                                <span className="font-bold">{t('controls.rematchOffered')}</span>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={onAcceptRematch}
                                        className="py-1.5 px-3 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded transition shadow cursor-pointer"
                                    >
                                        {t('controls.acceptRematch')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onDeclineRematch}
                                        className="py-1.5 px-3 bg-red-900/80 hover:bg-red-800 text-red-100 font-bold rounded transition cursor-pointer"
                                    >
                                        {t('common.decline')}
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
                                        ? t('controls.waitingAnswer')
                                        : rematchStatus === 'declined'
                                            ? t('controls.rematchDeclined')
                                            : t('controls.rematch')}
                                </button>
                                <button
                                    type="button"
                                    onClick={onResetSandbox}
                                    className="flex items-center justify-center gap-1.5 px-3 py-2 font-bold text-xs sm:text-sm rounded-md transition shadow bg-boxwood text-acacia-dark border border-amber-700/50 hover:bg-boxwood-light cursor-pointer"
                                >
                                    <RotateCcw size={15}/> {t('controls.toLobby')}
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
                                <Eye size={14}/> {t('common.gameReview')}
                            </button>
                            <a
                                href={`${API_BASE_URL}/api/v1/profile/games/${gameId}/pgn`}
                                download
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#1A120B] hover:bg-black text-amber-400 text-xs font-bold rounded-md transition shadow border border-amber-800/60"
                            >
                                <Download size={14}/> {t('common.downloadPgn')}
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
                    {!(hideRematch && gameOverResult) && <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            disabled={historyLength === 0 || isBotThinking || !!gameOverResult || undoLocked}
                            title={undoLocked ? t('ladder.undoLocked') : undefined}
                            onClick={onUndoSandboxMove}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-boxwood-light text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                        >
                            <Undo2 size={15}/> {t('controls.undoMove')}
                        </button>
                        {!gameOverResult ? (
                            <button
                                type="button"
                                onClick={onResign}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/85 text-red-200 text-xs sm:text-sm font-bold rounded-md hover:bg-red-900 transition shadow border border-red-800/50 cursor-pointer"
                            >
                                <Flag size={15}/> {t('controls.resign')}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={onOfferRematch}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-800 text-emerald-100 text-xs sm:text-sm font-bold rounded-md hover:bg-emerald-700 transition shadow border border-emerald-500/50 cursor-pointer"
                            >
                                <RefreshCw size={15}/> {t('controls.rematch')}
                            </button>
                        )}
                    </div>}
                    {/* Ничья с ботом (таск 21.4): бот отвечает по оценке позиции и своему отношению к ничьей. */}
                    {!gameOverResult && historyLength >= 2 && (
                        <button
                            type="button"
                            onClick={onOfferDraw}
                            disabled={isBotThinking}
                            data-testid="bot-offer-draw"
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-acacia-dark text-boxwood-light text-xs font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                        >
                            <Handshake size={14}/> {t('controls.offerDraw')}
                        </button>
                    )}

                    {savedBotGameId && (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => navigateToReview(savedBotGameId, 'Michess Bot Arena', 1850)}
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 text-xs font-bold rounded-md transition shadow border border-emerald-600/50 cursor-pointer"
                            >
                                <Eye size={14}/> {t('common.gameReview')}
                            </button>
                            <a
                                href={`${API_BASE_URL}/api/v1/profile/games/${savedBotGameId}/pgn`}
                                download
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#1A120B] hover:bg-black text-amber-400 text-xs font-bold rounded-md transition shadow border border-amber-800/60"
                            >
                                <Download size={14}/> {t('common.downloadPgn')}
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
                            aria-label={t('controls.fenLabel')}
                            placeholder={t('controls.fenPlaceholder')}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded bg-black/40 border border-amber-900/60 text-boxwood-light text-xs font-mono outline-none focus:border-amber-500"
                        />
                        <button
                            type="submit"
                            disabled={!fenInput.trim()}
                            title={t('controls.setPositionHint')}
                            className="px-2.5 py-1.5 rounded border border-amber-700/50 bg-black/45 text-amber-200 text-xs font-bold hover:bg-black/65 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
                        >
                            <Grid3x3 size={13}/> {t('controls.setPosition')}
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
                    <Undo2 size={15}/> {t('controls.undoSandbox')}
                </button>
                <button
                    type="button"
                    disabled={historyLength === 0 && !hasCustomPosition}
                    onClick={onResetSandbox}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-acacia-dark text-amber-300 text-xs sm:text-sm font-bold rounded-md hover:bg-black/50 transition shadow border border-amber-700/30 disabled:opacity-40 cursor-pointer"
                >
                    <RotateCcw size={15}/> {t('controls.resetBoard')}
                </button>
            </div>
        </div>
    );
}
