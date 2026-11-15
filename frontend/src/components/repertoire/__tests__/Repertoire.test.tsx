// Дебютный репертуар (таск 20.1): обход дерева по рёбрам сервера, список и стартовые наборы, редактор (ходы из
// позиции, новые ходы с доски, комментарий, удаление, импорт PGN) и кнопка «В репертуар».

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {edgesFrom, followLine} from '../../../services/repertoire';
import type {Repertoire} from '../../../services/repertoire';
import {numbered, RepertoireEditorPage, RepertoireListPage} from '../RepertoirePages';
import {AddToRepertoire} from '../AddToRepertoire';

// Справочник дебютов проверяется своими тестами; здесь он только мешал бы подменой fetch.
vi.mock('../../OpeningExplorer', () => ({OpeningExplorer: () => null}));

const ROOT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';
const AFTER_C6 = 'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -';

const REP: Repertoire = {
    id: 7, name: '', color: 'black', starter: 'caro_kann', root: ROOT,
    moves: [
        {position: ROOT, uci: 'e2e4', san: 'e4', child: AFTER_E4, comment: '', mine: false},
        {position: AFTER_E4, uci: 'e7e5', san: 'e5', child: 'x', comment: '', mine: true},
        {position: AFTER_E4, uci: 'c7c6', san: 'c6', child: AFTER_C6, comment: 'solid', mine: true},
    ],
};

type Handler = (url: string, init?: RequestInit) => unknown;

function stubFetch(handler: Handler) {
    const mock = vi.fn(async (url: string, init?: RequestInit) => ({ok: true, json: async () => handler(String(url), init)}) as Response);
    vi.stubGlobal('fetch', mock);
    return mock;
}

const body = (mock: ReturnType<typeof stubFetch>, index: number) =>
    JSON.parse(String((mock.mock.calls[index] as unknown as [string, RequestInit])[1].body));

const page = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/repertoire" element={<RepertoireListPage/>}/>
            <Route path="/repertoire/:repertoireId" element={<RepertoireEditorPage/>}/>
        </Routes>
    </MemoryRouter>,
);
const click = (square: string) => fireEvent.click(document.querySelector(`[data-square="${square}"]`)!);

beforeEach(() => setToken('jwt'));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setToken(null);
});

describe('обход дерева', () => {
    it('followLine идёт по рёбрам и останавливается на новом ходе; свои ходы — первыми', () => {
        expect(followLine(REP, ['e2e4', 'c7c6'])).toEqual({position: AFTER_C6, known: 2});
        expect(followLine(REP, ['e2e4', 'd7d5', 'e4d5'])).toEqual({position: AFTER_E4, known: 1});
        expect(edgesFrom(REP, AFTER_E4).map((m) => m.san)).toEqual(['e5', 'c6']);
        expect(numbered(['e4', 'c6', 'd4'])).toEqual(['1. e4', 'c6', '2. d4']);
    });
});

describe('список репертуаров', () => {
    it('без входа — только стартовые наборы и подсказка', async () => {
        setToken(null);
        stubFetch(() => ({starters: [{id: 'london', color: 'white', level: 'beginner', lines: [['d2d4']]}]}));
        await act(async () => page('/repertoire'));
        expect(screen.getByTestId('repertoire-login')).toBeInTheDocument();
        expect(screen.getByTestId('starter-london')).toHaveTextContent('Лондонская система');
        expect(screen.queryByTestId('starter-use-london')).toBeNull();
    });

    it('свои репертуары, создание пустого и из стартового набора', async () => {
        const mock = stubFetch((url, init) => {
            if (url.endsWith('/starters')) return {starters: [{id: 'caro_kann', color: 'black', level: 'intermediate', lines: [['e2e4', 'c7c6']]}]};
            if (init?.method === 'POST') return {...REP, id: 9};
            if (url.endsWith('/9')) return {...REP, id: 9};
            return {repertoires: [{id: 3, name: 'Мой', color: 'white', starter: null, moves: 5}]};
        });
        await act(async () => page('/repertoire'));
        expect(screen.getByTestId('repertoire-3')).toHaveTextContent('Мой');
        expect(screen.getByTestId('repertoire-3')).toHaveTextContent('5 ходов');
        fireEvent.change(screen.getByTestId('repertoire-name'), {target: {value: 'Новый'}});
        fireEvent.change(screen.getByTestId('repertoire-color'), {target: {value: 'black'}});
        await act(async () => fireEvent.click(screen.getByTestId('repertoire-create')));
        const created = mock.mock.calls.findIndex((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST');
        expect(body(mock, created)).toEqual({name: 'Новый', color: 'black'});
        expect(await screen.findByTestId('repertoire-editor')).toBeInTheDocument();
    });
});

describe('редактор', () => {
    it('ходы из позиции, переход по дереву, новый ход с доски добавляется кнопкой', async () => {
        const mock = stubFetch((_url, init) => (init?.method === 'POST'
            ? {...REP, added: 1, moves: [...REP.moves, {position: AFTER_C6, uci: 'd2d4', san: 'd4', child: 'y', comment: '', mine: false}]}
            : REP));
        await act(async () => page('/repertoire/7'));
        expect(screen.getByTestId('repertoire-rename')).toHaveAttribute('placeholder', 'Защита Каро — Канн');
        expect(screen.getByTestId('repertoire-line')).toHaveTextContent('Начальная позиция');
        await act(async () => fireEvent.click(screen.getByTestId('repertoire-move-e2e4')));
        expect(screen.getByTestId('repertoire-moves')).toHaveTextContent('ваш ход');
        await act(async () => fireEvent.click(screen.getByTestId('repertoire-move-c7c6')));
        expect(screen.getByTestId('repertoire-line')).toHaveTextContent('1. e4 c6');
        expect(screen.getByTestId('repertoire-comment')).toHaveValue('solid');
        expect(screen.getByTestId('repertoire-moves')).toHaveTextContent('В репертуаре пока нет ходов');

        click('d2');
        await act(async () => click('d4'));
        expect(screen.getByTestId('repertoire-moves')).toHaveTextContent('Этой позиции ещё нет');
        await act(async () => fireEvent.click(screen.getByTestId('repertoire-add-new')));
        expect(body(mock, mock.mock.calls.length - 1)).toEqual({moves: ['e2e4', 'c7c6', 'd2d4']});
        expect(screen.getByTestId('repertoire-notice')).toHaveTextContent('Добавлен 1 ход');
        expect(screen.queryByTestId('repertoire-add-new')).toBeNull();
    });

    it('комментарий, удаление хода и импорт PGN', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const mock = stubFetch((url) => {
            if (url.endsWith('/comment')) return {comment: 'new idea'};
            if (url.endsWith('/remove')) return {...REP, removed: 2, moves: REP.moves.slice(0, 2)};
            if (url.endsWith('/pgn')) return {...REP, added: 3};
            return REP;
        });
        await act(async () => page('/repertoire/7'));
        await act(async () => fireEvent.click(screen.getByTestId('repertoire-move-e2e4')));
        await act(async () => fireEvent.click(screen.getByTestId('repertoire-move-c7c6')));
        fireEvent.change(screen.getByTestId('repertoire-comment'), {target: {value: 'new idea'}});
        await act(async () => fireEvent.click(screen.getByTestId('repertoire-comment-save')));
        expect(body(mock, mock.mock.calls.length - 1)).toEqual({position: AFTER_E4, uci: 'c7c6', comment: 'new idea'});

        await act(async () => fireEvent.click(screen.getByTestId('repertoire-remove-move')));
        expect(body(mock, mock.mock.calls.length - 1)).toEqual({position: AFTER_E4, uci: 'c7c6'});
        expect(screen.getByTestId('repertoire-notice')).toHaveTextContent('Удалено 2 хода');
        expect(screen.getByTestId('repertoire-line')).toHaveTextContent('1. e4');
        expect(screen.queryByTestId('repertoire-move-c7c6')).toBeNull();

        fireEvent.change(screen.getByTestId('repertoire-pgn'), {target: {value: '1. e4 c6 *'}});
        await act(async () => fireEvent.click(screen.getByTestId('repertoire-import')));
        expect(body(mock, mock.mock.calls.length - 1)).toEqual({pgn: '1. e4 c6 *'});
        expect(screen.getByTestId('repertoire-notice')).toHaveTextContent('Добавлено 3 хода');
    });

    it('ошибка сервера показывается', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 404, json: async () => ({detail: {code: 'repertoire_not_found', params: {}, message: ''}}),
        }) as Response));
        await act(async () => page('/repertoire/99'));
        expect(screen.getByRole('alert')).toHaveTextContent('Репертуар не найден');
    });
});

describe('кнопка «В репертуар»', () => {
    it('без входа не показывается', () => {
        setToken(null);
        const {container} = render(<MemoryRouter><AddToRepertoire moves={['e2e4']}/></MemoryRouter>);
        expect(container).toBeEmptyDOMElement();
    });

    it('нет репертуаров — ссылка на создание', async () => {
        stubFetch(() => ({repertoires: []}));
        await act(async () => render(<MemoryRouter><AddToRepertoire moves={['e2e4']}/></MemoryRouter>));
        expect(screen.getByText('Сначала создайте репертуар')).toBeInTheDocument();
    });

    it('добавляет линию в выбранный репертуар', async () => {
        const mock = stubFetch((url) => (url.endsWith('/lines')
            ? {...REP, added: 2}
            : {repertoires: [{id: 7, name: '', color: 'black', starter: null, moves: 0}, {id: 8, name: 'B', color: 'white', starter: null, moves: 1}]}));
        await act(async () => render(<MemoryRouter><AddToRepertoire moves={['e2e4', 'c7c6']}/></MemoryRouter>));
        fireEvent.change(screen.getByTestId('add-to-repertoire-select'), {target: {value: '8'}});
        await act(async () => fireEvent.click(screen.getByTestId('add-to-repertoire-button')));
        expect(String((mock.mock.calls[1] as unknown as [string])[0])).toContain('/repertoires/8/lines');
        expect(body(mock, 1)).toEqual({moves: ['e2e4', 'c7c6']});
        expect(screen.getByTestId('add-to-repertoire-result')).toHaveTextContent('Добавлено 2 хода');
    });
});
