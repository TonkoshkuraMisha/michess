// Настройки → «Приложение» (таск 24.2): установить сайт на главный экран. Кнопка — где браузер разрешает установку
// (Chrome, Edge, Android); на iPhone и iPad — подсказка, как добавить вручную; уже установлено — так и пишем.

import {Smartphone} from 'lucide-react';
import {useI18n} from '../../i18n';
import {promptInstall, useInstallState} from '../../services/pwa';

export function InstallAppSection({sectionClass, headingClass}: { sectionClass: string; headingClass: string }) {
    const {t} = useI18n();
    const state = useInstallState();
    return (
        <section className={sectionClass} data-testid="settings-app">
            <h2 className={headingClass}><Smartphone size={18} className="text-amber-400"/> {t('settings.app.title')}</h2>
            <p className="text-sm mb-3">{t('settings.app.intro')}</p>
            {state === 'available' && (
                <button type="button" onClick={() => void promptInstall()} data-testid="settings-app-install"
                        className="px-4 py-2 rounded bg-amber-700 hover:bg-amber-600 text-white font-bold cursor-pointer">
                    {t('settings.app.install')}
                </button>
            )}
            <p className="text-sm text-boxwood/85" data-testid="settings-app-state">
                {state === 'installed' && t('settings.app.installed')}
                {state === 'ios' && t('settings.app.ios')}
                {state === 'unsupported' && t('settings.app.browserMenu')}
            </p>
        </section>
    );
}
