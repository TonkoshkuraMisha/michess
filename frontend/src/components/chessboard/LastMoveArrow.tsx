// --- FILE: frontend/src/components/chessboard/LastMoveArrow.tsx ---
// Стрелка последнего хода (таск 18.4, настройка «показ хода соперника»): полупрозрачная, под фигурами-подсказками.

import {squareCenter} from './CoachArrowsOverlay';

export function LastMoveArrow({from, to, flipped}: { from: string; to: string; flipped: boolean }) {
    const a = squareCenter(from, flipped);
    const b = squareCenter(to, flipped);
    if (!a || !b) return null;
    // Наконечник не заходит на центр поля — фигура остаётся видна.
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const end = {x: b.x - ((b.x - a.x) / len) * 3, y: b.y - ((b.y - a.y) / len) * 3};
    return (
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full z-[25] pointer-events-none" data-testid="last-move-arrow">
            <defs>
                <marker id="last-move-head" markerWidth="3.5" markerHeight="3.5" refX="2.3" refY="1.75" orient="auto">
                    <polygon points="0 0, 3.5 1.75, 0 3.5" fill="rgba(245, 158, 11, 0.85)"/>
                </marker>
            </defs>
            <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke="rgba(245, 158, 11, 0.75)" strokeWidth="2.2" strokeLinecap="round"
                  markerEnd="url(#last-move-head)"/>
        </svg>
    );
}
