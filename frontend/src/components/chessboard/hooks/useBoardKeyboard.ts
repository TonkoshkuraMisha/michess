// --- FILE: frontend/src/components/chessboard/hooks/useBoardKeyboard.ts ---
// Доска с клавиатуры (таск 26.3): клетки — кнопки, в порядок Tab входит одна клетка (keySquare: последняя, на которой
// был фокус, иначе левая верхняя на экране), стрелки переводят фокус по экрану (у перевёрнутой доски — тоже по экрану,
// stepSquare из services/a11y/speech.ts), Enter или пробел — то же, что щелчок по клетке. Подпись клетки («e4, белый
// конь») доска ставит сама — squareLabel. Общий для главной доски (Chessboard.tsx) и доски задач и тренажёров
// (puzzles/PuzzleBoard.tsx). Сети и данных нет.

import {useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';
import {stepSquare} from '../../../services/a11y/speech';

/**
 * Клавиатура доски: firstSquare — клетка, с которой начинается Tab, если фокуса на доске ещё не было; flipped — доска
 * перевёрнута; activate — действие Enter/пробела (как щелчок). Возвращает свойства клетки для разметки.
 */
export function useBoardKeyboard(firstSquare: string, flipped: boolean, activate: (square: string) => void) {
    const [focused, setFocused] = useState<string | null>(null);
    const refs = useRef<Record<string, HTMLElement | null>>({});
    const keySquare = focused ?? firstSquare;

    const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, square: string) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            activate(square);
            return;
        }
        if (!event.key.startsWith('Arrow')) return;
        event.preventDefault();
        event.stopPropagation();
        const next = stepSquare(square, event.key, flipped);
        setFocused(next);
        refs.current[next]?.focus();
    };

    /** Свойства клетки-кнопки: ссылка для фокуса, роль, место в порядке Tab и обработчики клавиш и фокуса. */
    const squareProps = (square: string) => ({
        ref: (element: HTMLElement | null) => {
            refs.current[square] = element;
        },
        role: 'button' as const,
        tabIndex: square === keySquare ? 0 : -1,
        onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => onKeyDown(event, square),
        onFocus: () => setFocused(square),
    });

    return {keySquare, squareProps};
}
