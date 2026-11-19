// --- FILE: frontend/src/components/social/TranslationHelper.tsx ---
// Режим «помощник перевода» (таск 17.7): кнопка «Предложить исправление текста» в углу экрана. После неё игрок
// нажимает на любой текст интерфейса — по тексту находится ключ каталога (i18n/catalogIndex.ts), игрок пишет свой
// вариант, предложение уходит в очередь модерации (17.4) с ключом, языком и страницей.
// Данные: включение — настройка профиля (services/profileSettings.ts, useSyncExternalStore); предложение уходит через
// moderationApi.suggestTranslation (services/moderation.ts) и попадает в очередь модератора вида translation. Рисуется
// в App.tsx поверх всех страниц; свои элементы помечает атрибутом data-translation-helper, чтобы не выбирать их самих.

import {useEffect, useState, useSyncExternalStore} from 'react';
import {useLocation} from 'react-router-dom';
import {Languages, X} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {MessageKey, UiMessage} from '../../i18n';
import {findKeysByText} from '../../i18n/catalogIndex';
import {lookup} from '../../i18n/core';
import {CATALOGS} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {moderationApi} from '../../services/moderation';
import {isTranslationHelperOn, subscribeTranslationHelper} from '../../services/profileSettings';

// Выбранный текст: то, что показано на экране, и ключи каталога, где такой текст найден (может быть несколько или ни одного).
interface Picked {
    shown: string;
    keys: string[];
}

/** Плавающая кнопка и форма предложения: перехватывает следующий клик по странице, находит ключ каталога и отправляет вариант игрока. */
export function TranslationHelper() {
    const on = useSyncExternalStore(subscribeTranslationHelper, isTranslationHelperOn, isTranslationHelperOn);
    const {t, language} = useI18n();
    const location = useLocation();
    const [picking, setPicking] = useState(false);
    const [picked, setPicked] = useState<Picked | null>(null);
    const [key, setKey] = useState('');
    const [suggestion, setSuggestion] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        if (!picking) return;
        const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target || target.closest('[data-translation-helper]')) return;
            event.preventDefault();
            event.stopPropagation();
            const shown = (target.textContent ?? '').replace(/\s+/g, ' ').trim();
            const keys = findKeysByText(language, shown);
            setPicking(false);
            setPicked({shown, keys});
            setKey(keys[0] ?? '');
            setSuggestion(shown);
            setSent(false);
            setError(null);
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [picking, language]);

    if (!on) return null;
    const current = key ? lookup(CATALOGS[language], key) : null;
    return (
        <div data-translation-helper className="fixed bottom-3 right-3 z-50 flex flex-col items-end gap-2 text-sm">
            {picked && (
                <form className="w-80 max-w-[calc(100vw-1.5rem)] bg-acacia-dark border-2 border-amber-700 rounded-lg p-3 flex flex-col gap-2 shadow-heavy"
                      data-testid="translation-form" onSubmit={(e) => {
                          e.preventDefault();
                          if (!key) return;
                          moderationApi.suggestTranslation({
                              language, key, current: typeof current === 'string' ? current : picked.shown, suggestion,
                              context: location.pathname,
                          }).then(() => setSent(true)).catch((err) => setError(errorMessage(err, 'common.networkError')));
                      }}>
                    <div className="flex justify-between items-start gap-2">
                        <b className="text-amber-200">{t('translationHelper.title')}</b>
                        <button type="button" onClick={() => setPicked(null)} aria-label={t('translationHelper.close')}><X size={14}/></button>
                    </div>
                    {sent ? <p className="text-emerald-300" data-testid="translation-sent">{t('translationHelper.sent')}</p> : (
                        <>
                            {picked.keys.length === 0 ? <p className="text-rose-300" data-testid="translation-not-found">{t('translationHelper.notFound')}</p> : (
                                <label className="flex flex-col gap-0.5">
                                    <span className="text-xs text-boxwood/70">{t('translationHelper.key')}</span>
                                    <select value={key} onChange={(e) => setKey(e.target.value)} className="bg-black/40 rounded px-1 py-0.5 font-mono text-xs"
                                            data-testid="translation-key">
                                        {picked.keys.map((k) => <option key={k} value={k}>{k}</option>)}
                                    </select>
                                </label>
                            )}
                            <p className="text-xs text-boxwood/80 italic">{picked.shown}</p>
                            {picked.keys.length > 0 && (
                                <>
                                    <textarea value={suggestion} onChange={(e) => setSuggestion(e.target.value)} maxLength={300} rows={3}
                                              aria-label={t('translationHelper.yourVersion')} className="bg-black/40 rounded px-2 py-1"
                                              data-testid="translation-suggestion"/>
                                    <button type="submit" disabled={!suggestion.trim() || suggestion.trim() === picked.shown}
                                            className="self-start px-3 py-1 rounded bg-amber-700 text-white font-bold disabled:opacity-50">
                                        {t('translationHelper.send')}
                                    </button>
                                </>
                            )}
                            {error && <p role="alert" className="text-rose-300">{renderUiMessage(error, t)}</p>}
                        </>
                    )}
                </form>
            )}
            <button type="button" onClick={() => setPicking((v) => !v)} data-testid="translation-pick"
                    className={`px-3 py-2 rounded-full shadow-heavy flex items-center gap-1.5 font-bold ${picking ? 'bg-emerald-700 text-white' : 'bg-amber-800 text-amber-100'}`}>
                <Languages size={15}/> {t((picking ? 'translationHelper.pickHint' : 'translationHelper.suggest') as MessageKey)}
            </button>
        </div>
    );
}
