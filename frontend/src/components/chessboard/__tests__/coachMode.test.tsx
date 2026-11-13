// Игра с наставником (таск 11.3): когда предупреждать, проверка хода, «Переходить», совет и панель.

import {act, fireEvent, render, renderHook, screen, waitFor} from '@testing-library/react';
import {Chess} from 'chess.js';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    COACH_ENABLED_KEY, COACH_LEVEL_KEY, levelForRating, shouldWarn, useCoachMode,
} from '../hooks/useCoachMode';
import type {MoveCheck, UseCoachModeResult} from '../hooks/useCoachMode';
import {CoachPanel} from '../CoachPanel';
import {CoachArrowsOverlay, squareCenter} from '../CoachArrowsOverlay';
import {AuxBoard} from '../AuxBoard';

const BLUNDER: MoveCheck = {
    available: true, cp_loss: 280, classification: 'Blunder', symbol: '??', eval_before: 30, eval_after: -250,
    best_move_uci: 'e1g1', reply_uci: 'e8f7', missed_tactic: false,
    coach: {
        comment: [{key: 'coach.verdict.blunder.v1', params: {move: '♗xf7+'}}],
        arrows: [{from: 'e8', to: 'f7', kind: 'threat'}, {from: 'e1', to: 'g1', kind: 'best'}],
        highlights: [],
    },
};
const GOOD: MoveCheck = {...BLUNDER, cp_loss: 5, classification: 'Best', symbol: '!', eval_after: 25};

function stubFetch(body: unknown, ok = true) {
    const fetchMock = vi.fn(async () => ({ok, status: ok ? 200 : 503, json: async () => body}) as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => localStorage.setItem('token', 'jwt'));
afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('shouldWarn', () => {
    const check = (loss: number, extra: Partial<MoveCheck> = {}): MoveCheck =>
        ({available: true, cp_loss: loss, eval_after: 0, missed_tactic: false, ...extra});

    it('новичку — только о грубых ошибках', () => {
        expect(shouldWarn(check(320), 'novice')).toBe(true);
        expect(shouldWarn(check(180), 'novice')).toBe(false);
        expect(shouldWarn(check(80, {missed_tactic: true}), 'novice')).toBe(false);
    });

    it('любителю — об ошибках и пропущенных ударах', () => {
        expect(shouldWarn(check(150), 'amateur')).toBe(true);
        expect(shouldWarn(check(90), 'amateur')).toBe(false);
        expect(shouldWarn(check(60, {missed_tactic: true}), 'amateur')).toBe(true);
    });

    it('сильному — и о неточностях', () => {
        expect(shouldWarn(check(100), 'strong')).toBe(true);
        expect(shouldWarn(check(35, {missed_tactic: true}), 'strong')).toBe(true);
        expect(shouldWarn(check(60), 'strong')).toBe(false);
    });

    it('при решающем перевесе мелкие потери не тревожат, без движка — молчит', () => {
        expect(shouldWarn(check(300, {eval_after: 900}), 'strong')).toBe(false);
        expect(shouldWarn(check(600, {eval_after: 900}), 'strong')).toBe(true);
        expect(shouldWarn({available: false}, 'strong')).toBe(false);
    });

    it('уровень по рейтингу', () => {
        expect(levelForRating(900)).toBe('novice');
        expect(levelForRating(1500)).toBe('amateur');
        expect(levelForRating(2100)).toBe('strong');
    });
});

describe('useCoachMode', () => {
    const before = new Chess();
    const after = new Chess();
    after.move('f3');

    it('выключен — ход не проверяется', () => {
        const fetchMock = stubFetch(BLUNDER);
        const {result} = renderHook(() => useCoachMode(1500));
        act(() => result.current.onPlayerMove(before, before.fen(), 'f2f3', after.fen()));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.current.holdBot).toBe(false);
    });

    it('плохой ход: бот ждёт, «Почему?» даёт объяснение, «Переходить» возвращает позицию', async () => {
        localStorage.setItem(COACH_ENABLED_KEY, '1');
        const fetchMock = stubFetch(BLUNDER);
        const {result} = renderHook(() => useCoachMode(1500));
        act(() => result.current.onPlayerMove(before, before.fen(), 'f2f3', after.fen()));
        expect(result.current.holdBot).toBe(true);
        expect(result.current.assisted).toBe(true);
        await waitFor(() => expect(result.current.pending?.status).toBe('warning'));
        expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({fen: before.fen(), move: 'f2f3'});

        act(() => result.current.showWhy());
        expect(result.current.explanation?.arrows).toHaveLength(2);

        let restored: Chess | null = null;
        act(() => {
            restored = result.current.takeBack();
        });
        expect(restored).toBe(before);
        expect(result.current.pending).toBeNull();
        expect(result.current.holdBot).toBe(false);
        expect(result.current.explanation).toBeNull();
    });

    it('хороший ход — партия продолжается без предупреждения', async () => {
        localStorage.setItem(COACH_ENABLED_KEY, '1');
        stubFetch(GOOD);
        const {result} = renderHook(() => useCoachMode(1500));
        act(() => result.current.onPlayerMove(before, before.fen(), 'f2f3', after.fen()));
        await waitFor(() => expect(result.current.pending).toBeNull());
        expect(result.current.holdBot).toBe(false);
    });

    it('ответ к позиции, которой уже нет, отбрасывается', async () => {
        localStorage.setItem(COACH_ENABLED_KEY, '1');
        let release: (v: Response) => void = () => {};
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
            release = resolve;
        })));
        const {result} = renderHook(() => useCoachMode(1500));
        act(() => result.current.onPlayerMove(before, before.fen(), 'f2f3', after.fen()));
        act(() => result.current.keepMove());
        await act(async () => release({ok: true, status: 200, json: async () => BLUNDER} as Response));
        expect(result.current.pending).toBeNull();
    });

    it('сервер недоступен — ошибка, бот не зависает', async () => {
        localStorage.setItem(COACH_ENABLED_KEY, '1');
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline');
        }));
        const {result} = renderHook(() => useCoachMode(1500));
        act(() => result.current.onPlayerMove(before, before.fen(), 'f2f3', after.fen()));
        await waitFor(() => expect(result.current.pending).toBeNull());
        expect(result.current.error).toEqual({key: 'coachMode.unavailable'});
    });

    it('подсказка идёт по ступеням для одной позиции, новая позиция — снова с первой', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            const {step} = JSON.parse(String(init?.body));
            return {ok: true, status: 200, json: async () => ({
                step, final: step === 3, comment: [{key: 'coach.hint.quiet.v1'}], arrows: [], highlights: [],
            })} as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        const sentSteps = () => fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).step);
        const {result} = renderHook(() => useCoachMode(1500));
        for (let i = 0; i < 3; i++) await act(() => result.current.requestHint(before.fen()));
        expect(sentSteps()).toEqual([1, 2, 3]);
        expect(result.current.hintStep).toBe(3);
        expect(result.current.hintFinal).toBe(true);
        expect(result.current.hintsUsed).toBe(3);
        expect(result.current.assisted).toBe(true);

        act(() => result.current.clearOverlay());
        expect(result.current.hintStep).toBe(0);
        await act(() => result.current.requestHint(after.fen()));
        expect(sentSteps()[3]).toBe(1);

        act(() => result.current.reset());
        expect(result.current.hintsUsed).toBe(0);
        expect(result.current.assisted).toBe(false);
        expect(result.current.advice).toBeNull();
    });

    it('«Не согласен»: позиция и ход уходят на проверку, ход остаётся, бот не ждёт', async () => {
        localStorage.setItem(COACH_ENABLED_KEY, '1');
        const fetchMock = stubFetch(BLUNDER);
        const {result} = renderHook(() => useCoachMode(1500));
        act(() => result.current.onPlayerMove(before, before.fen(), 'f2f3', after.fen()));
        await waitFor(() => expect(result.current.pending?.status).toBe('warning'));
        act(() => result.current.dispute());
        expect(result.current.pending).toBeNull();
        expect(result.current.holdBot).toBe(false);
        expect(result.current.disputeSent).toBe(true);
        const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
        expect(url).toContain('/analysis/dispute');
        expect(JSON.parse(String(init.body))).toEqual({fen: before.fen(), move: 'f2f3', cp_loss: 280});
    });

    it('настройки запоминаются', () => {
        const {result} = renderHook(() => useCoachMode(900));
        expect(result.current.level).toBe('novice');
        act(() => {
            result.current.setEnabled(true);
            result.current.setLevel('strong');
        });
        expect(localStorage.getItem(COACH_ENABLED_KEY)).toBe('1');
        expect(localStorage.getItem(COACH_LEVEL_KEY)).toBe('strong');
        expect(result.current.level).toBe('strong');
    });
});

function fakeCoach(overrides: Partial<UseCoachModeResult> = {}): UseCoachModeResult {
    return {
        enabled: true, setEnabled: vi.fn(), level: 'amateur', setLevel: vi.fn(), pending: null, holdBot: false,
        explanation: null, showWhy: vi.fn(), keepMove: vi.fn(), takeBack: vi.fn(() => null),
        advice: null, adviceLoading: false, requestHint: vi.fn(async () => {}), hintStep: 0, hintFinal: false,
        hintsUsed: 2, dispute: vi.fn(), disputeSent: false, assisted: true,
        error: null, onPlayerMove: vi.fn(), reset: vi.fn(), clearOverlay: vi.fn(),
        ...overrides,
    };
}

describe('CoachPanel', () => {
    const props = {locked: false, inBotGame: true, canAdvise: true, onAdvice: vi.fn(), onTakeBack: vi.fn()};

    it('выключенный наставник — подсказка и переключатель', () => {
        const coach = fakeCoach({enabled: false});
        render(<CoachPanel coach={coach} {...props}/>);
        expect(screen.queryByTestId('coach-advice')).toBeNull();
        fireEvent.click(screen.getByTestId('coach-toggle'));
        expect(coach.setEnabled).toHaveBeenCalledWith(true);
    });

    it('совет, счётчик и отметка учебной партии', () => {
        const onAdvice = vi.fn();
        render(<CoachPanel coach={fakeCoach()} {...props} onAdvice={onAdvice}/>);
        expect(screen.getByTestId('coach-hints-used').textContent).toContain('2');
        expect(screen.getByTestId('coach-assisted')).toBeTruthy();
        fireEvent.click(screen.getByTestId('coach-advice'));
        expect(onAdvice).toHaveBeenCalled();
    });

    it('предупреждение: вердикт и три решения', () => {
        const coach = fakeCoach({pending: {status: 'warning', previousGame: new Chess(), fenBefore: 'x', uci: 'f2f3', fenAfter: 'y', check: BLUNDER}});
        const onTakeBack = vi.fn();
        render(<CoachPanel coach={coach} {...props} onTakeBack={onTakeBack}/>);
        expect(screen.getByRole('alert').textContent).toContain('грубая ошибка');
        fireEvent.click(screen.getByTestId('coach-why'));
        fireEvent.click(screen.getByTestId('coach-keep'));
        fireEvent.click(screen.getByTestId('coach-takeback'));
        fireEvent.click(screen.getByTestId('coach-dispute'));
        expect(coach.dispute).toHaveBeenCalled();
        expect(coach.showWhy).toHaveBeenCalled();
        expect(coach.keepMove).toHaveBeenCalled();
        expect(onTakeBack).toHaveBeenCalled();
    });

    it('объяснение — текстом с фигурной нотацией', () => {
        render(<CoachPanel coach={fakeCoach({explanation: BLUNDER.coach!})} {...props}/>);
        expect(screen.getByTestId('coach-text').textContent).toContain('♗xf7+');
    });

    it('в партии лестницы наставник заблокирован', () => {
        render(<CoachPanel coach={fakeCoach()} {...props} locked/>);
        expect((screen.getByTestId('coach-toggle') as HTMLInputElement).disabled).toBe(true);
        expect(screen.queryByTestId('coach-advice')).toBeNull();
    });
});

describe('CoachArrowsOverlay', () => {
    it('центры полей с учётом переворота', () => {
        expect(squareCenter('a1', false)).toEqual({x: 6.25, y: 93.75});
        expect(squareCenter('a1', true)).toEqual({x: 93.75, y: 6.25});
        expect(squareCenter('z9', false)).toBeNull();
    });

    it('рисует стрелки по видам, без стрелок — ничего', () => {
        const {container, rerender} = render(<CoachArrowsOverlay arrows={BLUNDER.coach!.arrows} flipped={false}/>);
        expect(screen.getByTestId('coach-arrow-threat')).toBeTruthy();
        expect(screen.getByTestId('coach-arrow-best')).toBeTruthy();
        rerender(<CoachArrowsOverlay arrows={[]} flipped={false}/>);
        expect(container.querySelector('svg')).toBeNull();
    });
});

describe('CoachPanel: ступени подсказки', () => {
    const props = {locked: false, inBotGame: true, canAdvise: true, onAdvice: vi.fn(), onTakeBack: vi.fn()};

    it('надпись кнопки следует за ступенью, после хода — кнопка неактивна', () => {
        const {rerender} = render(<CoachPanel coach={fakeCoach()} {...props}/>);
        expect(screen.getByTestId('coach-advice').textContent).toBe('Подсказка');
        rerender(<CoachPanel coach={fakeCoach({hintStep: 1})} {...props}/>);
        expect(screen.getByTestId('coach-advice').textContent).toBe('Какой фигурой?');
        rerender(<CoachPanel coach={fakeCoach({hintStep: 2})} {...props}/>);
        expect(screen.getByTestId('coach-advice').textContent).toBe('Показать ход');
        rerender(<CoachPanel coach={fakeCoach({hintStep: 3, hintFinal: true})} {...props}/>);
        expect((screen.getByTestId('coach-advice') as HTMLButtonElement).disabled).toBe(true);
    });

    it('спор отправлен — благодарность; вспомогательная доска — по кнопке', () => {
        const onToggleAux = vi.fn();
        render(
            <CoachPanel coach={fakeCoach({disputeSent: true})} {...props} auxOpen onToggleAux={onToggleAux}>
                <div data-testid="aux-child"/>
            </CoachPanel>,
        );
        expect(screen.getByTestId('coach-dispute-sent')).toBeTruthy();
        expect(screen.getByTestId('aux-child')).toBeTruthy();
        fireEvent.click(screen.getByTestId('aux-toggle'));
        expect(onToggleAux).toHaveBeenCalled();
    });
});

describe('CoachArrowsOverlay: подсветка', () => {
    it('рисует подсвеченное поле и без стрелок', () => {
        render(<CoachArrowsOverlay arrows={[]} highlights={['e5']} flipped={false}/>);
        expect(screen.getByTestId('coach-highlight-e5')).toBeTruthy();
    });
});

describe('AuxBoard', () => {
    const renderPiece = (piece: { type: string; color: string }) => <span>{`${piece.color}${piece.type}`}</span>;
    const auxSquare = (square: string) => document.querySelector(`[data-aux-square="${square}"]`) as HTMLElement;

    it('ходы за обе стороны, назад и возврат к позиции партии', () => {
        const onClose = vi.fn();
        render(<AuxBoard fen={new Chess().fen()} flipped={false} lightColor="#eee" darkColor="#555"
                         renderPiece={renderPiece} onClose={onClose}/>);
        fireEvent.click(auxSquare('e2'));
        fireEvent.click(auxSquare('e4'));
        fireEvent.click(auxSquare('e7'));
        fireEvent.click(auxSquare('e5'));
        expect(screen.getByTestId('aux-moves').textContent).toBe('e4 e5');
        expect(auxSquare('e4').textContent).toBe('wp');

        fireEvent.click(screen.getByTestId('aux-undo'));
        expect(screen.getByTestId('aux-moves').textContent).toBe('e4');
        fireEvent.click(screen.getByTestId('aux-reset'));
        expect(screen.queryByTestId('aux-moves')).toBeNull();
        expect(auxSquare('e2').textContent).toBe('wp');

        fireEvent.click(screen.getByTestId('aux-close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('чужой ход не выбирается, a1 — тёмное поле, переворот', () => {
        render(<AuxBoard fen={new Chess().fen()} flipped lightColor="#eee" darkColor="#555"
                         renderPiece={renderPiece} onClose={vi.fn()}/>);
        fireEvent.click(auxSquare('e7'));
        fireEvent.click(auxSquare('e5'));
        expect(screen.queryByTestId('aux-moves')).toBeNull();
        expect(auxSquare('a1').style.backgroundColor).toBe('rgb(85, 85, 85)');
        const squares = Array.from(document.querySelectorAll('[data-aux-square]')).map((el) => el.getAttribute('data-aux-square'));
        expect(squares[0]).toBe('h1');
    });
});
