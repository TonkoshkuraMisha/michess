// Курс матовых конструкций (таск 14.6): список, конструкция (объяснение → задачи), проверка на время.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {MateConstructionPage, MateCoursePage, MateExamPage, mateProgressId} from '../MateCourse';

const OVERVIEW = {
    tasks: 10, exam_size: 10, exam_minutes: 10,
    constructions: [{code: 'back_rank_mate', available: 2}, {code: 'pillsbury_mate', available: 0}],
};
// Чёрные уводят ладью с последней горизонтали; Ld8+ Le8 Lxe8#.
const TASK = {
    id: 11, fen: '4r1k1/5ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1', first_move: 'e8e2', rating: 1000,
    themes: ['back_rank_mate'], color: 'white', solution_length: 2, course: 'back_rank_mate', index: 0,
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

function stub(routes: [RegExp, (init?: RequestInit) => unknown][]) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const route = routes.find(([pattern]) => pattern.test(String(url)));
        if (!route) return {ok: true, status: 200, json: async () => []} as Response;
        return {ok: true, status: 200, json: async () => route[1](init)} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/learn/mates" element={<MateCoursePage/>}/>
                <Route path="/learn/mates/exam" element={<MateExamPage/>}/>
                <Route path="/learn/mates/:theme" element={<MateConstructionPage/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('Курс матовых конструкций', () => {
    it('список: конструкции с задачами — ссылки, без задач — «скоро»', async () => {
        stub([[/course\/mates$/, () => OVERVIEW]]);
        renderAt('/learn/mates');
        expect(await screen.findByTestId('mates-item-back_rank_mate')).toHaveAttribute('href', '/learn/mates/back_rank_mate');
        expect(screen.getByTestId('mates-item-pillsbury_mate')).toHaveTextContent('скоро');
        expect(screen.getByTestId('mates-exam-link')).toHaveTextContent('Итоговая проверка (10 мин)');
    });

    it('конструкция: объяснение, затем задача решается на сервере и прогресс сохраняется', async () => {
        const fetchMock = stub([
            [/course\/mates$/, () => OVERVIEW],
            [/\/demo/, () => ({theme: 'back_rank_mate', examples: []})],
            [/course\/mates\/back_rank_mate\/0$/, () => TASK],
            [/\/11\/move$/, (init) => {
                const move = JSON.parse(String(init?.body)).move;
                return move === 'd2d8'
                    ? {correct: true, done: false, reply: 'e2e8', solution: null, result: null}
                    : {correct: true, done: true, reply: null, solution: null, result: {solved: true}};
            }],
            [/learn\/progress\//, () => ({})],
        ]);
        renderAt('/learn/mates/back_rank_mate');
        expect(await screen.findByTestId('mates-explain', {}, {timeout: 5000})).toBeInTheDocument();
        fireEvent.click(await screen.findByTestId('mates-start', {}, {timeout: 5000}));
        expect(await screen.findByTestId('course-puzzle', {}, {timeout: 5000})).toBeInTheDocument();
        expect(screen.getByText('Белые начинают и ставят мат.')).toBeInTheDocument();
        // Ходы — только после ходов соперника на доске: под нагрузкой их задержка растягивается.
        const occupied = (sq: string) => waitFor(() => expect(cell(sq).querySelector('img')).not.toBeNull(), {timeout: 5000});
        await occupied('e2');
        await drag('d2', 'd8');
        await occupied('e8');
        await drag('d8', 'e8');
        expect(await screen.findByTestId('course-solved', {}, {timeout: 5000})).toBeInTheDocument();
        const put = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.includes('/learn/progress/'))!;
        expect(put[0]).toContain(mateProgressId('back_rank_mate'));
        expect(JSON.parse(String(put[1].body))).toMatchObject({step: 1, steps_total: 2, completed: false});
        expect(screen.getByTestId('mates-next')).toBeInTheDocument();
    }, 20_000);  // под нагрузкой (замер покрытия, CI) 5 с по умолчанию не хватало

    it('без входа курс просит войти', () => {
        setToken(null);
        stub([]);
        renderAt('/learn/mates');
        expect(screen.getByTestId('mates-login')).toBeInTheDocument();
    });

    it('проверка: время и номер задачи', async () => {
        stub([
            [/course\/mates\/exam$/, () => ({minutes: 10, tasks: [{theme: 'back_rank_mate', index: 1}]})],
            [/course\/mates\/back_rank_mate\/1$/, () => ({...TASK, index: 1})],
        ]);
        renderAt('/learn/mates/exam');
        fireEvent.click(screen.getByTestId('mates-exam-start'));
        expect(await screen.findByTestId('mates-exam-status')).toHaveTextContent('10:00');
        expect(screen.getByTestId('mates-exam-status')).toHaveTextContent('Задача 1 из 1');
    });
});
