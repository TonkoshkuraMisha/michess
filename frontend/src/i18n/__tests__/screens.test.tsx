// --- FILE: frontend/src/i18n/__tests__/screens.test.tsx ---
// Ключевые экраны на трёх языках: заголовки и подписи берутся из своего каталога, данные (в том числе
// геттеры конфигов — названия досок, контроли времени, имена ботов) переводятся вместе с интерфейсом,
// а переключатель меняет язык на лету, без перезагрузки и без потери состояния страницы.

import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import About from '../../components/About';
import AuthModal from '../../components/AuthModal';
import Leaderboard from '../../components/Leaderboard';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import Settings from '../../components/Settings';
import {GameChatPanel} from '../../components/chessboard/GameChatPanel';
import {HISTORICAL_BOTS, CHAMPIONS_LIST} from '../../config/champions';
import {BOARD_THEMES, PIECE_SETS} from '../../config/boardAppearance';
import {ALL_TIME_CONTROLS, TIME_CONTROLS} from '../../config/timeControls';
import {describeGameOver, renderStatus} from '../../components/chessboard/status';
import {LANGUAGE_STORAGE_KEY, getLanguage, makeI18n, setLanguage, type Language} from '../index';

vi.mock('../../services/gameSocket', () => ({
    gameSocket: {connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), on: vi.fn(), off: vi.fn()},
}));

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => []}) as unknown as Response));
});

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

const HEADINGS: Record<Language, { settings: string; about: string; login: string; leaderboard: string }> = {
    en: {settings: 'Settings', about: 'About and licenses', login: 'Log in to michess', leaderboard: 'Michess leaderboard'},
    uk: {settings: 'Налаштування', about: 'Про проєкт і ліцензії', login: 'Вхід до michess', leaderboard: 'Таблиця лідерів Michess'},
    ru: {settings: 'Настройки', about: 'О проекте и лицензиях', login: 'Вход в michess', leaderboard: 'Таблица лидеров Michess'},
};

describe.each(['en', 'uk', 'ru'] as const)('экраны на языке %s', (language) => {
    beforeEach(() => setLanguage(language, {persist: false}));

    it('настройки', () => {
        render(<MemoryRouter><Settings token={null} username={null} onTokenChange={vi.fn()} onLogoutEverywhere={vi.fn()}/></MemoryRouter>);
        expect(screen.getByRole('heading', {level: 1})).toHaveTextContent(HEADINGS[language].settings);
        // Названия досок приходят из конфига — и тоже на этом языке.
        expect(screen.getByRole('button', {name: BOARD_THEMES.walnut.name})).toBeInTheDocument();
    });

    it('о проекте', () => {
        render(<MemoryRouter><About/></MemoryRouter>);
        expect(screen.getByRole('heading', {level: 1})).toHaveTextContent(HEADINGS[language].about);
        expect(screen.getByRole('link', {name: 'github.com/official-stockfish/Stockfish'})).toBeInTheDocument();
    });

    it('окно входа', () => {
        render(<AuthModal onSuccess={vi.fn()}/>);
        expect(screen.getByRole('dialog', {name: HEADINGS[language].login})).toBeInTheDocument();
    });

    it('таблица лидеров', async () => {
        render(<MemoryRouter><Leaderboard/></MemoryRouter>);
        expect(await screen.findByRole('heading', {level: 1})).toHaveTextContent(HEADINGS[language].leaderboard);
    });

    it('быстрые фразы чата — на языке читателя', () => {
        render(<GameChatPanel
            messages={[{sender: 'bob', text: '', preset: 'thanks', timestamp: 1}]}
            chatInput="" onChatInputChange={vi.fn()} onSendMessage={vi.fn()} onSendPreset={vi.fn()}
            isSpectator={false} onLeaveSpectate={vi.fn()}/>);
        const thanks = makeI18n(language).t('chat.presets.thanks');
        expect(screen.getAllByText(thanks).length).toBe(2); // кнопка и сообщение в ленте
    });
});

describe('данные конфигов переводятся вместе с интерфейсом', () => {
    it('боты, чемпионы, доски, фигуры и контроль времени', () => {
        setLanguage('en', {persist: false});
        expect(HISTORICAL_BOTS.morphy.name).toBe('Paul Charles Morphy');
        expect(CHAMPIONS_LIST.find((c) => c.id === 'Ding')!.years).toBe('2023–present');
        expect(PIECE_SETS.cburnett.shortName).toBe('Staunton');
        expect(TIME_CONTROLS[1].title).toBe('Blitz');
        expect(ALL_TIME_CONTROLS.find((o) => o.id === 'blitz-3+2')!.label).toBe('3 min + 2 sec/move');

        setLanguage('uk', {persist: false});
        expect(HISTORICAL_BOTS.morphy.name).toBe('Пол Чарлз Морфі');
        expect(CHAMPIONS_LIST.find((c) => c.id === 'Ding')!.years).toBe('2023–дотепер');
        expect(BOARD_THEMES.walnut.name).toBe('Горіх');
        expect(ALL_TIME_CONTROLS.find((o) => o.id === 'blitz-3+2')!.label).toBe('3 хв + 2 с/хід');

        setLanguage('ru', {persist: false});
        expect(HISTORICAL_BOTS.morphy.name).toBe('Пол Чарльз Морфи');
        expect(ALL_TIME_CONTROLS.find((o) => o.id === 'bullet-manual')!.label).toBe('Ручная настройка (Пуля)');
    });

    it('у всех чемпионов есть подпись лет, у не-чемпионов — «годы выступлений»', () => {
        const careers = CHAMPIONS_LIST.filter((c) => !c.worldChampion).map((c) => c.id);
        expect(careers.sort()).toEqual(['Geller', 'Keres', 'Korchnoi', 'Rubinstein']);
    });

    it('итог партии — на языке показа, а не на языке события', () => {
        const summary = describeGameOver('1-0', 'checkmate')!;
        expect(renderStatus(summary, makeI18n('en').t)).toBe('Game over. Result: 1-0 (checkmate)');
        expect(renderStatus(summary, makeI18n('uk').t)).toBe('Партію закінчено. Результат: 1-0 (мат)');
        expect(renderStatus(summary, makeI18n('ru').t)).toBe('Партия окончена. Результат: 1-0 (мат)');
        expect(renderStatus(describeGameOver('*', 'aborted')!, makeI18n('en').t)).toMatch(/aborted/i);
        // Неизвестная причина не ломает строку — показывается итог без пояснения.
        expect(renderStatus(describeGameOver('0-1', 'something_new')!, makeI18n('ru').t)).toBe('Партия окончена. Результат: 0-1');
    });
});

describe('переключатель языка', () => {
    it('меняет язык всей страницы без перезагрузки и запоминает выбор', () => {
        setLanguage('ru', {persist: false});
        render(
            <MemoryRouter>
                <LanguageSwitcher/>
                <Settings token={null} username={null} onTokenChange={vi.fn()} onLogoutEverywhere={vi.fn()}/>
            </MemoryRouter>,
        );
        const select = screen.getAllByRole('combobox')[0];
        expect(within(select).getByRole('option', {name: 'Українська'})).toBeInTheDocument();

        act(() => {
            fireEvent.change(select, {target: {value: 'en'}});
        });
        expect(getLanguage()).toBe('en');
        expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
        expect(document.documentElement.lang).toBe('en');
        expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Settings');

        act(() => {
            fireEvent.change(select, {target: {value: 'uk'}});
        });
        expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Налаштування');
    });

    it('неизвестное значение игнорируется', () => {
        setLanguage('ru', {persist: false});
        render(<LanguageSwitcher/>);
        act(() => {
            fireEvent.change(screen.getByRole('combobox'), {target: {value: 'de'}});
        });
        expect(getLanguage()).toBe('ru');
    });
});
