// --- FILE: frontend/src/components/gameViewer/MoveList.tsx ---
// Запись партии в просмотре (вынесено из GameViewer.tsx, таск 17.6): пары ходов, оценка и символ разбора у хода,
// значок «по этой ошибке есть личная задача».

import type {RefObject} from 'react';
import {Puzzle as PuzzleBadgeIcon} from 'lucide-react';
import {useI18n} from '../../i18n';
import {classificationBadgeClass} from './viewerModel';
import type {MoveEvaluationItem} from './viewerModel';

export interface ViewerMovePair {
    moveNumber: number;
    white: string;
    black: string;
    whiteIndex: number;
    blackIndex: number;
}

interface MoveCellProps {
    san: string;
    index: number;
    active: boolean;
    analysis?: MoveEvaluationItem;
    personal: boolean;
    onSelect: (index: number, san: string) => void;
}

function MoveCell({san, index, active, analysis, personal, onSelect}: MoveCellProps) {
    const {t} = useI18n();
    return (
        <button
            onClick={() => {
                if (!active) onSelect(index, san);
            }}
            className={`text-left px-2 py-0.5 rounded flex items-center justify-between gap-1 cursor-pointer transition ${
                active ? 'active-move bg-amber-600/40 text-white font-bold border border-amber-500/50' : 'text-amber-100/90 hover:bg-amber-900/30 hover:text-white'
            }`}
        >
            <span className="truncate">
                {san}
                {analysis?.symbol && <span className={`ml-0.5 ${classificationBadgeClass(analysis.classification)}`}>{analysis.symbol}</span>}
                {personal && (
                    <PuzzleBadgeIcon size={11} className="inline ml-1 text-sky-300" aria-label={t('puzzles.personal.badge')}
                                     data-testid={`personal-badge-${index + 1}`}/>
                )}
            </span>
            {analysis && <span className="text-[10px] text-boxwood/55 shrink-0">{analysis.eval_display}</span>}
        </button>
    );
}

export function MoveList({pairs, viewIndex, moves, personalPlies, scrollRef, onSelect}: {
    pairs: ViewerMovePair[];
    viewIndex: number;
    moves?: MoveEvaluationItem[];
    personalPlies: Set<number>;
    scrollRef: RefObject<HTMLDivElement | null>;
    onSelect: (index: number, san: string) => void;
}) {
    const {t} = useI18n();
    return (
        <div data-testid="move-list" className="flex-1 min-h-36 max-h-[50dvh] xl:max-h-none flex flex-col bg-room-dark/90 rounded-md border border-amber-900/50 overflow-hidden shadow-inner">
            <div className="grid grid-cols-[44px_1fr_1fr] px-3 py-1.5 bg-black/55 border-b border-amber-900/40 text-xs uppercase tracking-wider text-boxwood/65 font-bold shrink-0">
                <span>{t('board.moveNumber')}</span>
                <span>{t('common.white')}</span>
                <span>{t('common.black')}</span>
            </div>
            <div
                ref={scrollRef}
                className="flex-1 min-h-0 overflow-y-auto p-1.5 font-mono text-sm divide-y divide-amber-900/15 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-amber-900/50"
            >
                {pairs.map((pair, idx) => (
                    <div key={idx} className="grid grid-cols-[44px_1fr_1fr] items-center px-2 py-1 hover:bg-white/5 rounded">
                        <span className="text-xs text-amber-500/70 font-bold">{pair.moveNumber}.</span>
                        <MoveCell san={pair.white} index={pair.whiteIndex} active={viewIndex === pair.whiteIndex}
                                  analysis={moves?.[pair.whiteIndex]} personal={personalPlies.has(pair.whiteIndex + 1)} onSelect={onSelect}/>
                        {pair.black ? (
                            <MoveCell san={pair.black} index={pair.blackIndex} active={viewIndex === pair.blackIndex}
                                      analysis={pair.blackIndex >= 0 ? moves?.[pair.blackIndex] : undefined}
                                      personal={personalPlies.has(pair.blackIndex + 1)} onSelect={onSelect}/>
                        ) : <span/>}
                    </div>
                ))}
            </div>
        </div>
    );
}
