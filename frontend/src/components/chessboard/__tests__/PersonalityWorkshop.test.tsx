// Мастерская соперников: архетипы, ползунки, сохранение (браузер гостя / профиль) и старт партии.

import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PersonalityWorkshop} from '../PersonalityWorkshop';
import {resetBotCatalogCache} from '../../../services/botCatalog';
import {DEFAULT_CONFIG, readGuestPersonalities} from '../../../services/personalities';

function renderWorkshop(token: string | null, onPlay = vi.fn()) {
    render(
        <PersonalityWorkshop
            token={token}
            playDisabled={false}
            onPlay={onPlay}
            canStartFromPosition={false}
            startFromPosition={false}
            onStartFromPositionChange={vi.fn()}
        />,
    );
    return onPlay;
}

const slider = (label: string) => screen.getByRole('slider', {name: label}) as HTMLInputElement;

const archetype = (name: string, target_elo: number, extra: Record<string, unknown> = {}) => ({
    name, bio: `Биография: ${name}`, config: {...DEFAULT_CONFIG, target_elo, ...extra},
    declared_rating: target_elo, rating: target_elo, measured: false, games: 0, ci95: null,
});

const CATALOG = {
    calibration: {date: '2026-11-12', games: 680},
    historical: [],
    archetypes: [
        {...archetype('Торопыга', 700, {aggression: 70}), rating: 640, measured: true, games: 40, ci95: 90},
        archetype('Комбинатор', 2200),
    ],
};

/** fetch: каталог — всегда; остальное — по переданному обработчику. */
function stubFetch(other?: (url: string, init?: RequestInit) => unknown) {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        const body = url.endsWith('/bots/catalog') ? CATALOG : other?.(url, init);
        return {ok: true, status: 200, json: async () => body} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => {
    localStorage.clear();
    resetBotCatalogCache();
    vi.stubGlobal('ResizeObserver', class {
        observe() {
        }

        unobserve() {
        }

        disconnect() {
        }
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('гость', () => {
    it('архетипы приходят с сервера, измеренная сила помечена', async () => {
        stubFetch();
        renderWorkshop(null);
        expect(await screen.findByRole('button', {name: /Торопыга 640 \(изм\.\)/})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Комбинатор 2200$/})).toBeInTheDocument();
    });

    it('архетип заполняет конструктор, слабый — с пояснением про намеренные ошибки', async () => {
        stubFetch();
        renderWorkshop(null);
        fireEvent.click(await screen.findByRole('button', {name: /Торопыга/}));

        expect((screen.getByPlaceholderText(/Гамбитёр/) as HTMLInputElement).value).toBe('Торопыга');
        expect(slider('Сила (Эло)').value).toBe('700');
        expect(screen.getByTestId('strength-note').textContent).toMatch(/намеренно/);
    });

    it('ползунок меняет значение и пояснение силы', () => {
        stubFetch();
        renderWorkshop(null);
        fireEvent.change(slider('Сила (Эло)'), {target: {value: '2000'}});
        expect(screen.getByTestId('strength-note').textContent).toMatch(/~2000.*ошибок «нарочно» нет/);
    });

    it('сохранение — в браузере, соперник появляется в списке', async () => {
        stubFetch();
        renderWorkshop(null);
        fireEvent.change(screen.getByPlaceholderText(/Гамбитёр/), {target: {value: 'Гамбитёр'}});
        fireEvent.change(slider('Агрессия'), {target: {value: '80'}});
        await act(async () => fireEvent.click(screen.getByRole('button', {name: /Сохранить соперника/})));

        expect(readGuestPersonalities()[0]).toMatchObject({name: 'Гамбитёр', config: {aggression: 80}});
        expect(screen.getByText(/Сохранено в этом браузере/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Изменить Гамбитёр'})).toBeInTheDocument();
    });

    it('без имени не сохраняет', async () => {
        stubFetch();
        renderWorkshop(null);
        await act(async () => fireEvent.click(screen.getByRole('button', {name: /Сохранить соперника/})));
        expect(screen.getByRole('alert').textContent).toMatch(/имя/);
        expect(readGuestPersonalities()).toEqual([]);
    });

    it('«Сыграть» отдаёт имя и конфиг из конструктора', async () => {
        stubFetch();
        const onPlay = renderWorkshop(null);
        fireEvent.click(await screen.findByRole('button', {name: /Комбинатор/}));
        fireEvent.click(screen.getByRole('button', {name: /Чёрными/}));

        const [opponent, color] = onPlay.mock.calls[0];
        expect(color).toBe('black');
        expect(opponent.name).toBe('Комбинатор');
        expect(opponent.bio).toBe('Биография: Комбинатор');
        expect(opponent.config.target_elo).toBe(2200);
        expect(opponent.personalityId).toBeUndefined();
    });
});

describe('вошедший игрок', () => {
    const saved = {
        id: 5, name: 'Гамбитёр', config: {...DEFAULT_CONFIG, aggression: 70},
        created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z',
    };

    function stubServer() {
        return stubFetch((_url, init) => ((init?.method ?? 'GET') === 'GET'
            ? [saved]
            : {...saved, ...JSON.parse(String(init?.body ?? '{}'))}));
    }

    it('список приходит с сервера; неизменённый соперник играет по своему id', async () => {
        stubServer();
        const onPlay = renderWorkshop('jwt');

        fireEvent.click(await screen.findByRole('button', {name: 'Изменить Гамбитёр'}));
        fireEvent.click(screen.getByRole('button', {name: /Белыми/}));
        expect(onPlay.mock.calls[0][0]).toMatchObject({name: 'Гамбитёр', personalityId: 5});

        // После правки ползунка играет текущий конфиг, а не сохранённый.
        fireEvent.change(slider('Агрессия'), {target: {value: '-50'}});
        fireEvent.click(screen.getByRole('button', {name: /Белыми/}));
        expect(onPlay.mock.calls[1][0].personalityId).toBeUndefined();
        expect(onPlay.mock.calls[1][0].config.aggression).toBe(-50);
    });

    it('сохранение изменённого соперника — PUT в профиль', async () => {
        const fetchMock = stubServer();
        renderWorkshop('jwt');
        fireEvent.click(await screen.findByRole('button', {name: 'Изменить Гамбитёр'}));
        fireEvent.change(slider('Центр'), {target: {value: '180'}});
        await act(async () => fireEvent.click(screen.getByRole('button', {name: /Сохранить соперника/})));

        const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(put?.[0]).toMatch(/\/bots\/personalities\/5$/);
        expect(JSON.parse(String(put?.[1]?.body)).config.center_control).toBe(180);
        await waitFor(() => expect(screen.getByText('Сохранено в профиле')).toBeInTheDocument());
    });

    it('удаление спрашивает подтверждение', async () => {
        const fetchMock = stubServer();
        vi.stubGlobal('confirm', vi.fn(() => true));
        renderWorkshop('jwt');
        const item = (await screen.findByText('Гамбитёр')).closest('li') as HTMLElement;
        await act(async () => fireEvent.click(within(item).getByRole('button', {name: 'Удалить Гамбитёр'})));
        expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/5'))).toBe(true);
    });
});
