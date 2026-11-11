// --- FILE: frontend/src/components/chessboard/GameHallHeader.tsx ---

import {Sword, RefreshCw, Volume2, VolumeX} from 'lucide-react';

export interface GameHallHeaderProps {
    sessionStats: { wins: number; losses: number; draws: number };
    isSoundMuted: boolean;
    onToggleSound: () => void;
    onFlipBoard: () => void;
}

/** Заголовок левой колонки: название раздела, счёт текущей сессии, звук и переворот доски. */
export function GameHallHeader({sessionStats, isSoundMuted, onToggleSound, onFlipBoard}: GameHallHeaderProps) {
    return (
        <div className="border-b border-acacia-light pb-2 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-2">
                <div className="p-1.5 bg-acacia-dark rounded-md border border-amber-600/30 text-amber-400">
                    <Sword size={16}/>
                </div>
                <div>
                    <div className="text-[11px] tracking-wider uppercase text-boxwood/75 font-bold">
                        Игровой зал
                    </div>
                    <div className="text-xs font-bold flex items-center gap-1.5 font-mono">
                        <span className="text-boxwood/80 font-sans">Счёт сессии:</span>
                        <span className="text-emerald-400">+{sessionStats.wins}</span>
                        <span className="text-red-400">-{sessionStats.losses}</span>
                        <span className="text-gray-300">={sessionStats.draws}</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={onToggleSound}
                    className={`p-1.5 rounded-md border transition cursor-pointer shadow-sm ${
                        isSoundMuted
                            ? 'bg-red-950/60 border-red-800/60 text-red-300 hover:bg-red-900/60'
                            : 'bg-acacia-dark hover:bg-black/50 border-amber-800/50 text-amber-300'
                    }`}
                    title={isSoundMuted ? 'Включить звук' : 'Выключить звук'}
                >
                    {isSoundMuted ? <VolumeX size={15}/> : <Volume2 size={15}/>}
                </button>
                <button
                    type="button"
                    onClick={onFlipBoard}
                    className="px-2.5 py-1 rounded-md bg-acacia-dark hover:bg-black/50 border border-amber-800/50 text-xs font-bold text-amber-200 flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                    title="Перевернуть доску"
                >
                    <RefreshCw size={13} className="text-amber-400"/> Перевернуть
                </button>
            </div>
        </div>
    );
}
