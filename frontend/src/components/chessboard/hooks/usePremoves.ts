// --- FILE: frontend/src/components/chessboard/hooks/usePremoves.ts ---

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Chess} from 'chess.js';
import type {PromotionPiece} from '../boardUtils';
import type {SoundEventType} from '../../../services/soundEngine';

export interface Premove {
    from: string;
    to: string;
    promotion?: PromotionPiece;
}

export interface UsePremovesOptions {
    game: Chess;
    myColor: 'white' | 'black';
    gameOverResult: string | null;
    /** -1 — живая позиция; любое другое значение — просмотр истории, премувы не исполняются. */
    viewIndex: number;
    /** Премувы имеют смысл только в PvP и партиях с ботом — не в свободном анализе. */
    isOpponentControlled: boolean;
    executeMove: (from: string, to: string, explicitPromotion?: PromotionPiece, isPremoveMove?: boolean) => boolean;
    playAudio: (type: SoundEventType) => void;
    /** Снимает выделение клетки и обрывает текущее перетаскивание — премув начинается «с чистого». */
    clearSelection: () => void;
    /** Открывает диалог выбора фигуры для премува-превращения (closes с isPremove: true). */
    openPromotionDialog: (p: { from: string; to: string; color: 'w' | 'b'; isPremove: true }) => void;
}

/** Сколько предходов можно поставить подряд. */
export const MAX_PREMOVES = 8;

/**
 * Позиция «как если бы предходы уже сыграны»: фигуры просто переставлены (без проверки правил — она при исполнении),
 * рокировка переносит и ладью, превращение ставит выбранную фигуру. По ней выбираются фигуры для следующих предходов
 * и рисуется доска, пока очередь не пуста.
 */
export function applyPremoves(game: Chess, premoves: Premove[]): Chess {
    const view = new Chess(game.fen());
    for (const move of premoves) {
        const piece = view.get(move.from as never);
        if (!piece) continue;
        view.remove(move.from as never);
        view.put(move.promotion ? {type: move.promotion, color: piece.color} : piece, move.to as never);
        const fileShift = move.to.charCodeAt(0) - move.from.charCodeAt(0);
        if (piece.type === 'k' && Math.abs(fileShift) === 2) {
            const rank = move.from[1];
            const [rookFrom, rookTo] = fileShift > 0 ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
            const rook = view.get(rookFrom as never);
            if (rook && rook.type === 'r' && rook.color === piece.color) {
                view.remove(rookFrom as never);
                view.put(rook, rookTo as never);
            }
        }
    }
    return view;
}

export interface UsePremovesResult {
    /** Первый предход очереди (его исполнят следующим). */
    premove: Premove | null;
    /** Вся очередь предходов. */
    premoves: Premove[];
    /** Позиция после предходов очереди (см. applyPremoves). */
    premoveView: Chess;
    /** null — снять всю очередь; предход — заменить очередь им одним. */
    setPremove: (value: Premove | null) => void;
    /** Ставит ход в премув (или открывает диалог превращения) — вызывается на чужом ходу. */
    scheduleOrPromotePremove: (from: string, to: string, explicitPromotion?: PromotionPiece) => void;
}

/**
 * Предход: пока ходит соперник, игрок может заранее указать свой следующий ход. Как только
 * позиция подтверждает, что очередь перешла к игроку, премув автоматически исполняется через
 * executeMove (с isPremoveMove=true — сервер не засчитывает время на обдумывание такого хода).
 */
export function usePremoves({
    game, myColor, gameOverResult, viewIndex, isOpponentControlled, executeMove, playAudio,
    clearSelection, openPromotionDialog,
}: UsePremovesOptions): UsePremovesResult {
    const [premoves, setPremoves] = useState<Premove[]>([]);
    const premoveView = useMemo(() => (premoves.length ? applyPremoves(game, premoves) : game), [game, premoves]);
    const setPremove = useCallback((value: Premove | null) => setPremoves(value ? [value] : []), []);

    const scheduleOrPromotePremove = useCallback((from: string, to: string, explicitPromotion?: PromotionPiece) => {
        if (from === to) return;
        // Фигура — с поля, где она окажется после уже поставленных предходов (цепочка: Кf3, затем Кg5).
        const piece = premoveView.get(from as never);
        const myColorChar = myColor === 'white' ? 'w' : 'b';
        if (!piece || piece.color !== myColorChar) {
            clearSelection();
            return;
        }

        const targetRank = to[1];
        const isPawnPromotion =
            piece.type === 'p' &&
            ((piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1'));

        if (isPawnPromotion && !explicitPromotion) {
            openPromotionDialog({from, to, color: myColorChar, isPremove: true});
            clearSelection();
            return;
        }

        const next = {from, to, promotion: isPawnPromotion ? (explicitPromotion || 'q') : undefined};
        setPremoves((queue) => (queue.length >= MAX_PREMOVES ? queue : [...queue, next]));
        playAudio('premove');
        clearSelection();
    }, [premoveView, myColor, playAudio, clearSelection, openPromotionDialog]);

    useEffect(() => {
        if (premoves.length === 0 || gameOverResult || viewIndex !== -1 || !isOpponentControlled) return;

        const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';
        if (currentTurnColor !== myColor) return;

        // Первый предход исполняется; если он стал невозможен (соперник ответил иначе) — снимается вся очередь:
        // остальные строились на нём.
        const [first, ...rest] = premoves;
        const played = executeMove(first.from, first.to, first.promotion || 'q', true);
        setPremoves(played ? rest : []);
    }, [game, premoves, isOpponentControlled, myColor, gameOverResult, viewIndex, executeMove]);

    return {premove: premoves[0] ?? null, premoves, premoveView, setPremove, scheduleOrPromotePremove};
}
