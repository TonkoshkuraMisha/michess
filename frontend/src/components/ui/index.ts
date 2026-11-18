// --- FILE: frontend/src/components/ui/index.ts ---
// Общие компоненты дизайна Regence (план владельца 18.11): каркас страницы, карточки, кнопки, метки, прогресс,
// вкладки, пустое состояние. Правила применения — docs/design-system.md; витрина — страница /design.

export {Page, PageHeader, Section} from './Page';
export type {PageWidth} from './Page';
export {Card, CardGrid} from './Card';
export type {CardVariant} from './Card';
export {Button, ButtonLink, buttonClasses} from './Button';
export type {ButtonSize, ButtonVariant} from './Button';
export {Badge, EmptyState, ProgressBar} from './Indicators';
export type {BadgeTone} from './Indicators';
export {SegmentedControl} from './SegmentedControl';
export type {SegmentOption} from './SegmentedControl';
