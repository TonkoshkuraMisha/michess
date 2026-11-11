// --- FILE: frontend/src/components/chessboard/hooks/usePremoves.ts ---

import {useCallback, useEffect, useState} from 'react';
import type {Chess} from 'chess.js';
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

export interface UsePremovesResult {
    premove: Premove | null;
    setPremove: React.Dispatch<React.SetStateAction<Premove | null>>;
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
    const [premove, setPremove] = useState<Premove | null>(null);

    const scheduleOrPromotePremove = useCallback((from: string, to: string, explicitPromotion?: PromotionPiece) => {
        if (from === to) return;
        const piece = game.get(from as any);
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

        setPremove({
            from,
            to,
            promotion: isPawnPromotion ? (explicitPromotion || 'q') : undefined,
        });
        playAudio('premove');
        clearSelection();
    }, [game, myColor, playAudio, clearSelection, openPromotionDialog]);

    useEffect(() => {
        if (!premove || gameOverResult || viewIndex !== -1 || !isOpponentControlled) return;

        const currentTurnColor = game.turn() === 'w' ? 'white' : 'black';
        if (currentTurnColor !== myColor) return;

        const currentPremove = premove;
        setPremove(null);
        executeMove(currentPremove.from, currentPremove.to, currentPremove.promotion || 'q', true);
    }, [game, premove, isOpponentControlled, myColor, gameOverResult, viewIndex, executeMove]);

    return {premove, setPremove, scheduleOrPromotePremove};
}
