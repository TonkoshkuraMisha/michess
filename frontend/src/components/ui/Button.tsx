// --- FILE: frontend/src/components/ui/Button.tsx ---
// Кнопки платформы (общие компоненты дизайна, план владельца 18.11). Иерархия: primary — одно главное действие на
// экране (янтарная заливка), secondary — обычные действия (тёмная с рамкой), ghost — второстепенные (только текст),
// danger — необратимые (сдаться, удалить). Размеры: sm — в плотных панелях, md — по умолчанию, lg — главный призыв
// страницы. ButtonLink — то же оформление у ссылки маршрутизатора. Классы собирает buttonClasses — один источник.

import type {ButtonHTMLAttributes, ReactNode} from 'react';
import {Link} from 'react-router-dom';
import type {LinkProps} from 'react-router-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE = 'inline-flex items-center justify-center gap-1.5 rounded-md font-bold transition-colors cursor-pointer '
    + 'disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 '
    + 'focus-visible:outline-amber-300';

const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-amber-700 hover:bg-amber-600 text-white shadow-sm',
    secondary: 'bg-black/30 hover:bg-black/45 border border-amber-800/60 hover:border-amber-500 text-boxwood-light',
    ghost: 'text-amber-300 hover:text-amber-200 hover:bg-white/5',
    danger: 'bg-rose-900/70 hover:bg-rose-800 border border-rose-600/60 text-rose-50',
};

const SIZES: Record<ButtonSize, string> = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-1.5 text-sm',
    lg: 'px-5 py-2.5 text-base',
};

/** Классы кнопки — для мест, где нужен другой элемент с тем же видом (например, label). */
export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = ''): string {
    return [BASE, VARIANTS[variant], SIZES[size], extra].filter(Boolean).join(' ');
}

interface CommonProps {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Иконка перед текстом (lucide-react, размер подбирает вызывающий). */
    icon?: ReactNode;
    children?: ReactNode;
}

export function Button({variant = 'secondary', size = 'md', icon, children, className = '', type = 'button', ...rest}:
                           CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button type={type} className={buttonClasses(variant, size, className)} {...rest}>
            {icon}{children}
        </button>
    );
}

export function ButtonLink({variant = 'secondary', size = 'md', icon, children, className = '', ...rest}: CommonProps & LinkProps) {
    return (
        <Link className={buttonClasses(variant, size, className)} {...rest}>
            {icon}{children}
        </Link>
    );
}
