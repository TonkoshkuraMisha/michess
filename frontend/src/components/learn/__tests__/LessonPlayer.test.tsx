// Проигрыватель урока (таск 14.1): шаги, показ, «найдите ход» с откликами на неверные ходы и ответом соперника,
// вопрос с выбором, экзамен с подсчётом верных с первой попытки; страницы школы и сохранение прогресса.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setLanguage} from '../../../i18n';
import {lessonById} from '../../../content/lessons';
import {LessonPlayer} from '../LessonPlayer';
import {LearnPage, LessonPage} from '../LearnPage';

const lesson = lessonById('tactics-double-attack')!;

function square(sq: string): HTMLElement {
    const el = document.querySelector(`[data-square="${sq}"]`);
    if (!el) throw new Error(`no square ${sq}`);
    return el as HTMLElement;
}

function move(uci: string) {
    fireEvent.click(square(uci.slice(0, 2)));
    fireEvent.click(square(uci.slice(2, 4)));
}

const pieceOn = (sq: string) => square(sq).querySelector('img:not([aria-hidden])')?.getAttribute('alt') ?? null;

async function tick(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

const next = () => fireEvent.click(screen.getByRole('button', {name: /^(Next|Finish the lesson)$/}));

beforeEach(() => {
    setLanguage('en', {persist: false});
    localStorage.clear();
    vi.useFakeTimers({shouldAdvanceTime: true});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('LessonPlayer', () => {
    it('проходит урок целиком: показ, вопросы, экзамен', async () => {
        const onStep = vi.fn();
        const onFinish = vi.fn();
        render(<LessonPlayer lesson={lesson} onStep={onStep} onFinish={onFinish}/>);

        // 1. Объяснение со стрелками.
        expect(screen.getByTestId('lesson-counter')).toHaveTextContent('Step 1 of 6');
        expect(screen.getByTestId('board-arrow-c7e8')).toBeInTheDocument();
        next();

        // 2. Показ: конь прыгает на c7 и забирает ладью.
        expect(pieceOn('b5')).toBe('wn');
        await tick(8000);
        expect(pieceOn('a8')).toBe('wn');
        expect(screen.getByRole('button', {name: 'Show again'})).toBeEnabled();
        next();

        // 3. «Найдите ход»: свой отклик на ожидаемую ошибку, затем верный ход и ответ соперника.
        expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
        move('d5f6');
        expect(screen.getByTestId('lesson-feedback')).toHaveTextContent('the g7 pawn simply takes the knight');
        expect(pieceOn('d5')).toBe('wn');  // неверный ход не применяется
        move('d5e7');
        expect(screen.getByTestId('lesson-feedback')).toHaveTextContent('Check and an attack on the queen');
        await tick(700);
        expect(pieceOn('h8')).toBe('bk');
        expect(screen.getByText('Now continue the line.')).toBeInTheDocument();
        move('e7c8');
        expect(screen.getByTestId('lesson-feedback')).toHaveTextContent('The queen is won.');
        next();

        // 4. Вопрос с выбором: неверный вариант, потом верный.
        fireEvent.click(screen.getByRole('button', {name: 'The knight threatened checkmate.'}));
        expect(screen.getByTestId('lesson-feedback')).toHaveTextContent('No mate here');
        expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
        fireEvent.click(screen.getByRole('button', {name: /The check forced the king to move/}));
        next();

        // 5. Пешечная вилка с подсказкой.
        fireEvent.click(screen.getByRole('button', {name: 'Hint'}));
        expect(screen.getByTestId('puzzle-hint-d4')).toBeInTheDocument();
        move('d4d5');
        await tick(700);
        next();

        // 6. Итог и переход к экзамену.
        expect(screen.getByRole('button', {name: 'Finish the lesson'})).toBeEnabled();
        next();
        expect(onStep.mock.calls.map(([s]) => s)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(screen.getByTestId('lesson-exam-intro')).toHaveTextContent('3 control questions');
        fireEvent.click(screen.getByRole('button', {name: 'Start the exam'}));

        // Экзамен: первый вопрос верно, второй — с ошибкой, третий верно → 2 из 3.
        move('d1d8');
        await tick(700);
        move('d8a5');
        next();
        fireEvent.click(screen.getByRole('button', {name: '♘d6+'}));
        fireEvent.click(screen.getByRole('button', {name: '♘c7+'}));
        next();
        move('c3c4');
        next();

        expect(screen.getByTestId('lesson-exam-result')).toHaveTextContent('Exam result: 2 of 3');
        expect(onFinish).toHaveBeenCalledWith({examScore: 2, examTotal: 3});
    });

    it('продолжает урок с сохранённого шага и умеет вернуться назад', () => {
        render(<LessonPlayer lesson={lesson} initialStep={3}/>);
        expect(screen.getByTestId('lesson-counter')).toHaveTextContent('Step 4 of 6');
        fireEvent.click(screen.getByRole('button', {name: 'Back'}));
        expect(screen.getByTestId('lesson-counter')).toHaveTextContent('Step 3 of 6');
    });

    it('тексты урока — на языке игрока', () => {
        setLanguage('uk', {persist: false});
        render(<LessonPlayer lesson={lesson}/>);
        expect(screen.getByTestId('lesson-text')).toHaveTextContent('Подвійний удар — це хід');
        expect(screen.getByTestId('lesson-counter')).toHaveTextContent('Крок 1 з 6');
    });
});

describe('страницы школы', () => {
    function stubProgress(items: unknown[]) {
        const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => ({
            ok: true, status: 200,
            json: async () => (init?.method === 'PUT' ? {} : items),
        }) as Response);
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    it('список курсов показывает прогресс и результат экзамена', async () => {
        localStorage.setItem('token', 'jwt');
        stubProgress([{lesson_id: 'tactics-double-attack', step: 5, steps_total: 6, completed: true, exam_score: 2, exam_total: 3}]);
        render(<MemoryRouter><LearnPage/></MemoryRouter>);
        expect(await screen.findByText('Exam 2/3')).toBeInTheDocument();
        expect(screen.getByRole('link', {name: 'Go through again'})).toHaveAttribute('href', '/learn/tactics-double-attack');
    });

    it('без входа — урок доступен, но предупреждает, что прогресс не сохранится', () => {
        const fetchMock = stubProgress([]);
        render(<MemoryRouter><LearnPage/></MemoryRouter>);
        expect(screen.getByText('Log in to save your progress.')).toBeInTheDocument();
        expect(screen.getByRole('link', {name: 'Start'})).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('урок продолжается с сохранённого шага и сохраняет новые шаги', async () => {
        localStorage.setItem('token', 'jwt');
        const fetchMock = stubProgress([{lesson_id: 'tactics-double-attack', step: 2, steps_total: 6, completed: false, exam_score: null, exam_total: null}]);
        render(
            <MemoryRouter initialEntries={['/learn/tactics-double-attack']}>
                <Routes><Route path="/learn/:lessonId" element={<LessonPage/>}/></Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByTestId('lesson-counter')).toHaveTextContent('Step 3 of 6');
        await waitFor(() => {
            const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
            expect(put?.[0]).toMatch(/\/learn\/progress\/tactics-double-attack$/);
            expect(JSON.parse(String(put?.[1]?.body))).toEqual({step: 2, steps_total: 6});
        });
    });

    it('несуществующий урок', () => {
        stubProgress([]);
        render(
            <MemoryRouter initialEntries={['/learn/nope']}>
                <Routes><Route path="/learn/:lessonId" element={<LessonPage/>}/></Routes>
            </MemoryRouter>,
        );
        expect(screen.getByText('There is no such lesson.')).toBeInTheDocument();
    });
});
