// Арены (таск 17.2): список, вход, поиск пары с повтором и переход на доску, таблица с «огнём», анонс в лобби.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {clock, controlLabel, secondsUntil} from '../../../services/arenas';
import {ArenaBanner, ArenaPage, ArenasPage, WAIT_POLL_MS} from '../ArenaPages';
import {notificationText} from '../../social/SocialHeader';
import {notificationLink} from '../../../services/social';
import type {AppNotification} from '../../../services/social';
import {makeI18n} from '../../../i18n';
import {soundEngine} from '../../../services/soundEngine';

const SOON = new Date(Date.now() + 40 * 60_000).toISOString();
const RUNNING = {id: 3, schedule_key: 'blitz-3+2', base_time_ms: 180000, increment_ms: 2000, starts_at: new Date().toISOString(),
    ends_at: SOON, status: 'running'};

function Probe() {
    const location = useLocation();
    return <pre data-testid="probe">{location.pathname}</pre>;
}

function routes(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/arenas" element={<ArenasPage/>}/>
                <Route path="/arenas/:arenaId" element={<ArenaPage/>}/>
                <Route path="/" element={<Probe/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    setToken('jwt');
    vi.useFakeTimers({shouldAdvanceTime: true});
});
afterEach(() => {
    setToken(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('арены', () => {
    it('время и контроль', () => {
        expect(controlLabel({base_time_ms: 180000, increment_ms: 2000})).toBe('3+2');
        expect(clock(125)).toBe('2:05');
        expect(clock(3725)).toBe('1:02:05');
        expect(secondsUntil(new Date(1000).toISOString(), 5000)).toBe(0);
    });

    it('список арен', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({arenas: [{...RUNNING, players: 12}]})} as Response)));
        routes('/arenas');
        expect(await screen.findByTestId('arena-3')).toHaveTextContent('Арена 3+2');
        expect(screen.getByTestId('arena-3')).toHaveTextContent('игроков: 12');
    });

    it('вход, поиск с повтором и переход на доску, когда партия создана', async () => {
        let joined = false;
        let readyCalls = 0;
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            let body: unknown;
            if (u.endsWith('/join')) {
                joined = true;
                body = {joined: true};
            } else if (u.endsWith('/ready')) {
                readyCalls += 1;
                body = readyCalls < 2 ? {waiting: true} : {game_id: 77};
            } else {
                body = {...RUNNING, standings: [{place: 1, username: 'magnus', score: 6, games: 3, wins: 3, fire: true, rating: 2800}],
                    me: {joined, waiting: false, current_game_id: null}};
            }
            return {ok: true, status: 200, json: async () => body, method: init?.method} as unknown as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        routes('/arenas/3');
        expect(await screen.findByTestId('arena-standings')).toHaveTextContent('magnus');
        expect(screen.getByLabelText('Огонь: очки удваиваются')).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByTestId('arena-join')));
        fireEvent.click(await screen.findByTestId('arena-play'));
        expect(await screen.findByTestId('arena-searching')).toBeInTheDocument();
        await act(async () => {
            vi.advanceTimersByTime(WAIT_POLL_MS + 100);
        });
        expect(await screen.findByTestId('probe')).toHaveTextContent('/');
        expect(readyCalls).toBeGreaterThanOrEqual(2);
    });

    it('анонс в лобби', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({arena: RUNNING})} as Response)));
        render(<MemoryRouter><ArenaBanner/></MemoryRouter>);
        expect(await screen.findByTestId('arena-banner')).toHaveAttribute('href', '/arenas/3');
    });
});

describe('швейцарка между людьми', () => {
    it('название с турами, «тур N из M», кнопки «Играть» нет — партия откроется сама', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({
            ...RUNNING, format: 'swiss', rounds: 5, current_round: 2, standings: [],
            me: {joined: true, waiting: false, current_game_id: null},
        })} as Response)));
        routes('/arenas/3');
        expect(await screen.findByText('Швейцарка 3+2, 5 туров')).toBeInTheDocument();
        expect(screen.getByTestId('arena-timing')).toHaveTextContent('тур 2 из 5');
        expect(screen.queryByTestId('arena-play')).toBeNull();
        expect(screen.getByTestId('swiss-waiting')).toBeInTheDocument();
    });
});

describe('честный конец арены (33.1)', () => {
    it('до последнего старта — отсчёт; после — доигрывание и без кнопки «Играть»; перформанс в таблице', async () => {
        const lastStart = new Date(Date.now() + 10 * 60_000).toISOString();
        const standings = [{place: 1, username: 'misha', score: 4, games: 2, wins: 2, fire: true, rating: 1500, performance: 1900}];
        let current: Record<string, unknown> = {...RUNNING, last_start_at: lastStart, open_games: 0, standings,
            me: {joined: true, waiting: false, current_game_id: null}};
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => current} as Response)));
        const view = routes('/arenas/3');
        expect(await screen.findByTestId('arena-timing')).toHaveTextContent('последний старт через 10:0');
        expect(screen.getByTestId('arena-play')).toBeInTheDocument();
        expect(screen.getByTestId('arena-perf-misha')).toHaveTextContent('1900');
        view.unmount();

        current = {...current, status: 'closing', open_games: 2};
        routes('/arenas/3');
        expect(await screen.findByTestId('arena-timing')).toHaveTextContent('доигрываются партии: 2');
        expect(screen.getByTestId('arena-closing')).toBeInTheDocument();
        expect(screen.queryByTestId('arena-play')).toBeNull();
    });
});

describe('берсерк (33.3)', () => {
    it('правило берсерка показано только там, где он доступен', async () => {
        let current: Record<string, unknown> = {...RUNNING, berserk: true, open_games: 0, standings: [], me: null};
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => current} as Response)));
        const view = routes('/arenas/3');
        expect(await screen.findByTestId('arena-berserk-rule')).toHaveTextContent('Берсерк');
        view.unmount();

        current = {...current, berserk: false};
        routes('/arenas/3');
        await screen.findByTestId('arena-timing');
        expect(screen.queryByTestId('arena-berserk-rule')).toBeNull();
    });
});

describe('расписание по конференциям и напоминания (33.4)', () => {
    const IN_TEN_MINUTES = new Date(Date.now() + 10 * 60_000).toISOString();
    const EVENING = {...RUNNING, id: 4, schedule_key: 'central:evening-5+3', base_time_ms: 300000, increment_ms: 3000,
        status: 'scheduled', starts_at: IN_TEN_MINUTES, conference: 'central', evening: true};

    it('в списке — конференция арены и «вечерняя»; неизвестная конференция в название не попадает', async () => {
        const arenas = [{...EVENING, players: 0}, {...RUNNING, conference: 'northern', players: 3},
            {...RUNNING, id: 5, conference: 'lunar', players: 0}];
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({arenas})} as Response)));
        routes('/arenas');
        expect(await screen.findByTestId('arena-4')).toHaveTextContent('Вечерняя арена 5+3 · Центральная конференция');
        expect(screen.getByTestId('arena-3')).toHaveTextContent('Арена 3+2 · Северная конференция');
        expect(screen.getByTestId('arena-5')).toHaveTextContent(/^Арена 3\+2(?! ·)/);
        expect(screen.getByTestId('arenas-conference-note')).toHaveTextContent('пяти конференций');
    });

    it('анонс в лобби: короткое название и таймер до начала', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({arena: EVENING})} as Response)));
        render(<MemoryRouter><ArenaBanner/></MemoryRouter>);
        const banner = await screen.findByTestId('arena-banner');
        expect(banner).toHaveTextContent('Вечерняя арена 5+3');
        expect(banner).not.toHaveTextContent('конференция');
        expect(banner).toHaveTextContent(/начнётся через (10:00|9:5\d)/);
    });

    it('«напомнить» у ещё не начавшейся арены: запрос, отметка и отмена', async () => {
        let reminder = false;
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (u.endsWith('/remind')) {
                calls.push(init?.method ?? 'GET');
                reminder = init?.method === 'POST';
                return {ok: true, status: 200, json: async () => ({reminder})} as Response;
            }
            return {ok: true, status: 200, json: async () => ({...EVENING, standings: [],
                me: {joined: false, waiting: false, current_game_id: null, reminder}})} as Response;
        }));
        routes('/arenas/4');
        const button = await screen.findByTestId('arena-remind');
        await act(async () => fireEvent.click(button));
        expect(await screen.findByTestId('arena-reminder-on')).toHaveTextContent('Напомним перед началом');
        expect(screen.queryByTestId('arena-remind')).toBeNull();
        await act(async () => fireEvent.click(screen.getByTestId('arena-reminder-off')));
        expect(await screen.findByTestId('arena-remind')).toBeInTheDocument();
        expect(calls).toEqual(['POST', 'DELETE']);
    });

    it('у идущей арены напоминания нет; уведомление ведёт на страницу арены', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({...RUNNING, standings: [],
            me: {joined: true, waiting: false, current_game_id: null, reminder: false}})} as Response)));
        routes('/arenas/3');
        await screen.findByTestId('arena-play');
        expect(screen.queryByTestId('arena-remind')).toBeNull();

        const n = {id: 1, kind: 'arena_reminder', payload: {arena_id: 4, base_time_ms: 300000, increment_ms: 3000,
            starts_at: IN_TEN_MINUTES}, created_at: null, read: false} as AppNotification;
        expect(notificationLink(n)).toBe('/arenas/4');
        expect(notificationText(n, makeI18n('ru').t)).toBe('Арена 5+3 скоро начнётся');
        expect(notificationText(n, makeI18n('uk').t)).toBe('Арена 5+3 скоро почнеться');
        expect(notificationText(n, makeI18n('en').t)).toBe('Arena 5+3 is about to start');
    });

    it('призовое место (33.5): текст на трёх языках и ссылка на арену', () => {
        const n = {id: 2, kind: 'arena_podium', payload: {arena_id: 9, place: 2, category: 'blitz'},
            created_at: null, read: false} as AppNotification;
        expect(notificationLink(n)).toBe('/arenas/9');
        expect(notificationText(n, makeI18n('ru').t)).toBe('Вы заняли 2 место на арене — поздравляем!');
        expect(notificationText(n, makeI18n('uk').t)).toBe('Ви посіли 2 місце на арені — вітаємо!');
        expect(notificationText(n, makeI18n('en').t)).toBe('You took place 2 in the arena — congratulations!');
    });
});

describe('деления переполненной арены (33.2)', () => {
    it('название с делением; игрок в другом делении — переход туда', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            const u = String(url);
            const body = u.endsWith('/arenas/3')
                ? {...RUNNING, division: 1, standings: [], me: {joined: false, waiting: false, current_game_id: null, division_arena_id: 9}}
                : {...RUNNING, id: 9, division: 2, parent_id: 3, standings: [],
                    me: {joined: true, waiting: false, current_game_id: null, division_arena_id: null}};
            return {ok: true, status: 200, json: async () => body} as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        render(
            <MemoryRouter initialEntries={['/arenas/3']}>
                <Routes><Route path="/arenas/:arenaId" element={<ArenaPage/>}/></Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByRole('heading', {level: 1})).toHaveTextContent('Арена 3+2 · деление 2');
        expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/arenas/9'))).toBe(true);
    });
});

describe('месячная лига арен', () => {
    const row = (place: number, username: string, score: number) => ({place, username, score, best: score, arenas: 1});
    const league = (category: string) => ({
        season: '2026-11', category, categories: ['bullet', 'blitz'], players: 3,
        table: category === 'blitz' ? [row(1, 'magnus', 12), row(2, 'hikaru', 9)] : [],
        me: category === 'blitz' ? row(7, 'me', 2) : null,
    });

    it('таблица по категории, своя строка ниже первых мест и пустая лига', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            const match = /league\?category=(\w+)/.exec(url);
            const body = match ? league(match[1]) : {arenas: []};
            return {ok: true, status: 200, json: async () => body} as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        routes('/arenas');
        expect(await screen.findByTestId('league-row-1')).toHaveTextContent('magnus');
        expect(screen.getByTestId('league-me')).toHaveTextContent('7');
        expect(screen.getByTestId('arena-league')).toHaveTextContent('Сезон 2026-11');
        await act(async () => fireEvent.click(screen.getByTestId('league-category-bullet')));
        expect(await screen.findByText('В этом месяце в аренах ещё не играли')).toBeInTheDocument();
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/arenas/league?category=bullet'))).toBe(true);
    });
});

describe('праздник призёра арены', () => {
    afterEach(() => localStorage.clear());

    it('призёр окончательных итогов видит праздник один раз', async () => {
        vi.spyOn(soundEngine, 'playFanfare').mockImplementation(() => undefined);
        const body = {...RUNNING, id: 9, status: 'finished',
            standings: [{place: 1, username: 'me', score: 8, games: 4, wins: 4, fire: false, rating: 1600},
                {place: 2, username: 'magnus', score: 6, games: 3, wins: 3, fire: false, rating: 2800}],
            me: {joined: true, waiting: false, current_game_id: null, podium_place: 1}};
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => body} as Response)));
        const view = routes('/arenas/9');
        expect(await screen.findByTestId('tournament-celebration')).toBeInTheDocument();
        expect(screen.getByText('Место 1 из 2')).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByTestId('celebration-close')));
        expect(screen.queryByTestId('tournament-celebration')).not.toBeInTheDocument();
        view.unmount();
        routes('/arenas/9');
        expect(await screen.findByTestId('arena-standings')).toBeInTheDocument();
        expect(screen.queryByTestId('tournament-celebration')).not.toBeInTheDocument();
    });

    it('не сыграл ни партии — экрана итогов нет', async () => {
        const body = {...RUNNING, id: 10, status: 'finished', standings: [],
            me: {username: 'me', joined: true, waiting: false, current_game_id: null, podium_place: null}};
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => body} as Response)));
        routes('/arenas/10');
        expect(await screen.findByTestId('arena-page')).toBeInTheDocument();
        expect(screen.queryByTestId('tournament-celebration')).not.toBeInTheDocument();
    });

    it('сыгравший вне тройки видит итоги: свою строку в таблице, перформанс и общий зачёт', async () => {
        const standing = (place: number, username: string, games: number) => ({
            place, username, score: 10 - place, games, wins: 1, fire: false, rating: 1500 + place, performance: 1700,
        });
        const body = {...RUNNING, id: 11, status: 'finished',
            standings: [standing(1, 'a', 4), standing(2, 'b', 4), standing(3, 'c', 4), standing(4, 'me', 3)],
            me: {username: 'me', joined: true, waiting: false, current_game_id: null, podium_place: null}};
        vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => body} as Response)));
        routes('/arenas/11');
        expect(await screen.findByTestId('celebration-title')).toHaveTextContent('Турнир завершён');
        expect(screen.getByTestId('celebration-row-me')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByTestId('celebration-detail-me')).toHaveTextContent('перф. 1700');
        expect(screen.getByText('Место 4 из 4')).toBeInTheDocument();
    });
});
