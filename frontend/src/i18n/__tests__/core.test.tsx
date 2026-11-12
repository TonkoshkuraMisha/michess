// --- FILE: frontend/src/i18n/__tests__/core.test.tsx ---
// Механизм перевода: подстановка, формы числа, выбор и смена языка, перерисовка компонентов.

import {act, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {
    LANGUAGE_STORAGE_KEY,
    detectLanguage,
    getLanguage,
    interpolate,
    interpolateParts,
    makeI18n,
    pluralCategory,
    setLanguage,
    t,
    translate,
    translatePlural,
    useI18n,
} from '../index';

afterEach(() => {
    setLanguage('ru', {persist: false});
    localStorage.clear();
});

describe('подстановка параметров', () => {
    it('подставляет параметры и оставляет отсутствующие видимыми', () => {
        expect(interpolate('{a} и {b}', {a: 1, b: 'два'})).toBe('1 и два');
        expect(interpolate('{a} и {b}', {a: 1})).toBe('1 и {b}');
        expect(interpolate('без параметров')).toBe('без параметров');
    });

    it('подставляет элементы, не разрывая предложение', () => {
        const link = {type: 'link'};
        expect(interpolateParts('Код — {link}. Готово', {link})).toEqual(['Код — ', link, '. Готово']);
        expect(interpolateParts('{n} шт.', {n: 3})).toEqual(['3', ' шт.']);
    });
});

describe('формы множественного числа', () => {
    it.each([
        [1, 'one'], [2, 'few'], [4, 'few'], [5, 'many'], [11, 'many'], [21, 'one'], [22, 'few'], [25, 'many'], [1.5, 'other'],
    ])('uk и ru: %s → %s', (count, category) => {
        expect(pluralCategory('uk', count)).toBe(category);
        expect(pluralCategory('ru', count)).toBe(category);
    });

    it('английский: one / other', () => {
        expect(pluralCategory('en', 1)).toBe('one');
        expect(pluralCategory('en', 2)).toBe('other');
    });

    it('выбирает форму и подставляет count', () => {
        expect(translatePlural('ru', 'auth.importConfirm', 1)).toContain('сохранён 1 соперник');
        expect(translatePlural('ru', 'auth.importConfirm', 3)).toContain('сохранено 3 соперника');
        expect(translatePlural('ru', 'auth.importConfirm', 7)).toContain('сохранено 7 соперников');
        expect(translatePlural('uk', 'auth.importConfirm', 2)).toContain('збережено 2 суперники');
        expect(translatePlural('uk', 'auth.importConfirm', 5)).toContain('збережено 5 суперників');
        expect(translatePlural('en', 'auth.importConfirm', 1)).toContain('1 workshop opponent saved');
        expect(translatePlural('en', 'auth.importConfirm', 4)).toContain('4 workshop opponents saved');
    });
});

describe('выбор языка', () => {
    it.each([
        [['uk-UA'], 'uk'], [['ru'], 'ru'], [['en-GB'], 'en'], [['de-DE', 'uk'], 'uk'], [['fr', 'pl'], 'en'], [[], 'en'],
    ])('браузер %j → %s', (preferred, expected) => {
        expect(detectLanguage(preferred)).toBe(expected);
    });

    it('смена языка запоминается и меняет lang документа', () => {
        setLanguage('uk');
        expect(getLanguage()).toBe('uk');
        expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('uk');
        expect(document.documentElement.lang).toBe('uk');
        expect(t('settings.title')).toBe('Налаштування');
    });

    it('один и тот же ключ на трёх языках', () => {
        expect(translate('en', 'nav.leaderboard')).toBe('Leaderboard');
        expect(translate('uk', 'nav.leaderboard')).toBe('Лідери');
        expect(translate('ru', 'nav.leaderboard')).toBe('Лидеры');
    });

    it('rich подставляет элементы в целое предложение', () => {
        const {rich} = makeI18n('en');
        render(<p data-testid="p">{rich('about.engineText', {link: <a href="https://example.org">source</a>})}</p>);
        expect(screen.getByTestId('p').textContent).toMatch(/^Game analysis .* the source code is at source\. The engine/);
        expect(screen.getByRole('link', {name: 'source'})).toBeInTheDocument();
    });
});

function Title() {
    const {t: translateHere, language} = useI18n();
    return <h1 data-language={language}>{translateHere('settings.title')}</h1>;
}

describe('useI18n', () => {
    it('компонент перерисовывается при смене языка без перезагрузки', () => {
        setLanguage('ru', {persist: false});
        render(<Title/>);
        expect(screen.getByRole('heading')).toHaveTextContent('Настройки');

        act(() => setLanguage('en'));
        expect(screen.getByRole('heading')).toHaveTextContent('Settings');

        act(() => setLanguage('uk'));
        expect(screen.getByRole('heading')).toHaveTextContent('Налаштування');
        expect(screen.getByRole('heading')).toHaveAttribute('data-language', 'uk');
    });
});
