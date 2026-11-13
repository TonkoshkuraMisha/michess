// --- FILE: frontend/src/components/chessboard/CoachArrowsOverlay.tsx ---
// Стрелки наставника поверх доски: зелёная — лучший ход, красная — угроза соперника, синяя — идея хода.

import type {CoachArrow, CoachArrowKind} from '../../services/coach';

export const COACH_ARROW_COLORS: Record<CoachArrowKind, string> = {
    best: 'rgba(16, 185, 129, 0.88)',
    threat: 'rgba(244, 63, 94, 0.88)',
    idea: 'rgba(56, 189, 248, 0.88)',
};

/** Центр поля в координатах 0..100 с учётом переворота доски; null — не поле. */
export function squareCenter(square: string, flipped: boolean): { x: number; y: number } | null {
    if (!/^[a-h][1-8]$/.test(square)) return null;
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const col = flipped ? 7 - file : file;
    const row = flipped ? rank - 1 : 8 - rank;
    return {x: col * 12.5 + 6.25, y: row * 12.5 + 6.25};
}

interface Props {
    arrows: CoachArrow[];
    flipped: boolean;
    /** Префикс id маркеров: на странице может быть несколько досок. */
    idPrefix?: string;
}

export function CoachArrowsOverlay({arrows, flipped, idPrefix = 'coach'}: Props) {
    if (arrows.length === 0) return null;
    return (
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full z-30 pointer-events-none"
             data-testid="coach-arrows">
            <defs>
                {(Object.keys(COACH_ARROW_COLORS) as CoachArrowKind[]).map((kind) => (
                    <marker key={kind} id={`${idPrefix}-arrowhead-${kind}`} markerWidth="3.5" markerHeight="3.5"
                            refX="2.3" refY="1.75" orient="auto">
                        <polygon points="0 0, 3.5 1.75, 0 3.5" fill={COACH_ARROW_COLORS[kind]}/>
                    </marker>
                ))}
            </defs>
            {arrows.map((arrow, idx) => {
                const start = squareCenter(arrow.from, flipped);
                const end = squareCenter(arrow.to, flipped);
                if (!start || !end) return null;
                return (
                    <line key={`${arrow.kind}-${arrow.from}-${arrow.to}-${idx}`}
                          data-testid={`coach-arrow-${arrow.kind}`}
                          x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                          stroke={COACH_ARROW_COLORS[arrow.kind]} strokeWidth="2.1" strokeLinecap="round"
                          markerEnd={`url(#${idPrefix}-arrowhead-${arrow.kind})`}/>
                );
            })}
        </svg>
    );
}
