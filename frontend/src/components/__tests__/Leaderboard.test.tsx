// Таблица лидеров: загрузка по категории, переключение вкладок, переход в профиль, пустой
// список и ошибка сети.

import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useParams} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import Leaderboard from '../Leaderboard';

const TOP_BY_CATEGORY: Record<string, Array<{ rank: number; username: string; rating: number }>> = {
    blitz: [
        {rank: 1, username: 'Magnus', rating: 2100},
        {rank: 2, username: 'Hikaru', rating: 2050},
        {rank: 3, username: 'Alice B', rating: 1900},
        {rank: 4, username: 'bob', rating: 1500},
    ],
    bullet: [{rank: 1, username: 'Speedy', rating: 2300}],
};

function stubLeaderboardFetch(response: (category: string) => Response | Promise<Response>) {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input.toString(), 'http://test');
        return response(url.searchParams.get('category') ?? '');
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const okJson = (data: unknown) => ({ok: true, status: 200, json: async () => data}) as Response;

function ProfileStub() {
    const {username} = useParams();
    return <div>Профиль: {username}</div>;
}

function renderLeaderboard() {
    return render(
        <MemoryRouter initialEntries={['/leaderboard']}>
            <Routes>
                <Route path="/leaderboard" element={<Leaderboard/>}/>
                <Route path="/profile/:username" element={<ProfileStub/>}/>
                <Route path="/" element={<div>Главная</div>}/>
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Leaderboard', () => {
    it('по умолчанию показывает блиц и всех игроков с рейтингом', async () => {
        const fetchMock = stubLeaderboardFetch((category) => okJson(TOP_BY_CATEGORY[category] ?? []));
        renderLeaderboard();

        expect(await screen.findByText('Magnus')).toBeInTheDocument();
        expect(screen.getByText('2100')).toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
        // 4-е место — номер, а не медаль.
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('category=blitz'));
        expect(screen.getByText(/по рейтингу Эло — блиц/)).toBeInTheDocument();
    });

    it('вкладка категории перезагружает список', async () => {
        const fetchMock = stubLeaderboardFetch((category) => okJson(TOP_BY_CATEGORY[category] ?? []));
        renderLeaderboard();
        await screen.findByText('Magnus');

        fireEvent.click(screen.getByRole('button', {name: 'Пуля'}));

        expect(await screen.findByText('Speedy')).toBeInTheDocument();
        expect(screen.queryByText('Magnus')).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('category=bullet'));
        expect(screen.getByText(/по рейтингу Эло — пуля/)).toBeInTheDocument();
    });

    it('клик по строке открывает профиль игрока с экранированным именем', async () => {
        stubLeaderboardFetch((category) => okJson(TOP_BY_CATEGORY[category] ?? []));
        renderLeaderboard();

        fireEvent.click(await screen.findByText('Alice B'));

        expect(await screen.findByText('Профиль: Alice B')).toBeInTheDocument();
    });

    it('кнопка «На доску» ведёт на главную', async () => {
        stubLeaderboardFetch(() => okJson([]));
        renderLeaderboard();

        fireEvent.click(screen.getByRole('button', {name: /На доску/}));

        expect(await screen.findByText('Главная')).toBeInTheDocument();
    });

    it('пустой ответ — сообщение о пустом списке', async () => {
        stubLeaderboardFetch(() => okJson([]));
        renderLeaderboard();

        expect(await screen.findByText('Список лидеров пока пуст.')).toBeInTheDocument();
    });

    it('ошибка сервера показывается пользователю', async () => {
        stubLeaderboardFetch(() => ({ok: false, status: 500, json: async () => ({})}) as Response);
        renderLeaderboard();

        expect(await screen.findByText('Не удалось загрузить таблицу лидеров')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('Список лидеров пока пуст.')).toBeInTheDocument());
    });
});
