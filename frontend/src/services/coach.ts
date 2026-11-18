// --- FILE: frontend/src/services/coach.ts ---
// Комментарий наставника (src/services/coach.py): сервер присылает предложения ключами каталога coach и
// параметры (фигуры — фигурной нотацией, «♘f7»), стрелки и подсветку полей. Текст — на языке игрока.

import {hasMessage, renderUiMessage, uiMessage} from '../i18n';
import type {I18n, UiMessage} from '../i18n';

/** Вид стрелки: лучший ход, угроза соперника, идея (план). От вида зависит цвет стрелки на доске. */
export type CoachArrowKind = 'best' | 'threat' | 'idea';

/** Стрелка на доске: поля «откуда» и «куда» в записи вида «e2», «e4». */
export interface CoachArrow {
    from: string;
    to: string;
    kind: CoachArrowKind;
}

/** Подсвеченное поле. Вид (сервер шлёт target и piece) клиент не различает: coachHighlights берёт только поля. */
export interface CoachHighlight {
    square: string;
    kind: string;
}

/** Комментарий наставника в ответе сервера: поле coach у хода разбора партии и в ответе проверки хода. */
export interface CoachComment {
    /** Предложения по порядку: ключ каталога coach.* и параметры шаблона. */
    comment: { key: string; params?: Record<string, string | number> }[];
    arrows?: CoachArrow[];
    highlights?: CoachHighlight[];
}

const SQUARE = /^[a-h][1-8]$/;
const ARROW_KINDS: ReadonlySet<string> = new Set(['best', 'threat', 'idea']);

/** Предложения комментария; незнакомые ключи (сервер новее клиента) пропускаются. */
export function coachSentences(coach: CoachComment | null | undefined): UiMessage[] {
    if (!coach || !Array.isArray(coach.comment)) return [];
    const sentences: UiMessage[] = [];
    for (const sentence of coach.comment) {
        if (!sentence || typeof sentence.key !== 'string' || !hasMessage(sentence.key)) continue;
        const params: Record<string, string | number> = {};
        for (const [name, value] of Object.entries(sentence.params ?? {})) {
            if (typeof value === 'string' || typeof value === 'number') params[name] = value;
        }
        sentences.push(uiMessage(sentence.key, params));
    }
    return sentences;
}

/** Текст комментария целиком: предложения через пробел. */
export function coachText(coach: CoachComment | null | undefined, t: I18n['t']): string {
    return coachSentences(coach).map((sentence) => renderUiMessage(sentence, t)).join(' ');
}

/** Стрелки комментария, только корректные (поля доски и известный вид). */
export function coachArrows(coach: CoachComment | null | undefined): CoachArrow[] {
    return (coach?.arrows ?? []).filter(
        (arrow) => SQUARE.test(arrow.from) && SQUARE.test(arrow.to) && ARROW_KINDS.has(arrow.kind),
    );
}

/** Поля, которые комментарий просит подсветить (только корректные поля доски). */
export function coachHighlights(coach: CoachComment | null | undefined): Set<string> {
    return new Set((coach?.highlights ?? []).map((h) => h.square).filter((square) => SQUARE.test(square)));
}
