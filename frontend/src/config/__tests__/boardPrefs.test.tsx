// Настройки доски (таск 18.4): хранение, порядок взятых фигур, «быстрый ход»; на доске — стрелка последнего хода,
// быстрый ход и анимация хода соперника.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {Chess} from 'chess.js';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    DEFAULT_BOARD_PREFS, getBoardPrefs, orderCaptured, quickMoveFrom, reloadBoardPrefs, setBoardPref,
} from '../boardPrefs';
import Chessboard from '../../components/Chessboard';
import {resetBotCatalogCache} from '../../services/botCatalog';
import {setToken} from '../../services/authToken';
import {mockFetchRouter} from '../../test/mocks';

vi.mock('../../services/gameSocket', () => ({gameSocket: {connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), on: vi.fn(), off: vi.fn()}}));
vi.mock('../../services/soundEngine', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/soundEngine')>()),
    soundEngine: {play: vi.fn(), isMuted: vi.fn(() => false), toggleMute: vi.fn(() => true)},
}));

beforeEach(() => {
    localStorage.clear();
    reloadBoardPrefs();
});

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    reloadBoardPrefs();
});

describe('настройки доски', () => {
    it('по умолчанию — как было; выбор сохраняется; мусор в хранилище игнорируется', () => {
        expect(getBoardPrefs()).toEqual(DEFAULT_BOARD_PREFS);
        setBoardPref('lastMove', 'arrow');
        expect(JSON.parse(localStorage.getItem('michess_board_prefs')!).lastMove).toBe('arrow');
        localStorage.setItem('michess_board_prefs', JSON.stringify({lastMove: 'laser', quickMove: 'yes', captured: 'order'}));
        reloadBoardPrefs();
        expect(getBoardPrefs()).toEqual({...DEFAULT_BOARD_PREFS, captured: 'order'});
        localStorage.setItem('michess_board_prefs', '{broken');
        reloadBoardPrefs();
        expect(getBoardPrefs()).toEqual(DEFAULT_BOARD_PREFS);
    });

    it('взятые фигуры: по ценности, по видам, по порядку взятия', () => {
        const byValue = {white: ['♛', '♞', '♟'], black: ['♝', '♟']};
        expect(orderCaptured('value', byValue, [])).toBe(byValue);
        expect(orderCaptured('kind', byValue, [])).toEqual({white: ['♟', '♞', '♛'], black: ['♟', '♝']});
        const history = [{color: 'w', captured: 'p'}, {color: 'b', captured: 'n'}, {color: 'w'}, {color: 'w', captured: 'q'}];
        expect(orderCaptured('order', byValue, history)).toEqual({white: ['♟', '♛'], black: ['♞']});
    });

    it('быстрый ход — только когда на поле может пойти одна фигура', () => {
        const start = new Chess().moves({verbose: true});
        expect(quickMoveFrom(start, 'e4')).toBe('e2');
        expect(quickMoveFrom(start, 'a4')).toBe('a2');
        expect(quickMoveFrom(start, 'f3')).toBeNull();   // и конь g1, и пешка f2 — выбор неоднозначен
        expect(quickMoveFrom(start, 'e5')).toBeNull();
        const knights = new Chess('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1').moves({verbose: true});
        expect(quickMoveFrom(knights, 'd2')).toBeNull();
    });
});

describe('настройки на доске', () => {
    const squareEl = (square: string) => document.querySelector(`[data-square="${square}"]`) as HTMLElement;

    async function startBotGame() {
        resetBotCatalogCache();
        setToken('test-token');
        vi.stubGlobal('fetch', mockFetchRouter({
            '/profile/me': () => ({id: 1, username: 'TestPlayer', blitz_rating: 1500}),
            '/profile/matchmaking/queue': () => [],
            '/profile/games/live': () => [],
            '/profile/games/my-active': () => ({active: false}),
            '/bots/move': () => ({uci: 'e7e5', san: 'e5', fen_after: '', source: 'book', comment: '', thinking_time_ms: 10}),
        }));
        render(<MemoryRouter><Chessboard/></MemoryRouter>);
        const start = await screen.findByRole('button', {name: /Белыми/});
        await act(async () => fireEvent.click(start));
    }

    it('стрелка последнего хода вместо подсветки; быстрый ход щелчком по полю; анимация ответа бота', async () => {
        setBoardPref('lastMove', 'arrow');
        setBoardPref('quickMove', true);
        await startBotGame();
        await act(async () => fireEvent.click(squareEl('e4')));   // e4 может занять только пешка e2
        expect(screen.getByText('e4')).toBeInTheDocument();
        expect(await screen.findByTestId('last-move-arrow')).toBeInTheDocument();
        // Ответ бота (e7e5) анимируется.
        const sliding = await screen.findByTestId('move-animation');
        // Фигура уже на своём поле (клетки показывают настоящую позицию) и съезжает туда со старого.
        expect(squareEl('e5').contains(sliding)).toBe(true);
        expect(sliding.querySelector('img')).not.toBeNull();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
        });
        expect(screen.queryByTestId('move-animation')).toBeNull();
        setToken(null);
    }, 20_000);  // под нагрузкой (замер покрытия, CI) 5 с по умолчанию не хватало

    it('«только щелчки»: перетаскивание не начинается', async () => {
        setBoardPref('moveInput', 'click');
        await startBotGame();
        fireEvent.pointerDown(squareEl('e2').querySelector('div.relative.w-full') as HTMLElement, {button: 0, pointerType: 'mouse', clientX: 1, clientY: 1});
        expect(document.querySelector('[data-testid="drag-ghost"]')).toBeNull();
        fireEvent.click(squareEl('e2'));
        fireEvent.click(squareEl('e4'));
        expect(screen.getByText('e4')).toBeInTheDocument();
        setToken(null);
    });
});
