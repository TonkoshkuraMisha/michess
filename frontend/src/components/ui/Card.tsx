// --- FILE: frontend/src/components/ui/Card.tsx ---
// Карточка (общие компоненты дизайна, план владельца 18.11) — одна форма для разделов школы, турниров, режимов задач:
// иконка, название, короткое описание, метка состояния, прогресс и действие внизу. Виды: default — обычная,
// muted — второстепенная (закрытый турнир, «скоро»), hero — главная на странице (например, «Большой курс»).
// С to карточка целиком — ссылка; с onClick — кнопка; иначе — просто блок (тогда действия передаются в footer).
// CardGrid — сетка карточек: одна колонка на телефоне, две на планшете, три на широком экране (или две — cols=2).

import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';

export type CardVariant = 'default' | 'muted' | 'hero';

const VARIANTS: Record<CardVariant, string> = {
    default: 'bg-acacia/80 border-acacia-light/60',
    muted: 'bg-black/25 border-amber-900/40 opacity-80',
    hero: 'bg-gradient-to-br from-amber-900/60 to-acacia border-amber-500/80',
};
const INTERACTIVE = 'hover:border-amber-400 hover:-translate-y-px transition focus-visible:outline-2 focus-visible:outline-amber-300';

interface CardProps {
    title: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    /** Метка в правом верхнем углу (Badge): «пройдено», «новое», «закрыто». */
    badge?: ReactNode;
    /** Нижняя часть: прогресс, кнопки. */
    footer?: ReactNode;
    variant?: CardVariant;
    to?: string;
    onClick?: () => void;
    testId?: string;
    children?: ReactNode;
}

export function Card({title, description, icon, badge, footer, variant = 'default', to, onClick, testId, children}: CardProps) {
    const body = (
        <>
            <div className="flex items-start gap-3">
                {icon && (
                    <span className={`shrink-0 rounded-md p-2 ${variant === 'hero' ? 'bg-amber-500/20 text-amber-200' : 'bg-black/25 text-amber-300'}`}
                          aria-hidden>{icon}</span>
                )}
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className={`font-bold leading-snug min-w-0 break-words ${variant === 'hero' ? 'text-lg text-amber-100' : 'text-amber-200'}`}>
                            {title}
                        </h3>
                        {badge && <span className="shrink-0">{badge}</span>}
                    </div>
                    {description && <p className="text-sm text-boxwood/80 leading-snug">{description}</p>}
                </div>
            </div>
            {children}
            {footer && <div className="mt-auto pt-1 flex flex-wrap items-center gap-2">{footer}</div>}
        </>
    );
    const classes = `rounded-lg border p-4 flex flex-col gap-3 text-left text-boxwood-light ${VARIANTS[variant]}`;
    if (to) {
        return <Link to={to} data-testid={testId} className={`${classes} ${INTERACTIVE}`}>{body}</Link>;
    }
    if (onClick) {
        return <button type="button" onClick={onClick} data-testid={testId} className={`${classes} ${INTERACTIVE} cursor-pointer`}>{body}</button>;
    }
    return <div data-testid={testId} className={classes}>{body}</div>;
}

/** Сетка карточек: 1 / 2 / 3 колонки по ширине экрана (cols=2 — не больше двух). */
export function CardGrid({children, cols = 3}: { children: ReactNode; cols?: 2 | 3 }) {
    return <div className={`grid gap-3 sm:grid-cols-2 ${cols === 3 ? 'lg:grid-cols-3' : ''}`}>{children}</div>;
}
