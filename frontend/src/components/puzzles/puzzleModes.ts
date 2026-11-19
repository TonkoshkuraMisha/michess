// --- FILE: frontend/src/components/puzzles/puzzleModes.ts ---
// Режимы страницы задач и их группы (дизайн страницы задач, план владельца 18.11). Восемь режимов раньше стояли
// одинаковыми кнопками в одной сетке; теперь они разложены по смыслу:
//   solve  — «Решать»: задачи базы по рейтингу, задача дня, забег на время;
//   train  — «Тренироваться»: путь по приёмам, упражнения-генераторы, защита, «Спасите партию»;
//   review — «Свои партии»: «Мои ошибки», позиции из собственных партий игрока.
// Новый режим — строка в MODE_GROUPS и иконка в MODE_ICONS; подписи берутся из puzzles.modes.*, пояснения — из
// puzzles.modeInfo.*, названия групп — из puzzles.modeGroups.* (три языка).
// Чистые данные без сети и состояния; используют PuzzlesPage.tsx и PuzzleModePicker.tsx.

import type {LucideIcon} from 'lucide-react';
import {BookOpen, CalendarDays, Dumbbell, Handshake, History, Shield, Target, Timer} from 'lucide-react';

/** Режимы страницы задач; значение попадает в ключи puzzles.modes.* и в data-testid кнопок. */
export type Mode = 'rated' | 'themes' | 'defense' | 'save' | 'drills' | 'personal' | 'daily' | 'timed';
/** Группа вкладок режимов (ключ puzzles.modeGroups.*). */
export type ModeGroupId = 'solve' | 'train' | 'review';

/** Группы режимов в порядке показа: порядок строк задаёт порядок вкладок и карточек. */
export const MODE_GROUPS: { id: ModeGroupId; modes: Mode[] }[] = [
    {id: 'solve', modes: ['rated', 'daily', 'timed']},
    {id: 'train', modes: ['themes', 'drills', 'defense', 'save']},
    {id: 'review', modes: ['personal']},
];

/** Все режимы в порядке групп: проверка перехода на страницу с готовым режимом (ежедневная разминка). */
export const MODES: Mode[] = MODE_GROUPS.flatMap((group) => group.modes);

/** Иконка каждого режима (lucide-react) для вкладок и карточек; запись обязательна для каждого Mode. */
export const MODE_ICONS: Record<Mode, LucideIcon> = {
    rated: Target,
    daily: CalendarDays,
    timed: Timer,
    themes: BookOpen,
    drills: Dumbbell,
    defense: Shield,
    save: Handshake,
    personal: History,
};
