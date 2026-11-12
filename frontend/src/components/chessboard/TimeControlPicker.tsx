// --- FILE: frontend/src/components/chessboard/TimeControlPicker.tsx ---

import type {RefObject} from 'react';
import {Clock, ChevronDown, ChevronUp, Sliders} from 'lucide-react';
import {TIME_CONTROLS} from '../../config/timeControls';
import type {TimeControlOption} from '../../config/timeControls';
import {useI18n} from '../../i18n';

export interface TimeControlPickerProps {
    selectedTimeControl: TimeControlOption;
    manualBaseMinutes: number;
    manualIncSeconds: number;
    onManualBaseMinutesChange: (minutes: number) => void;
    onManualIncSecondsChange: (seconds: number) => void;
    isOpen: boolean;
    onToggleOpen: () => void;
    onSelect: (option: TimeControlOption) => void;
    /** Пока партия уже назначена/идёт, менять контроль времени нельзя. */
    disabled: boolean;
    dropdownRef: RefObject<HTMLDivElement | null>;
}

/** Выбор контроля времени: предустановки по категориям + ручная настройка минут/бонуса. */
export function TimeControlPicker({
    selectedTimeControl, manualBaseMinutes, manualIncSeconds, onManualBaseMinutesChange,
    onManualIncSecondsChange, isOpen, onToggleOpen, onSelect, disabled, dropdownRef,
}: TimeControlPickerProps) {
    const {t} = useI18n();
    return (
        <>
            <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wider text-boxwood/85 flex items-center gap-1.5 font-bold">
                    <Clock className="text-amber-500" size={13}/> {t('timeControl.title')}
                </label>
                <span
                    className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-900/45 text-amber-300 border border-amber-600/30">
                    {TIME_CONTROLS.find(g => g.category === selectedTimeControl.category)?.title}
                </span>
            </div>

            <div className="relative w-full" ref={dropdownRef}>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onToggleOpen}
                    className="w-full bg-black/45 border border-amber-700/50 hover:bg-black/65 disabled:opacity-50 transition text-amber-200 rounded-md px-2.5 py-1.5 text-xs sm:text-sm font-bold outline-none cursor-pointer flex justify-between items-center shadow-inner gap-2"
                >
                    <span className="truncate">
                        {selectedTimeControl.label}
                        {selectedTimeControl.isManual ? t('timeControl.manualSummary', {base: manualBaseMinutes, inc: manualIncSeconds}) : ''}
                    </span>
                    {isOpen ? <ChevronUp className="text-amber-400 shrink-0" size={15}/> :
                        <ChevronDown className="text-amber-400 shrink-0" size={15}/>}
                </button>

                {isOpen && (
                    <div
                        className="absolute z-50 w-full top-full mt-1 bg-[#1A120B] border-2 border-amber-700/60 rounded-md shadow-2xl max-h-72 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-black/20 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
                        {TIME_CONTROLS.map((group) => (
                            <div key={group.category}>
                                <div
                                    className="px-3 py-1.5 text-xs uppercase tracking-wider text-amber-400 bg-black/90 font-bold sticky top-0 z-10 border-b border-t border-amber-900/40 first:border-t-0">
                                    {group.title}
                                </div>
                                {group.options.map((opt) => {
                                    const isSelected = selectedTimeControl.id === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            className={`w-full text-left px-3 py-2 text-xs sm:text-sm transition flex justify-between items-start gap-2 border-b border-amber-950/30 cursor-pointer ${
                                                isSelected
                                                    ? 'bg-amber-900/45 text-amber-300 font-bold'
                                                    : 'text-amber-100/90 hover:bg-amber-900/25 hover:text-amber-200'
                                            }`}
                                            onClick={() => onSelect(opt)}
                                        >
                                            <div className="min-w-0">
                                                <span className="truncate font-bold">{opt.label}</span>
                                                <div className="text-xs text-boxwood/70 mt-0.5 leading-snug">
                                                    {opt.details}
                                                </div>
                                            </div>
                                            {isSelected && <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0 mt-1.5"/>}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {selectedTimeControl.isManual && (
                <div className="p-2 rounded bg-black/40 border border-amber-700/40 flex flex-col gap-1.5 text-xs">
                    <div className="text-[11px] uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
                        <Sliders size={12}/> {t('timeControl.manualTitle')}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-0.5 text-xs text-boxwood/85">
                            <span>{t('timeControl.baseMinutes')}</span>
                            <input
                                type="number"
                                min={1}
                                max={240}
                                value={manualBaseMinutes}
                                onChange={(e) => onManualBaseMinutesChange(Math.max(1, Math.min(240, Number(e.target.value) || 1)))}
                                className="bg-black/60 border border-amber-700/50 rounded px-2 py-1 text-amber-200 font-mono text-xs outline-none"
                            />
                        </label>
                        <label className="flex flex-col gap-0.5 text-xs text-boxwood/85">
                            <span>{t('timeControl.increment')}</span>
                            <input
                                type="number"
                                min={0}
                                max={180}
                                value={manualIncSeconds}
                                onChange={(e) => onManualIncSecondsChange(Math.max(0, Math.min(180, Number(e.target.value) || 0)))}
                                className="bg-black/60 border border-amber-700/50 rounded px-2 py-1 text-amber-200 font-mono text-xs outline-none"
                            />
                        </label>
                    </div>
                </div>
            )}
        </>
    );
}
