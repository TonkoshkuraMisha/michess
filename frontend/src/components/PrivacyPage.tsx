// --- FILE: frontend/src/components/PrivacyPage.tsx ---
// «Конфиденциальность» (таск 23.1): что хранится об игроке, сколько и как им управлять. Текст — ключи `privacy.*`
// трёх каталогов i18n; цифры (срок хранения ходов 90 суток — src/services/telemetry_retention.py, выгрузка и удаление —
// src/services/account.py) должны совпадать с сервером. Страница открыта без входа; на неё ведёт флажок согласия в
// окне регистрации (AuthModal.tsx). Маршрут — App.tsx.

import {Lock} from 'lucide-react';
import {useI18n} from '../i18n';

const SECTIONS = ['s1', 's2', 's3', 's4', 's5'] as const;

export function PrivacyPage() {
    const {t} = useI18n();
    return (
        <article className="max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-4" data-testid="privacy-page">
            <h1 className="text-2xl font-bold text-amber-200 flex items-center gap-2"><Lock size={22}/> {t('privacy.title')}</h1>
            <p className="text-boxwood/85">{t('privacy.intro')}</p>
            {SECTIONS.map((section) => (
                <section key={section} className="flex flex-col gap-1">
                    <h2 className="text-lg font-bold text-amber-200">{t(`privacy.${section}Title`)}</h2>
                    <p className="text-boxwood/85">{t(`privacy.${section}Body`)}</p>
                </section>
            ))}
        </article>
    );
}
