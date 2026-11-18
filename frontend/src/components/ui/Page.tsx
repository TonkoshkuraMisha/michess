// --- FILE: frontend/src/components/ui/Page.tsx ---
// Каркас страницы (общие компоненты дизайна, план владельца 18.11): одинаковые ширина, поля и заголовок на всех
// разделах. Ширины: narrow — чтение и списки (школа, правила), default — страницы с панелями (задачи, турниры),
// wide — доска с панелями (игровой зал, разбор). Заголовок: иконка, название, одна строка пояснения и место для
// действий справа (на телефоне — под названием).

import type {ReactNode} from 'react';

export type PageWidth = 'narrow' | 'default' | 'wide';

const WIDTHS: Record<PageWidth, string> = {
    narrow: 'max-w-4xl',
    default: 'max-w-6xl',
    wide: 'max-w-[1600px]',
};

interface PageProps {
    width?: PageWidth;
    children: ReactNode;
    className?: string;
    testId?: string;
}

/** Контейнер страницы: ширина по виду, поля 12/16 px, вертикальный ритм 16 px. */
export function Page({width = 'default', children, className = '', testId}: PageProps) {
    return (
        <div data-testid={testId}
             className={`w-full ${WIDTHS[width]} mx-auto px-3 sm:px-4 py-4 flex flex-col gap-4 text-boxwood-light ${className}`}>
            {children}
        </div>
    );
}

interface PageHeaderProps {
    title: ReactNode;
    /** Иконка раздела (lucide-react). */
    icon?: ReactNode;
    /** Одна-две строки: что здесь делают. */
    description?: ReactNode;
    /** Действия справа: обычно одна главная кнопка. */
    actions?: ReactNode;
}

export function PageHeader({title, icon, description, actions}: PageHeaderProps) {
    return (
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
                <h1 className="text-2xl font-bold text-amber-200 flex items-center gap-2">
                    {icon && <span className="text-amber-400 shrink-0" aria-hidden>{icon}</span>}
                    <span className="min-w-0 break-words">{title}</span>
                </h1>
                {description && <p className="text-boxwood/80 max-w-3xl">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
        </header>
    );
}

interface SectionProps {
    title: ReactNode;
    /** Справа от заголовка раздела: ссылка «Все», счётчик и т. п. */
    aside?: ReactNode;
    children: ReactNode;
    testId?: string;
}

/** Раздел страницы: заголовок второго уровня и содержимое с отступом 8 px. */
export function Section({title, aside, children, testId}: SectionProps) {
    return (
        <section className="flex flex-col gap-2" data-testid={testId}>
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-bold text-amber-200">{title}</h2>
                {aside && <div className="text-sm text-boxwood/75">{aside}</div>}
            </div>
            {children}
        </section>
    );
}
