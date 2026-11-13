// --- FILE: frontend/src/components/tournaments/Diploma.tsx ---
// Диплом призёра турнира (таск 15.3): собственное оформление в SVG на клиенте, сохранение в PNG и печать.

import {useRef} from 'react';
import {useI18n} from '../../i18n';

export interface DiplomaProps {
    name: string;
    place: number;
    format: string;
    size: number;
    date: string;
}

const MEDAL = ['#d4a017', '#a8a9ad', '#b0703c'];

/** Разметка SVG диплома как строка — для сохранения в PNG и печати. */
function svgMarkup(svg: SVGSVGElement): string {
    return new XMLSerializer().serializeToString(svg);
}

export function Diploma({name, place, format, size, date}: DiplomaProps) {
    const {t} = useI18n();
    const svgRef = useRef<SVGSVGElement>(null);
    const medal = MEDAL[Math.min(place, 3) - 1];

    const savePng = () => {
        const svg = svgRef.current;
        if (!svg) return;
        const blob = new Blob([svgMarkup(svg)], {type: 'image/svg+xml;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 1600;
            canvas.height = 1131;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            const link = document.createElement('a');
            link.download = `michess-diploma-${place}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        };
        image.src = url;
    };

    const print = () => {
        const svg = svgRef.current;
        const win = window.open('', '_blank');
        if (!svg || !win) return;
        win.document.write(`<html><head><title>${t('tournaments.diploma.title')}</title>`
            + '<style>@page{size:landscape;margin:0}body{margin:0}svg{width:100vw;height:100vh}</style></head>'
            + `<body>${svgMarkup(svg)}</body></html>`);
        win.document.close();
        win.focus();
        win.print();
    };

    return (
        <div className="flex flex-col gap-2" data-testid="diploma">
            <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1414 1000" className="w-full rounded-md shadow-heavy"
                 role="img" aria-label={t('tournaments.diploma.title')}>
                <rect width="1414" height="1000" fill="#f5ead3"/>
                <rect x="30" y="30" width="1354" height="940" fill="none" stroke="#5b3a1e" strokeWidth="10"/>
                <rect x="55" y="55" width="1304" height="890" fill="none" stroke="#a9773f" strokeWidth="3"/>
                <text x="707" y="190" textAnchor="middle" fontFamily="Georgia, serif" fontSize="92" fill="#3b2412">
                    {t('tournaments.diploma.title')}
                </text>
                <text x="707" y="265" textAnchor="middle" fontFamily="Georgia, serif" fontSize="38" fill="#7a5230">
                    {t('tournaments.diploma.heading')}
                </text>
                <text x="707" y="390" textAnchor="middle" fontFamily="Georgia, serif" fontSize="34" fill="#5b3a1e" fontStyle="italic">
                    {t('tournaments.diploma.awarded')}
                </text>
                <text x="707" y="490" textAnchor="middle" fontFamily="Georgia, serif" fontSize="80" fontWeight="bold" fill="#2a1a0c">
                    {name}
                </text>
                <circle cx="707" cy="650" r="80" fill={medal} stroke="#5b3a1e" strokeWidth="4"/>
                <text x="707" y="680" textAnchor="middle" fontFamily="Georgia, serif" fontSize="90" fontWeight="bold" fill="#2a1a0c">
                    {place}
                </text>
                <text x="707" y="800" textAnchor="middle" fontFamily="Georgia, serif" fontSize="40" fill="#3b2412">
                    {t('tournaments.diploma.place', {place})}
                </text>
                <text x="707" y="870" textAnchor="middle" fontFamily="Georgia, serif" fontSize="28" fill="#7a5230">
                    {t('tournaments.diploma.event', {format, size, date})}
                </text>
                <text x="150" y="300" textAnchor="middle" fontSize="120" fill="#a9773f">♞</text>
                <text x="1264" y="300" textAnchor="middle" fontSize="120" fill="#a9773f">♛</text>
            </svg>
            <div className="flex gap-2">
                <button type="button" onClick={savePng}
                        className="px-3 py-1.5 rounded-md bg-amber-700 text-white font-bold hover:bg-amber-600 cursor-pointer">
                    {t('tournaments.diploma.save')}
                </button>
                <button type="button" onClick={print}
                        className="px-3 py-1.5 rounded-md bg-black/40 border border-amber-700/50 hover:bg-black/60 cursor-pointer">
                    {t('tournaments.diploma.print')}
                </button>
            </div>
        </div>
    );
}
