// --- FILE: frontend/src/components/puzzles/puzzleModes.ts ---
// Режимы страницы задач и их группы (дизайн страницы задач, план владельца 18.11). Восемь режимов раньше стояли
// одинаковыми кнопками в одной сетке; теперь они разложены по смыслу:
//   solve  — «Решать»: задачи базы по рейтингу, задача дня, забег на время;
//   train  — «Тренироваться»: путь по приёмам, упражнения-генераторы, защита, «Спасите партию»;
//   review — «Свои партии»: «Мои ошибки», позиции из собственных партий игрока.
// Новый режим — строка в MODE_GROUPS и иконка в MODE_ICONS; подписи берутся из puzzles.modes.*, пояснения — из
// puzzles.modeInfo.*, названия групп — из puzzles.modeGroups.* (три языка).

import type {LucideIcon} from 'lucide-react';
import {BookOpen, CalendarDays, Dumbbell, Handshake, History, Shield, Target, Timer} from 'lucide-react';

export type Mode = 'rated' | 'themes' | 'defense' | 'save' | 'drills' | 'personal' | 'daily' | 'timed';
export type ModeGroupId = 'solve' | 'train' | 'review';

export const MODE_GROUPS: { id: ModeGroupId; modes: Mode[] }[] = [
    {id: 'solve', modes: ['rated', 'daily', 'timed']},
    {id: 'train', modes: ['themes', 'drills', 'defense', 'save']},
    {id: 'review', modes: ['personal']},
];

/** Все режимы в порядке групп: проверка перехода на страницу с готовым режимом (ежедневная разминка). */
export const MODES: Mode[] = MODE_GROUPS.flatMap((group) => group.modes);

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
