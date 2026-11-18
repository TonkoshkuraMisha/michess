// --- FILE: frontend/src/components/ui/SegmentedControl.tsx ---
// Переключатель вкладок (общие компоненты дизайна, план владельца 18.11): режимы и фильтры на одной строке вместо
// россыпи одинаковых кнопок. Доступность — role="tablist"/"tab", aria-selected, стрелки влево/вправо переводят выбор.
// Опции — данные вызывающего: id, подпись (уже на языке игрока), иконка и необязательная подсказка.

import {useRef} from 'react';
import type {KeyboardEvent, ReactNode} from 'react';

export interface SegmentOption<T extends string> {
    id: T;
    label: ReactNode;
    icon?: ReactNode;
    title?: string;
}

interface Props<T extends string> {
    options: SegmentOption<T>[];
    value: T;
    onChange: (id: T) => void;
    /** Подпись группы для читалок экрана. */
    label: string;
    /** На всю ширину: вкладки делят строку поровну. */
    stretch?: boolean;
    testIdPrefix?: string;
}

export function SegmentedControl<T extends string>({options, value, onChange, label, stretch = false, testIdPrefix}: Props<T>) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const onKey = (event: KeyboardEvent, index: number) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const next = (index + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length;
        onChange(options[next].id);
        refs.current[next]?.focus();
    };
    return (
        <div role="tablist" aria-label={label}
             className={`inline-flex flex-wrap gap-1 rounded-lg bg-black/30 border border-amber-900/50 p-1 ${stretch ? 'w-full' : ''}`}>
            {options.map((option, index) => {
                const selected = option.id === value;
                return (
                    <button key={option.id} type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1}
                            ref={(el) => {
                                refs.current[index] = el;
                            }}
                            title={option.title} onClick={() => onChange(option.id)} onKeyDown={(e) => onKey(e, index)}
                            data-testid={testIdPrefix ? `${testIdPrefix}-${option.id}` : undefined}
                            className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold transition-colors cursor-pointer ${
                                stretch ? 'flex-1' : ''} ${selected ? 'bg-amber-700 text-white shadow-sm' : 'text-boxwood/80 hover:text-amber-200 hover:bg-white/5'}`}>
                        {option.icon}{option.label}
                    </button>
                );
            })}
        </div>
    );
}
