// --- FILE: frontend/src/content/lessons/format.ts ---
// Формат урока школы (таск 14.1). Урок — JSON-файл в этой папке: тексты на трёх языках, позиции и ходы.
// Проверка контента — validateLesson (её гоняет тест в CI: все ходы легальны, у каждого вопроса есть верный
// ответ, тексты на всех языках); ответы на шахматные вопросы сверяет движком офлайн-скрипт
// scripts/verify_lessons.py.
//
// Шаги урока:
//  * text      — позиция и объяснение; стрелки, подсветка полей, «призрачная» фигура;
//  * demo      — показ: последовательность действий на доске (ход-скольжение, стрелка, подсветка, появление фигуры,
//                «призрак», пауза), синхронная с текстом;
//  * find_move — «найдите ход»: верные ответы, свой отклик на каждый ожидаемый неверный ход, ответ компьютера и
//                «сыграйте продолжение» (линия из нескольких ходов игрока);
//  * choice    — вопрос с выбором ответа и откликом на каждый вариант.
// После шагов — экзамен: 1–5 контрольных вопросов (find_move или choice), считается верное с первой попытки.

import type {Language} from '../../i18n';

export type LocalizedText = Record<Language, string>;

export type ArrowColor = 'green' | 'red' | 'blue' | 'yellow';

export interface Arrow {
    from: string;
    to: string;
    color?: ArrowColor;
}

/** Фигура в формате цвет + тип: «wN», «bq»… (регистр типа не важен). */
export type PieceCode = string;

export interface Ghost {
    square: string;
    piece: PieceCode;
}

export type DemoAction =
    | { do: 'move'; uci: string }
    | { do: 'arrow'; from: string; to: string; color?: ArrowColor }
    | { do: 'highlight'; squares: string[] }
    | { do: 'ghost'; square: string; piece: PieceCode }
    | { do: 'place'; square: string; piece: PieceCode }
    | { do: 'clear' }
    | { do: 'pause'; ms: number };

interface BoardDecor {
    arrows?: Arrow[];
    highlights?: string[];
    ghost?: Ghost;
    orientation?: 'white' | 'black';
}

export interface TextStep extends BoardDecor {
    type: 'text';
    fen: string;
    text: LocalizedText;
}

export interface DemoStep extends BoardDecor {
    type: 'demo';
    fen: string;
    text: LocalizedText;
    actions: DemoAction[];
}

/** Один ход игрока в линии вопроса: верные ответы, отклики на неверные, ответ компьютера. */
export interface MoveTask {
    answers: string[];
    /** Ход компьютера после верного ответа (uci). */
    reply?: string;
    /** Свой отклик на ожидаемый неверный ход (uci → текст). */
    wrong?: Record<string, LocalizedText>;
    /** Отклик на верный ход. */
    correct?: LocalizedText;
}

export interface FindMoveStep extends BoardDecor {
    type: 'find_move';
    fen: string;
    text: LocalizedText;
    hint?: LocalizedText;
    line: MoveTask[];
}

export interface ChoiceOption {
    text: LocalizedText;
    correct?: boolean;
    feedback?: LocalizedText;
}

export interface ChoiceStep extends BoardDecor {
    type: 'choice';
    fen?: string;
    text: LocalizedText;
    options: ChoiceOption[];
}

export type QuestionStep = FindMoveStep | ChoiceStep;
export type Step = TextStep | DemoStep | QuestionStep;

export interface Lesson {
    id: string;
    course: string;
    /** Порядок урока в курсе. */
    order: number;
    title: LocalizedText;
    summary: LocalizedText;
    steps: Step[];
    exam: QuestionStep[];
}

export interface CourseInfo {
    id: string;
    order: number;
    title: LocalizedText;
    summary: LocalizedText;
}

export const MAX_EXAM_QUESTIONS = 5;
