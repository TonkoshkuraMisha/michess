// --- FILE: frontend/src/services/moveNumbers.ts ---
// Запись ходов с номерами: «1. e4», «e5», «2. Nf3»… Если линия начинается из своей позиции (FEN), номер берётся из
// шестого поля FEN, а первый ход чёрных пишется «12… Kg7». Чистая функция, без сети.
// Используют редактор и тренажёр репертуара (repertoire/), шахматы Фишера (chess960/) и анализ на доске (tools/).

/** Ходы SAN с номерами; startFen — позиция, с которой начинается линия (по умолчанию — первый ход белых). */
export function numberedMoves(sans: string[], startFen?: string): string[] {
    const fields = startFen?.split(' ') ?? [];
    const firstBlack = fields[1] === 'b';
    const firstNumber = Number(fields[5] ?? 1) || 1;
    return sans.map((san, i) => {
        const ply = i + (firstBlack ? 1 : 0);
        const number = firstNumber + Math.floor(ply / 2);
        if (ply % 2 === 0) return `${number}. ${san}`;
        return i === 0 ? `${number}… ${san}` : san;
    });
}
