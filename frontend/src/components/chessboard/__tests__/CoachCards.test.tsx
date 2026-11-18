// «Клубный тренер» в итоге партии (план владельца 18.11, задача 5): правила выбора модуля курса и переспроса,
// три карточки в GameSummaryPanel, решение задачи из своей ошибки прямо в панели, ссылка на модуль курса.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {lessonModuleFor, POLL_ATTEMPTS, shouldPoll} from '../../../services/coachCards';
import type {AfterGameCards} from '../../../services/coachCards';
import type {CourseModule} from '../../../content/supercourse';
import {setToken} from '../../../services/authToken';
import {GameSummaryPanel} from '../GameSummaryPanel';

const REPORT = {white: {accuracy: 70}, black: {accuracy: 80}, moves: [], summary: null};
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
const CARDS: AfterGameCards = {
    game_id: 42, analysed: true,
    puzzle: {id: 7, game_id: 42, ply: 6, fen: FEN, previous_move: 'f1c4', color: 'black', themes: ['fork'],
             attempts: 0, solved_streak: 0},
    deviation: {repertoire_id: 3, name: 'Испанская', starter: null, kind: 'you_left', ply: 5, played: 'Bc4',
                played_uci: 'f1c4', expected: ['Bb5'], line: ['e2e4', 'e7e5', 'g1f3', 'b8c6'], position: 'p'},
    lesson_themes: ['no_such_theme', 'fork'],
};

const cell = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLElement;

async function drag(from: string, to: string) {
    document.elementsFromPoint = vi.fn(() => [cell(to)]);
    await act(async () => {
        fireEvent.pointerDown(cell(from), {button: 0, pointerType: 'mouse', clientX: 5, clientY: 5});
    });
    await act(async () => {
        fireEvent.pointerMove(window, {clientX: 50, clientY: 50});
    });
    await act(async () => {
        fireEvent.pointerUp(window, {clientX: 90, clientY: 90});
    });
}

/** fetch по адресу: разбор, карточки, ответ на задачу. */
function stubApi(cards: Partial<AfterGameCards> | null) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        calls.push(url);
        const body = url.includes('/analysis/game/') ? REPORT
            : url.includes('/learn/after-game/') ? cards
                : {correct: true, solution: 'g8f6', played: 'f8c5', done: false, solved_streak: 1, next_due_at: null};
        return {ok: true, status: 200, json: async () => body} as Response;
    }));
    return calls;
}

beforeEach(() => setToken('jwt'));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
});

describe('правила', () => {
    const course: CourseModule[] = [
        {code: 'T2.1', level: 2, branch: 'T', steps: [{kind: 'theme', id: 'fork'}]},
        {code: 'T1.1', level: 1, branch: 'T', steps: [{kind: 'theme', id: 'fork'}]},
        {code: 'T1.2', level: 1, branch: 'T', steps: [{kind: 'theme', id: 'pin'}]},
    ];

    it('урок — первая тема с модулем, модуль самого раннего уровня', () => {
        expect(lessonModuleFor(['skewer', 'fork', 'pin'], course)).toEqual({module: course[1], theme: 'fork'});
        expect(lessonModuleFor(['pin'], course)?.module.code).toBe('T1.2');
        expect(lessonModuleFor(['skewer'], course)).toBeNull();
        expect(lessonModuleFor([], course)).toBeNull();
    });

    it('переспрашивать — пока задачи нет и попытки не кончились', () => {
        const empty = {...CARDS, puzzle: null};
        expect(shouldPoll(empty, 0)).toBe(true);
        expect(shouldPoll(empty, POLL_ATTEMPTS)).toBe(false);
        expect(shouldPoll(CARDS, 0)).toBe(false);
        expect(shouldPoll(null, 0)).toBe(false);
    });
});

describe('карточки в итоге партии', () => {
    it('три карточки; задача решается в панели; урок ведёт в модуль курса', async () => {
        const calls = stubApi(CARDS);
        render(<MemoryRouter><GameSummaryPanel gameId={42} playerColor="black" recommendation={null} onPlayRecommended={vi.fn()}/></MemoryRouter>);
        await screen.findByTestId('coach-cards');
        expect(calls.some((url) => url.includes('/learn/after-game/42'))).toBe(true);
        expect(screen.getByTestId('coach-card-deviation').textContent).toContain('Bc4');
        const link = screen.getByTestId('coach-lesson-link');
        expect(link.getAttribute('href')).toBe('/learn/course?level=1&module=T1.1');
        expect(screen.getByTestId('coach-card-lesson').textContent).toContain('Вилка');

        fireEvent.click(screen.getByTestId('coach-solve'));
        await drag('g8', 'f6');
        await waitFor(() => expect(screen.getByTestId('coach-puzzle-result').textContent).toContain('Верно!'));
        expect(calls.some((url) => url.includes('/personal/7/answer'))).toBe(true);
    });

    it('нечего показать — блока нет; ответ без полей не ломает панель', async () => {
        stubApi({game_id: 42, analysed: false, puzzle: null, deviation: null, lesson_themes: []});
        const {unmount} = render(<MemoryRouter><GameSummaryPanel gameId={42} playerColor="white" recommendation={null} onPlayRecommended={vi.fn()}/></MemoryRouter>);
        await screen.findByTestId('summary-accuracy');
        expect(screen.queryByTestId('coach-cards')).toBeNull();
        unmount();
        stubApi({});
        render(<MemoryRouter><GameSummaryPanel gameId={43} playerColor="white" recommendation={null} onPlayRecommended={vi.fn()}/></MemoryRouter>);
        await screen.findByTestId('summary-accuracy');
        expect(screen.queryByTestId('coach-cards')).toBeNull();
    });
});
