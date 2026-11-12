// --- FILE: frontend/src/components/LanguageSwitcher.tsx ---
// Переключатель языка интерфейса. Обычный <select>: доступен с клавиатуры и читалкам экрана, на телефоне
// открывает системный список. Языки подписаны самоназваниями — свой язык узнают при любом текущем.

import {Languages} from 'lucide-react';
import {LANGUAGES, LANGUAGE_NATIVE_NAMES, isLanguage, useI18n} from '../i18n';

export interface LanguageSwitcherProps {
    /** compact — в шапке: только иконка и код языка; иначе — полные названия (страница настроек). */
    compact?: boolean;
    className?: string;
}

export default function LanguageSwitcher({compact = false, className = ''}: LanguageSwitcherProps) {
    const {t, language, setLanguage} = useI18n();
    return (
        <label
            className={`relative flex items-center gap-1.5 text-boxwood/85 hover:text-amber-300 transition ${className}`}
            title={t('language.choose')}
        >
            <Languages size={compact ? 19 : 17} aria-hidden="true"/>
            <select
                value={language}
                onChange={(e) => {
                    if (isLanguage(e.target.value)) setLanguage(e.target.value);
                }}
                aria-label={t('language.label')}
                className={`bg-black/40 border border-amber-900/50 rounded-md text-amber-200 font-semibold outline-none cursor-pointer focus:border-amber-500 ${
                    compact ? 'px-1 py-1 text-xs uppercase' : 'px-2.5 py-1.5 text-sm'
                }`}
            >
                {LANGUAGES.map((code) => (
                    <option key={code} value={code} lang={code}>
                        {compact ? code.toUpperCase() : LANGUAGE_NATIVE_NAMES[code]}
                    </option>
                ))}
            </select>
        </label>
    );
}
