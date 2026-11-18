// --- FILE: frontend/src/components/chessboard/BoardSpeech.tsx ---
// Доступность доски (таск 26.3): последний ход объявляется словами в живой области (aria-live) — программа чтения
// экрана произносит каждый ход, свой и соперника; кнопка «Позиция словами» показывает расстановку текстом. Слова —
// services/a11y/speech.ts. В игре вслепую (blind) описание позиции недоступно: оно раскрыло бы скрытые фигуры, а ходы
// объявляются — их и так называют вслух при игре вслепую.

import {useState} from 'react';
import {Volume2} from 'lucide-react';
import {useI18n} from '../../i18n';
import {moveWords, positionWords} from '../../services/a11y/speech';
import type {BoardPiece, Translate, VerboseMove} from '../../services/a11y/speech';

interface Props {
    /** Последний ход партии (chess.js verbose); null — ходов ещё нет. */
    lastMove: VerboseMove | null;
    /** Показываемая позиция (chess.js board()). */
    board: (BoardPiece | null)[][];
    /** Идёт игра вслепую: позицию словами не показывать. */
    blind: boolean;
}

export function BoardSpeech({lastMove, board, blind}: Props) {
    const {t} = useI18n();
    const tr = t as Translate;
    const [open, setOpen] = useState(false);
    return (
        <div className="w-full flex flex-col items-start gap-1 text-xs">
            <p className="sr-only" aria-live="polite" data-testid="move-announcer">{lastMove ? moveWords(lastMove, tr) : ''}</p>
            <button type="button" onClick={() => setOpen((v) => !v)} disabled={blind} aria-expanded={open && !blind}
                    data-testid="describe-position"
                    className="flex items-center gap-1 text-amber-300/80 hover:text-amber-200 disabled:opacity-40 cursor-pointer disabled:cursor-default">
                <Volume2 size={13} aria-hidden/> {t(open && !blind ? 'a11y.describeHide' : 'a11y.describe')}
            </button>
            {open && !blind && (
                <p className="text-boxwood-light/90 leading-snug" data-testid="position-words">{positionWords(board, tr)}</p>
            )}
        </div>
    );
}
