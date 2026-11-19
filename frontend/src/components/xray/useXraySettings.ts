// --- FILE: frontend/src/components/xray/useXraySettings.ts ---
// Настройки «рентгена» (таск 12.1): какие режимы включены и за какую сторону смотреть. Режимы запоминаются в
// localStorage (ключ regence_xray_modes), «за соперника» — нет: сбрасывается при новой загрузке страницы.
// Хук подключают Chessboard.tsx, GameViewer.tsx и chessboard/AuxBoard.tsx; рисуют XrayPanel и XrayOverlay.

import {useCallback, useState} from 'react';

/** Режим «рентгена»; ключ xray.modes.<режим>.name/legend в трёх каталогах и поле отчёта xrayFor. */
export type XrayMode =
    | 'control' | 'hanging' | 'lines' | 'captures' | 'defenses' | 'checks' | 'moves' | 'pawns' | 'safety';

/** Все режимы в порядке показа в панели; значения из localStorage, которых здесь нет, отбрасываются. */
export const XRAY_MODES: readonly XrayMode[] = [
    'control', 'hanging', 'lines', 'captures', 'defenses', 'checks', 'moves', 'pawns', 'safety',
];

/** Ключ localStorage со списком включённых режимов (JSON-массив). */
const STORAGE_KEY = 'regence_xray_modes';

/** Прочитать запомненные режимы; повреждённое значение или недоступное хранилище — пустое множество. */
function readModes(): Set<XrayMode> {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        return new Set((Array.isArray(raw) ? raw : []).filter((m): m is XrayMode => XRAY_MODES.includes(m)));
    } catch {
        return new Set();
    }
}

/** Состояние и действия настроек «рентгена». */
export interface XraySettings {
    /** Включённые режимы. */
    modes: Set<XrayMode>;
    /** Включить или выключить режим и сохранить выбор. */
    toggle: (mode: XrayMode) => void;
    /** Показать те же подсказки за соперника: «что он мне ответит?». */
    forOpponent: boolean;
    setForOpponent: (value: boolean) => void;
}

/** Хук настроек «рентгена»: режимы читаются из localStorage один раз при создании. */
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
