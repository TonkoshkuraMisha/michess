// --- FILE: frontend/src/components/xray/useXraySettings.ts ---
// Настройки «рентгена» (таск 12.1): какие режимы включены и за какую сторону смотреть. Режимы запоминаются.

import {useCallback, useState} from 'react';

export type XrayMode =
    | 'control' | 'hanging' | 'lines' | 'captures' | 'defenses' | 'checks' | 'moves' | 'pawns' | 'safety';

export const XRAY_MODES: readonly XrayMode[] = [
    'control', 'hanging', 'lines', 'captures', 'defenses', 'checks', 'moves', 'pawns', 'safety',
];

const STORAGE_KEY = 'michess_xray_modes';

function readModes(): Set<XrayMode> {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        return new Set((Array.isArray(raw) ? raw : []).filter((m): m is XrayMode => XRAY_MODES.includes(m)));
    } catch {
        return new Set();
    }
}

export interface XraySettings {
    modes: Set<XrayMode>;
    toggle: (mode: XrayMode) => void;
    /** Показать те же подсказки за соперника: «что он мне ответит?». */
    forOpponent: boolean;
    setForOpponent: (value: boolean) => void;
}

export function useXraySettings(): XraySettings {
    const [modes, setModes] = useState<Set<XrayMode>>(readModes);
    const [forOpponent, setForOpponent] = useState(false);
    const toggle = useCallback((mode: XrayMode) => {
        setModes((current) => {
            const next = new Set(current);
            if (next.has(mode)) next.delete(mode);
            else next.add(mode);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
            } catch {
                // приватный режим — настройка не запомнится
            }
            return next;
        });
    }, []);
    return {modes, toggle, forOpponent, setForOpponent};
}
