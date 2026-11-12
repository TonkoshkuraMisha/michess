// --- FILE: frontend/src/components/chessboard/AppearancePickerDropdown.tsx ---

import {Palette, ChevronDown, ChevronUp, X} from 'lucide-react';
import {BOARD_THEMES, PIECE_SETS, getPieceSvgUrl} from '../../config/boardAppearance';
import type {BoardTheme} from '../../config/boardAppearance';
import {MIN_BOARD_SIZE, getMaxViewportBoardSize} from './boardUtils';
import {useI18n} from '../../i18n';

export interface AppearancePickerDropdownProps {
    isOpen: boolean;
    onToggleOpen: () => void;
    onClose: () => void;
    activeTheme: BoardTheme;
    pieceSetKey: string;
    activePieceSetName: string;
    activePieceSetShortName: string;
    onPieceSetChange: (id: string) => void;
    onThemeChange: (id: string) => void;
    boardSize: number;
    responsiveBoardPx: number;
    onBoardSizeChange: (size: number) => void;
}

/** Выпадашка выбора комплекта фигур, темы доски и её размера — кнопка + панель настроек. */
export function AppearancePickerDropdown({
    isOpen, onToggleOpen, onClose, activeTheme, pieceSetKey, activePieceSetName,
    activePieceSetShortName, onPieceSetChange, onThemeChange, boardSize, responsiveBoardPx,
    onBoardSizeChange,
}: AppearancePickerDropdownProps) {
    const {t} = useI18n();
    return (
        <div className="relative">
            <button
                type="button"
                onClick={onToggleOpen}
                className={`px-2.5 py-1 rounded-md border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm ${
                    isOpen
                        ? 'bg-amber-700 text-white border-amber-400'
                        : 'bg-acacia-dark hover:bg-black/45 text-amber-200 border-amber-800/50'
                }`}
                title={t('board.appearance')}
            >
                <span
                    className="w-5 h-5 rounded-xs flex items-center justify-center border border-black/50 shrink-0"
                    style={{backgroundColor: activeTheme.dark}}
                >
                    <img src={getPieceSvgUrl(pieceSetKey, 'w', 'N')} alt="" className="w-4 h-4 object-contain"/>
                </span>
                <span className="hidden sm:inline">{activePieceSetShortName} • {activeTheme.name}</span>
                <span className="sm:hidden">{t('board.appearanceShort')}</span>
                {isOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
            </button>

            {isOpen && (
                <div
                    className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-[#261C14] border-2 border-amber-600/80 rounded-lg shadow-2xl z-50 p-3.5 flex flex-col gap-3 text-boxwood-light">
                    <div className="flex justify-between items-center border-b border-amber-900/50 pb-2">
                        <span className="font-bold text-amber-200 text-sm flex items-center gap-1.5">
                            <Palette size={15} className="text-amber-400"/> {t('board.appearanceTitle')}
                        </span>
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-boxwood/60 hover:text-white cursor-pointer"
                        >
                            <X size={15}/>
                        </button>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-boxwood/90">{t('board.pieceSet')}</span>
                            <span className="text-amber-400 font-bold">{activePieceSetName}</span>
                        </div>
                        <div className="grid grid-cols-5 gap-1.5">
                            {Object.values(PIECE_SETS).map((pset) => {
                                const isCurrent = pset.id === pieceSetKey;
                                return (
                                    <button
                                        key={pset.id}
                                        type="button"
                                        onClick={() => onPieceSetChange(pset.id)}
                                        title={pset.description}
                                        className={`flex flex-col items-center gap-1 p-1.5 rounded-md border text-xs font-bold transition cursor-pointer ${
                                            isCurrent
                                                ? 'bg-amber-900/60 border-amber-400 text-amber-200 shadow'
                                                : 'bg-black/35 border-amber-900/40 text-boxwood/75 hover:bg-black/55 hover:text-amber-200'
                                        }`}
                                    >
                                        <div
                                            className="w-10 h-9 rounded flex items-center justify-center border border-black/50 shadow-inner"
                                            style={{
                                                background: `linear-gradient(90deg, ${activeTheme.dark} 50%, ${activeTheme.light} 50%)`
                                            }}
                                        >
                                            <img
                                                src={getPieceSvgUrl(pset.id, 'w', 'N')}
                                                alt={pset.shortName}
                                                className="w-5 h-5 object-contain"
                                            />
                                            <img src={getPieceSvgUrl(pset.id, 'b', 'Q')} alt="" className="w-5 h-5 object-contain"/>
                                        </div>
                                        <span className="truncate w-full text-center text-[11px]">
                                            {pset.shortName}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5 pt-2 border-t border-amber-900/40">
                        <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-boxwood/90">{t('board.boardSurface')}</span>
                            <span className="text-amber-400 font-bold">{activeTheme.name}</span>
                        </div>
                        <div className="grid grid-cols-5 gap-1.5">
                            {Object.values(BOARD_THEMES).map((theme) => {
                                const isCurrent = theme.id === activeTheme.id;
                                return (
                                    <button
                                        key={theme.id}
                                        type="button"
                                        onClick={() => onThemeChange(theme.id)}
                                        className={`flex flex-col items-center gap-1 p-1.5 rounded-md border text-xs font-bold transition cursor-pointer ${
                                            isCurrent
                                                ? 'bg-amber-900/60 border-amber-400 text-amber-200 shadow'
                                                : 'bg-black/35 border-amber-900/40 text-boxwood/75 hover:bg-black/55 hover:text-amber-200'
                                        }`}
                                    >
                                        <div
                                            className="w-8 h-8 rounded-xs overflow-hidden grid grid-cols-2 grid-rows-2 border-2 shadow-sm"
                                            style={{borderColor: theme.border}}
                                        >
                                            <div style={{backgroundColor: theme.light}}/>
                                            <div style={{backgroundColor: theme.dark}}/>
                                            <div style={{backgroundColor: theme.dark}}/>
                                            <div style={{backgroundColor: theme.light}}/>
                                        </div>
                                        <span className="truncate w-full text-center text-[11px]">
                                            {theme.name}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-amber-900/40 text-xs">
                        <span className="text-boxwood/80 font-bold">{t('board.size', {px: responsiveBoardPx})}</span>
                        <input
                            type="range"
                            min={MIN_BOARD_SIZE}
                            max={getMaxViewportBoardSize()}
                            value={boardSize}
                            onChange={(e) => onBoardSizeChange(Number(e.target.value))}
                            className="flex-1 accent-amber-500 cursor-pointer"
                        />
                        <button
                            type="button"
                            onClick={() => onBoardSizeChange(getMaxViewportBoardSize())}
                            className="px-2 py-1 rounded bg-black/45 hover:bg-amber-800/60 border border-amber-700/50 text-amber-200 font-bold cursor-pointer"
                        >
                            {t('board.autoSize')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
