// --- FILE: frontend/src/components/xray/XrayOverlay.tsx ---
// Слой «рентгена» поверх доски (таск 12.1). Каждый режим отличается не только цветом: контроль — штриховкой и числом
// перевеса, фигуры под ударом — треугольником, перегрузка — пунктиром к обязанностям, связки — пунктирной линией и
// кольцом, взятия — толщиной стрелки, мат — двойной обводкой, пешки — буквенными значками.

import {useMemo} from 'react';
import {squareCenter} from '../chessboard/CoachArrowsOverlay';
import {destinationSafety, xrayFor} from '../../services/xray/xrayUtils';
import type {Color} from '../../services/xray/xrayUtils';
import type {XrayMode} from './useXraySettings';

interface Props {
    fen: string;
    /** За какую сторону смотреть. */
    side: Color;
    modes: Set<XrayMode>;
    flipped: boolean;
    /** Выбранная фигура — для безопасных и опасных полей. */
    selectedSquare?: string | null;
}

const COLORS = {
    white: 'rgba(56, 189, 248, 0.32)',
    black: 'rgba(244, 63, 94, 0.30)',
    capture: 'rgba(239, 68, 68, 0.9)',
    defense: 'rgba(34, 197, 94, 0.85)',
    check: 'rgba(168, 85, 247, 0.9)',
    move: 'rgba(59, 130, 246, 0.55)',
    line: 'rgba(249, 115, 22, 0.95)',
    hanging: 'rgba(250, 204, 21, 0.95)',
};

const SQUARE = 12.5;

interface ArrowProps {
    from: string;
    to: string;
    flipped: boolean;
    color: string;
    width: number;
    marker: string;
    dashed?: boolean;
    testId?: string;
}

function Arrow({from, to, flipped, color, width, marker, dashed, testId}: ArrowProps) {
    const start = squareCenter(from, flipped);
    const end = squareCenter(to, flipped);
    if (!start || !end) return null;
    return (
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={width} strokeLinecap="round"
              strokeDasharray={dashed ? '1.6 1.2' : undefined} markerEnd={`url(#${marker})`} data-testid={testId}/>
    );
}

export function XrayOverlay({fen, side, modes, flipped, selectedSquare}: Props) {
    const report = useMemo(() => (modes.size > 0 ? xrayFor(fen, side) : null), [fen, side, modes.size]);
    const safety = useMemo(
        () => (modes.has('safety') && selectedSquare ? destinationSafety(fen, selectedSquare) : []),
        [fen, modes, selectedSquare],
    );
    if (!report) return null;
    const corner = (square: string) => {
        const center = squareCenter(square, flipped);
        return center ? {x: center.x - SQUARE / 2, y: center.y - SQUARE / 2} : null;
    };

    return (
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full z-20 pointer-events-none"
             data-testid="xray-overlay">
            <defs>
                <pattern id="xray-hatch-white" width="2.2" height="2.2" patternUnits="userSpaceOnUse"
                         patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="2.2" stroke="rgba(14, 116, 144, 0.55)" strokeWidth="0.7"/>
                </pattern>
                <pattern id="xray-hatch-black" width="2.2" height="2.2" patternUnits="userSpaceOnUse">
                    <circle cx="1.1" cy="1.1" r="0.45" fill="rgba(159, 18, 57, 0.6)"/>
                </pattern>
                {Object.entries(COLORS).map(([name, color]) => (
                    <marker key={name} id={`xray-head-${name}`} markerWidth="3.5" markerHeight="3.5" refX="2.3"
                            refY="1.75" orient="auto">
                        <polygon points="0 0, 3.5 1.75, 0 3.5" fill={color}/>
                    </marker>
                ))}
            </defs>

            {modes.has('control') && [...report.control.entries()].map(([square, c]) => {
                const balance = c.white - c.black;
                const at = corner(square);
                if (!at || (c.white === 0 && c.black === 0)) return null;
                const owner = balance > 0 ? 'white' : balance < 0 ? 'black' : null;
                const intensity = Math.min(1, 0.35 + Math.abs(balance) * 0.22);
                return (
                    <g key={`ctl-${square}`} data-testid={`xray-control-${square}`}>
                        {owner && (
                            <>
                                <rect x={at.x} y={at.y} width={SQUARE} height={SQUARE} fill={COLORS[owner]}
                                      opacity={intensity}/>
                                <rect x={at.x} y={at.y} width={SQUARE} height={SQUARE}
                                      fill={`url(#xray-hatch-${owner})`} opacity={intensity}/>
                            </>
                        )}
                        <text x={at.x + 0.8} y={at.y + 3} fontSize="2.6" fontWeight="bold"
                              fill={owner === 'black' ? '#881337' : owner === 'white' ? '#0c4a6e' : '#44403c'}>
                            {balance > 0 ? `+${balance}` : balance < 0 ? `−${-balance}` : '='}
                        </text>
                    </g>
                );
            })}

            {modes.has('moves') && report.moves.map((m) => (
                <Arrow key={`mv-${m.from}-${m.to}`} {...m} flipped={flipped} color={COLORS.move} width={0.8}
                       marker="xray-head-move"/>
            ))}
            {modes.has('defenses') && report.defenses.map((m) => (
                <Arrow key={`df-${m.from}-${m.to}`} {...m} flipped={flipped} color={COLORS.defense} width={0.9}
                       marker="xray-head-defense" dashed testId="xray-defense"/>
            ))}
            {modes.has('captures') && report.captures.map((m) => (
                <Arrow key={`cp-${m.from}-${m.to}`} {...m} flipped={flipped} color={COLORS.capture}
                       width={m.kind === 'winning' ? 2.4 : 0.9} marker="xray-head-capture"
                       testId={`xray-capture-${m.kind}`}/>
            ))}
            {modes.has('checks') && report.checks.map((m) => (
                <g key={`ck-${m.from}-${m.to}`}>
                    <Arrow {...m} flipped={flipped} color={COLORS.check} width={m.mate ? 2.2 : 1.2}
                           marker="xray-head-check" testId={m.mate ? 'xray-mate' : 'xray-check'}/>
                    {m.mate && (() => {
                        const at = corner(m.to);
                        return at && <rect x={at.x + 0.6} y={at.y + 0.6} width={SQUARE - 1.2} height={SQUARE - 1.2}
                                           fill="none" stroke={COLORS.check} strokeWidth="0.7" strokeDasharray="0.8 0.6"/>;
                    })()}
                </g>
            ))}

            {modes.has('lines') && report.lines.map((line) => {
                const ring = squareCenter(line.front, flipped);
                return (
                    <g key={`ln-${line.attacker}-${line.front}`} data-testid={`xray-${line.kind}`}>
                        <Arrow from={line.attacker} to={line.behind} flipped={flipped} color={COLORS.line} width={1.1}
                               marker="xray-head-line" dashed/>
                        {ring && <circle cx={ring.x} cy={ring.y} r="5" fill="none" stroke={COLORS.line}
                                         strokeWidth={line.absolute ? 1.4 : 0.8}/>}
                    </g>
                );
            })}

            {modes.has('hanging') && report.hanging.map((square) => {
                const at = corner(square);
                return at && (
                    <polygon key={`hg-${square}`} data-testid={`xray-hanging-${square}`}
                             points={`${at.x + SQUARE - 4.2},${at.y + 4} ${at.x + SQUARE - 0.6},${at.y + 4} ${at.x + SQUARE - 2.4},${at.y + 0.6}`}
                             fill={COLORS.hanging} stroke="#451a03" strokeWidth="0.3"/>
                );
            })}
            {modes.has('hanging') && report.overloaded.map((o) => (
                <g key={`ov-${o.defender}`} data-testid={`xray-overloaded-${o.defender}`}>
                    {o.duties.map((duty) => (
                        <Arrow key={duty} from={o.defender} to={duty} flipped={flipped} color={COLORS.hanging}
                               width={0.7} marker="xray-head-hanging" dashed/>
                    ))}
                </g>
            ))}

            {modes.has('pawns') && [
                ...report.pawns.isolated.map((square) => ({square, kind: 'isolated', label: 'i', color: '#c2410c', dx: 2.2})),
                ...report.pawns.passed.map((square) => ({square, kind: 'passed', label: '↑', color: '#15803d', dx: SQUARE - 2.2})),
            ].map(({square, kind, label, color, dx}) => {
                const at = corner(square);
                return at && (
                    <g key={`pw-${square}-${kind}`} data-testid={`xray-pawn-${kind}-${square}`}>
                        <circle cx={at.x + dx} cy={at.y + SQUARE - 2.2} r="1.8" fill={color}/>
                        <text x={at.x + dx} y={at.y + SQUARE - 1.3} fontSize="2.6" fontWeight="bold" fill="#fff"
                              textAnchor="middle">{label}</text>
                    </g>
                );
            })}

            {safety.map(({square, safe}) => {
                const center = squareCenter(square, flipped);
                if (!center) return null;
                return safe ? (
                    <circle key={`sf-${square}`} data-testid={`xray-safe-${square}`} cx={center.x} cy={center.y} r="2"
                            fill="rgba(34, 197, 94, 0.85)"/>
                ) : (
                    <g key={`sf-${square}`} data-testid={`xray-danger-${square}`} stroke="rgba(220, 38, 38, 0.95)"
                       strokeWidth="1.1" strokeLinecap="round">
                        <line x1={center.x - 2} y1={center.y - 2} x2={center.x + 2} y2={center.y + 2}/>
                        <line x1={center.x + 2} y1={center.y - 2} x2={center.x - 2} y2={center.y + 2}/>
                    </g>
                );
            })}
        </svg>
    );
}
