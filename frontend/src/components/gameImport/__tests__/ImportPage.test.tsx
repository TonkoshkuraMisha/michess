// «Мои партии с других сайтов» (таск 24.1): импорт по нику, вставка PGN, список с итогом и задачами, ошибки сервера.

import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ImportPage} from '../ImportPage';
import {clearToken, setToken} from '../../../services/authToken';

const GAME = {
    id: 3, source: 'lichess', color: 'black', white: 'rival', black: 'me', white_rating: 1510, black_rating: 1490,
    result: '0-1', speed: 'blitz', played_at: '2026-11-01T10:00:00+00:00', analyzed: true, puzzles: 2,
};

type Reply = { status?: number; body: unknown };

function stub(routes: (url: string, init?: RequestInit) => Reply | undefined) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const reply = routes(String(url), init) ?? {body: {total: 0, max: 300, games: []}};
        const status = reply.status ?? 200;
        return {ok: status < 400, status, json: async () => reply.body} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function renderPage() {
    return render(<MemoryRouter><ImportPage/></MemoryRouter>);
}

beforeEach(() => {
    localStorage.clear();
    setToken('t');
});
afterEach(() => {
    clearToken();
    vi.unstubAllGlobals();
});

describe('Импорт партий', () => {
    it('без входа просит войти и не ходит на сервер', () => {
        clearToken();
        const fetchMock = stub(() => undefined);
        renderPage();
        expect(screen.getByTestId('import-login')).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('список: итог с точки зрения игрока, соперник, задачи и ссылка на разбор', async () => {
        stub((url) => url.includes('/imports/games') ? {body: {total: 1, max: 300, games: [GAME]}} : undefined);
        renderPage();
        const row = await screen.findByTestId('imported-game');
        expect(row).toHaveTextContent('Победа');
        expect(row).toHaveTextContent('чёрными против rival (1510)');
        expect(row).toHaveTextContent('2 задачи');
        expect(row.querySelector('a')).toHaveAttribute('href', '/import/game/3');
    });

    it('импорт по нику: запрос с сайтом, ником и числом партий, ник запоминается', async () => {
        const fetchMock = stub((url, init) => url.endsWith('/imports/fetch')
            ? {body: {added: [GAME], duplicates: 1, skipped: 0}} : (init?.method ? undefined : undefined));
        renderPage();
        fireEvent.click(screen.getByTestId('import-tab-chesscom'));
        fireEvent.change(screen.getByTestId('import-nick'), {target: {value: 'me_42'}});
        fireEvent.click(screen.getByRole('button', {name: '20'}));
        fireEvent.click(screen.getByTestId('import-submit'));
        expect(await screen.findByTestId('import-result')).toHaveTextContent('Добавлена 1 партия');
        const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/imports/fetch'));
        expect(JSON.parse(String(call?.[1]?.body))).toEqual({source: 'chesscom', username: 'me_42', max: 20});
        expect(call?.[1]?.headers).toMatchObject({Authorization: 'Bearer t'});
        expect(localStorage.getItem('michess_import_nick_chesscom')).toBe('me_42');
    });

    it('кнопка неактивна, пока ник не похож на ник', () => {
        stub(() => undefined);
        renderPage();
        fireEvent.change(screen.getByTestId('import-nick'), {target: {value: 'a b'}});
        expect(screen.getByTestId('import-submit')).toBeDisabled();
    });

    it('PGN: имя игрока уходит в запрос; ошибка сервера показывается текстом из каталога', async () => {
        const fetchMock = stub((url) => url.endsWith('/imports/pgn')
            ? {status: 400, body: {detail: {code: 'import_player_not_in_pgn', params: {player: 'Misha'}, message: ''}}}
            : undefined);
        renderPage();
        fireEvent.click(screen.getByTestId('import-tab-pgn'));
        fireEvent.change(screen.getByTestId('import-pgn'), {target: {value: '1. e4 e5'}});
        fireEvent.change(screen.getByTestId('import-player'), {target: {value: 'Misha'}});
        fireEvent.click(screen.getByTestId('import-submit'));
        expect(await screen.findByTestId('import-error')).toHaveTextContent('Ни в одной партии PGN нет игрока «Misha»');
        const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/imports/pgn'));
        expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({pgn: '1. e4 e5', player: 'Misha'});
    });

    it('удаление спрашивает подтверждение и обновляет список', async () => {
        let games = [GAME];
        const fetchMock = stub((url, init) => {
            if (init?.method === 'DELETE') {
                games = [];
                return {status: 204, body: null};
            }
            return url.includes('/imports/games') ? {body: {total: games.length, max: 300, games}} : undefined;
        });
        vi.stubGlobal('confirm', () => true);
        renderPage();
        fireEvent.click(await screen.findByTestId('imported-delete'));
        await waitFor(() => expect(screen.getByTestId('import-empty')).toBeInTheDocument());
        expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/games/3'))).toBe(true);
    });
});
