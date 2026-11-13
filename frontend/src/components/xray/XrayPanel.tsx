// --- FILE: frontend/src/components/xray/XrayPanel.tsx ---
// Панель «рентгена» (таск 12.1): режимы включаются по отдельности, «за соперника» — те же подсказки для другой
// стороны. Под каждым режимом — как он выглядит на доске (не только цвет).

import {ScanEye} from 'lucide-react';
import {useI18n} from '../../i18n';
import {XRAY_MODES} from './useXraySettings';
import type {XraySettings} from './useXraySettings';

interface Props {
    settings: XraySettings;
    /** Режим «безопасные поля» имеет смысл, только когда на доске можно выбрать фигуру. */
    canSelect?: boolean;
}

export function XrayPanel({settings, canSelect = true}: Props) {
    const {t} = useI18n();
    const modes = XRAY_MODES.filter((mode) => mode !== 'safety' || canSelect);
    return (
        <section aria-label={t('xray.title')} data-testid="xray-panel"
                 className="bg-acacia-dark p-2.5 rounded-md border border-amber-700/40 text-xs text-boxwood-light flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-bold text-amber-400"><ScanEye size={14}/> {t('xray.title')}</span>
                <label className="flex items-center gap-1 cursor-pointer" title={t('xray.forOpponentHint')}>
                    <input type="checkbox" className="accent-amber-600" data-testid="xray-for-opponent"
                           checked={settings.forOpponent} onChange={(e) => settings.setForOpponent(e.target.checked)}/>
                    {t('xray.forOpponent')}
                </label>
            </div>
            <div className="grid grid-cols-1 gap-0.5">
                {modes.map((mode) => (
                    <label key={mode} className="flex items-start gap-1.5 cursor-pointer" title={t(`xray.modes.${mode}.legend`)}>
                        <input type="checkbox" className="accent-amber-600 mt-0.5" data-testid={`xray-mode-${mode}`}
                               checked={settings.modes.has(mode)} onChange={() => settings.toggle(mode)}/>
                        <span>
                            {t(`xray.modes.${mode}.name`)}
                            {settings.modes.has(mode) && (
                                <span className="block text-[10px] text-boxwood/60">{t(`xray.modes.${mode}.legend`)}</span>
                            )}
                        </span>
                    </label>
                ))}
            </div>
        </section>
    );
}
