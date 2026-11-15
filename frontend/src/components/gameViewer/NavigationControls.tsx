// --- FILE: frontend/src/components/gameViewer/NavigationControls.tsx ---
// Кнопки перехода по партии и переворот доски (вынесено из GameViewer.tsx, таск 17.6).

import {ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, RefreshCw} from 'lucide-react';
import type {ReactNode} from 'react';
import {useI18n} from '../../i18n';

const BUTTON = 'p-1.5 bg-acacia rounded hover:bg-boxwood hover:text-acacia-dark transition cursor-pointer';

function NavButton({label, onClick, children, className = ''}: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
    return (
        <button onClick={onClick} className={`${BUTTON} ${className}`} title={label} aria-label={label}>
            {children}
        </button>
    );
}

/** viewIndex — показанный полуход (-1 — начальная позиция); onGo вызывается только при смене хода. */
export function NavigationControls({viewIndex, total, onGo, onFlip}: {
    viewIndex: number; total: number; onGo: (index: number) => void; onFlip: () => void;
}) {
    const {t} = useI18n();
    const go = (index: number) => {
        if (index !== viewIndex) onGo(index);
    };
    return (
        <div className="flex justify-between items-center bg-acacia-dark p-2 rounded-md border border-amber-900/40">
            <span className="text-xs font-semibold text-boxwood/80 pl-1">{t('viewer.controls')}</span>
            <div className="flex gap-1 items-center">
                <NavButton label={t('viewer.gameStart')} onClick={() => go(-1)}><ChevronFirst size={17}/></NavButton>
                <NavButton label={t('viewer.moveBack')} onClick={() => go(Math.max(-1, viewIndex - 1))}><ChevronLeft size={17}/></NavButton>
                <NavButton label={t('viewer.moveForward')} onClick={() => go(Math.min(total - 1, viewIndex + 1))}><ChevronRight size={17}/></NavButton>
                <NavButton label={t('viewer.gameEnd')} onClick={() => go(total - 1)}><ChevronLast size={17}/></NavButton>
                <div className="w-px h-4 bg-amber-900/50 mx-1"/>
                <NavButton label={t('common.flipBoard')} onClick={onFlip} className="text-amber-400"><RefreshCw size={15}/></NavButton>
            </div>
        </div>
    );
}
