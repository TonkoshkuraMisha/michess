// --- FILE: frontend/src/components/ui/Indicators.tsx ---
// Небольшие показатели (общие компоненты дизайна, план владельца 18.11): Badge — метка состояния (тон по смыслу:
// success — пройдено, accent — новое/текущее, danger — ошибка/закрыто, neutral — справка), ProgressBar — полоса
// прогресса с подписью «3 / 10» (для доступности — role="progressbar"), EmptyState — пустой список: иконка, текст и
// одно действие, чтобы пустая страница подсказывала, что делать дальше.

import type {ReactNode} from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger';

const TONES: Record<BadgeTone, string> = {
    neutral: 'bg-black/30 text-boxwood/85 border-amber-900/50',
    accent: 'bg-amber-500/15 text-amber-200 border-amber-500/50',
    success: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/50',
    danger: 'bg-rose-500/15 text-rose-200 border-rose-500/50',
};

export function Badge({tone = 'neutral', icon, children}: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap ${TONES[tone]}`}>
            {icon}{children}
        </span>
    );
}

interface ProgressProps {
    value: number;
    max: number;
    /** Подпись для читалок экрана (видимая подпись — «value / max» справа). */
    label: string;
    showNumbers?: boolean;
}

export function ProgressBar({value, max, label, showNumbers = true}: ProgressProps) {
    const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    return (
        <div className="flex items-center gap-2 flex-1 min-w-[8rem]">
            <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}
                 className="h-1.5 flex-1 rounded-full bg-black/40 overflow-hidden">
                <div className={`h-full rounded-full ${share >= 1 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{width: `${Math.round(share * 100)}%`}}/>
            </div>
            {showNumbers && <span className="text-xs font-mono text-boxwood/75 shrink-0">{value} / {max}</span>}
        </div>
    );
}

interface EmptyProps {
    icon?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
}

export function EmptyState({icon, title, description, action}: EmptyProps) {
    return (
        <div className="rounded-lg border border-dashed border-amber-900/60 p-6 flex flex-col items-center text-center gap-2">
            {icon && <span className="text-amber-400/80" aria-hidden>{icon}</span>}
            <p className="font-bold text-amber-200">{title}</p>
            {description && <p className="text-sm text-boxwood/75 max-w-md">{description}</p>}
            {action && <div className="pt-1">{action}</div>}
        </div>
    );
}
