// Студия разбора партии: загрузка PGN, навигация по ходам (кнопки и клавиатура), переворот
// доски, кэшированный и запрошенный анализ движком, ошибки загрузки и анализа.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import GameViewer from '../GameViewer';
import {setLanguage} from '../../i18n';

vi.mock('../../services/soundEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/soundEngine')>();
    return {
        ...actual,
        soundEngine: {play: vi.fn(), isMuted: vi.fn(() => true), toggleMute: vi.fn(() => false)},
    };
});

const FOOLS_MATE_PGN = [
    '[Event "Casual"]',
    '[Site "Michess"]',
    '[Date "2026.11.01"]',
    '[White "alice"]',
    '[Black "bob"]',
    '[WhiteElo "1500"]',
    '[BlackElo "1480"]',
    '[Result "0-1"]',
    '',
    '1. f3 e5 2. g4 Qh4# 0-1',
].join('\n');

const sideStats = (accuracy: number) => ({
    accuracy, best: 1, good: 0, inaccuracies: 0, mistakes: 1, blunders: 1, avg_cp_loss: 120,
});

const ANALYSIS = {
    game_id: 42,
    engine: 'Stockfish',
    white: sideStats(31.4),
    black: sideStats(97.2),
    moves: ['f3', 'e5', 'g4', 'Qh4#'].map((san, i) => ({
        ply: i + 1, move_number: Math.floor(i / 2) + 1, color: i % 2 ? 'black' : 'white', san, uci: '',
        eval_cp: -50 * i, eval_display: (-0.5 * i).toFixed(1), mate: null, best_move_uci: null,
        cp_loss: 0, classification: 'best', symbol: '',
    })),
};

type Reply = { ok: boolean; status?: number; body?: unknown; text?: string };

function stubApi({pgn, cached, analyze}: { pgn: Reply; cached?: Reply; analyze?: Reply }) {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        let reply: Reply = {ok: false, status: 404, body: {}};
        if (url.endsWith('/pgn')) reply = pgn;
        else if (url.includes('/analysis/game/')) reply = (init?.method === 'POST' ? analyze : cached) ?? reply;
        return {
            ok: reply.ok,
            status: reply.status ?? (reply.ok ? 200 : 500),
            json: async () => reply.body,
            text: async () => reply.text ?? '',
        } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const pieceOn = (square: string) =>
    document.querySelector(`[data-square="${square}"] img`)?.getAttribute('alt') ?? null;

/**
 * Позиция на доске после действия. Ждём, а не проверяем сразу: под нагрузкой (CI, замер покрытия) рендер
 * может отстать от клика, и мгновенная проверка изредка падала, хотя компонент работал верно.
 */
const expectPiece = (square: string, piece: string | null) =>
    waitFor(() => expect(pieceOn(square)).toBe(piece));

function renderViewer() {
    return render(
        <MemoryRouter initialEntries={['/game/42']}>
            <Routes>
                <Route path="/game/:gameId" element={<GameViewer/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', class {
        observe() {
        }

        unobserve() {
        }

        disconnect() {
        }
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GameViewer', () => {
    it('показывает игроков из PGN и финальную позицию', async () => {
        stubApi({pgn: {ok: true, text: FOOLS_MATE_PGN}});
        renderViewer();

        expect((await screen.findAllByText('alice')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('bob').length).toBeGreaterThan(0);
        expect(pieceOn('h4')).toBe('b q');
        expect(pieceOn('d8')).toBeNull();
        expect(screen.getByRole('button', {name: 'Компьютерный анализ'})).toBeInTheDocument();
    });

    it('кнопки навигации: начало, вперёд, назад, конец', async () => {
        stubApi({pgn: {ok: true, text: FOOLS_MATE_PGN}});
        renderViewer();
        await waitFor(() => expect(pieceOn('h4')).toBe('b q'));

        fireEvent.click(screen.getByTitle('Начало партии'));
        await expectPiece('d8', 'b q');
        await expectPiece('f2', 'w p');

        fireEvent.click(screen.getByTitle('Ход вперёд'));
        await expectPiece('f3', 'w p');
        await expectPiece('f2', null);

        fireEvent.click(screen.getByTitle('Конец партии'));
        await expectPiece('h4', 'b q');
        fireEvent.click(screen.getByTitle('Ход назад'));
        await expectPiece('d8', 'b q');
        await expectPiece('g4', 'w p');
    });

    it('стрелки клавиатуры листают ходы', async () => {
        stubApi({pgn: {ok: true, text: FOOLS_MATE_PGN}});
        renderViewer();
        await waitFor(() => expect(pieceOn('h4')).toBe('b q'));

        fireEvent.keyDown(window, {key: 'ArrowUp'});
        await expectPiece('f2', 'w p');
        fireEvent.keyDown(window, {key: 'ArrowRight'});
        await expectPiece('f3', 'w p');
        fireEvent.keyDown(window, {key: 'ArrowRight'});
        await expectPiece('e5', 'b p');
        fireEvent.keyDown(window, {key: 'ArrowLeft'});
        await expectPiece('e5', null);
        fireEvent.keyDown(window, {key: 'ArrowDown'});
        await expectPiece('h4', 'b q');
    });

    it('обработчик клавиш регистрируется один раз и видит загруженную партию без перерегистрации', async () => {
        // Раньше обработчик перерегистрировался после каждого рендера и читал историю из замыкания:
        // нажатие между отрисовкой загруженной партии и запуском эффекта видело пустую историю и терялось.
        const addListener = vi.spyOn(window, 'addEventListener');
        stubApi({pgn: {ok: true, text: FOOLS_MATE_PGN}});
        renderViewer();
        await waitFor(() => expect(pieceOn('h4')).toBe('b q'));

        fireEvent.keyDown(window, {key: 'ArrowUp'});
        await expectPiece('f2', 'w p');
        fireEvent.keyDown(window, {key: 'ArrowRight'});
        await expectPiece('f3', 'w p');

        const keydownRegistrations = addListener.mock.calls.filter(([type]) => type === 'keydown');
        expect(keydownRegistrations).toHaveLength(1);
        addListener.mockRestore();
    });

    it('переворот доски меняет порядок клеток', async () => {
        stubApi({pgn: {ok: true, text: FOOLS_MATE_PGN}});
        renderViewer();
        await waitFor(() => expect(pieceOn('h4')).toBe('b q'));

        const firstSquare = () => document.querySelector('[data-square]')?.getAttribute('data-square');
        expect(firstSquare()).toBe('a8');
        fireEvent.click(screen.getByTitle('Перевернуть доску'));
        expect(firstSquare()).toBe('h1');
    });

    it('кэшированный анализ показывается сразу, без запуска движка', async () => {
        const fetchMock = stubApi({pgn: {ok: true, text: FOOLS_MATE_PGN}, cached: {ok: true, body: ANALYSIS}});
        renderViewer();

        expect((await screen.findAllByText(/31\.4%/)).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/97\.2%/).length).toBeGreaterThan(0);
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    });

    it('комментарий наставника к ходу: текст, стрелки, подсветка и переключатель стрелок', async () => {
        const moves = ANALYSIS.moves.map((m) => ({...m}));
        moves[2] = {
            ...moves[2], classification: 'Blunder', cp_loss: 900,
            coach: {
                comment: [
                    {key: 'coach.verdict.blunder.v1', params: {move: 'g4'}},
                    {key: 'coach.threat.mate_in.v1', params: {n: 1, move: '♛h4#'}},
                    {key: 'coach.best.generic.v1', params: {move: '♘c3'}},
                    {key: 'coach.from.the.future.v9', params: {}},  // незнакомый ключ пропускается
                ],
                arrows: [{from: 'd8', to: 'h4', kind: 'threat'}, {from: 'b1', to: 'c3', kind: 'best'},
                         {from: 'z9', to: 'h4', kind: 'threat'}],
                highlights: [{square: 'e1', kind: 'target'}],
            },
        } as never;
        moves[3] = {...moves[3], coach: {comment: [{key: 'coach.good.checkmate.v1', params: {move: '♛h4#'}}]}} as never;
        stubApi({pgn: {ok: true, text: FOOLS_MATE_PGN}, cached: {ok: true, body: {...ANALYSIS, moves}}});
        renderViewer();

        // Конец партии — мат.
        expect(await screen.findByTestId('coach-comment')).toHaveTextContent('♛h4# — мат!');
        fireEvent.click(screen.getByTitle('Ход назад'));
        const comment = await screen.findByText(
            'g4 — грубая ошибка! Теперь у соперника мат в 1 х.: ♛h4#. Сильнее было ♘c3.',
        );
        expect(comment).toBeInTheDocument();
        expect(screen.getAllByTestId('coach-arrow-threat')).toHaveLength(1);  // стрелка с полем «z9» отброшена
        expect(screen.getAllByTestId('coach-arrow-best')).toHaveLength(1);
        expect(screen.getAllByTestId('coach-target')).toHaveLength(1);

        fireEvent.click(screen.getByRole('checkbox', {name: 'Стрелки наставника'}));
        expect(screen.queryByTestId('coach-arrow-threat')).not.toBeInTheDocument();
        expect(screen.queryByTestId('coach-target')).not.toBeInTheDocument();

        act(() => setLanguage('uk', {persist: false}));
        expect(screen.getByText('g4 — груба помилка! Тепер у суперника мат у 1 х.: ♛h4#. Сильніше було ♘c3.'))
            .toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Початок партії'));
        expect(screen.queryByTestId('coach-comment')).not.toBeInTheDocument();
    });

    it('кнопка анализа запускает движок с токеном и показывает точность', async () => {
        localStorage.setItem('token', 'jwt-abc');
        const fetchMock = stubApi({
            pgn: {ok: true, text: FOOLS_MATE_PGN},
            cached: {ok: false, status: 404, body: {detail: 'Not analysed'}},
            analyze: {ok: true, body: ANALYSIS},
        });
        renderViewer();

        fireEvent.click(await screen.findByRole('button', {name: 'Компьютерный анализ'}));

        expect((await screen.findAllByText(/31\.4%/)).length).toBeGreaterThan(0);
        const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
        expect(post?.[0]).toMatch(/\/api\/v1\/analysis\/game\/42$/);
        expect(post?.[1]?.headers).toEqual({Authorization: 'Bearer jwt-abc'});
    });

    it('ошибка анализа показывается текстом сервера', async () => {
        stubApi({
            pgn: {ok: true, text: FOOLS_MATE_PGN},
            analyze: {ok: false, status: 429, body: {detail: 'Слишком много запросов к движку'}},
        });
        renderViewer();

        fireEvent.click(await screen.findByRole('button', {name: 'Компьютерный анализ'}));

        expect(await screen.findByText('Слишком много запросов к движку')).toBeInTheDocument();
    });

    it('ошибка валидации (detail — список) не роняет страницу', async () => {
        stubApi({
            pgn: {ok: true, text: FOOLS_MATE_PGN},
            analyze: {
                ok: false, status: 422,
                body: {detail: [{type: 'int_parsing', loc: ['path', 'game_id'], msg: 'Input should be a valid integer', params: {}}]},
            },
        });
        renderViewer();

        fireEvent.click(await screen.findByRole('button', {name: 'Компьютерный анализ'}));

        expect(await screen.findByText('game_id: некорректное значение')).toBeInTheDocument();
    });

    it('пустой анализ партии с ходами — понятная ошибка вместо «100 %» без графика', async () => {
        const empty = {...ANALYSIS, white: sideStats(100), black: sideStats(100), moves: []};
        stubApi({
            pgn: {ok: true, text: FOOLS_MATE_PGN},
            cached: {ok: true, body: empty},
            analyze: {ok: true, body: empty},
        });
        renderViewer();

        // Пустой кэш не показывается — доступна кнопка запуска анализа.
        fireEvent.click(await screen.findByRole('button', {name: 'Компьютерный анализ'}));

        expect(await screen.findByText(/Сервер вернул пустой анализ/)).toBeInTheDocument();
        expect(screen.queryByText(/100(\.0)?%/)).toBeNull();
    });

    it('недоступный PGN — сообщение об ошибке', async () => {
        stubApi({pgn: {ok: false, status: 404}});
        renderViewer();

        expect(await screen.findByText('Не удалось загрузить данные партии')).toBeInTheDocument();
    });
});

describe('GameViewer: партия с произвольной позиции', () => {
    const FROM_POSITION_PGN = [
        '[Event "Historical Bot Match"]',
        '[White "Alice"]',
        '[Black "Bot"]',
        '[Result "1/2-1/2"]',
        '[SetUp "1"]',
        '[FEN "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 40"]',
        '',
        '40... Kf8 41. Rd8+ Ke7 1/2-1/2',
    ].join('\n');

    it('позиции восстанавливаются от начальной позиции партии, ходы нумеруются по ней', async () => {
        stubApi({pgn: {ok: true, text: FROM_POSITION_PGN}});
        renderViewer();

        // Финальная позиция: король на e7, ладья на d8 — а не обычная расстановка с этими ходами.
        await waitFor(() => expect(pieceOn('e7')).toBe('b k'));
        expect(pieceOn('d8')).toBe('w r');
        expect(pieceOn('e2')).toBeNull();
        expect(screen.getByText('40.')).toBeInTheDocument();
        expect(screen.getByText('41.')).toBeInTheDocument();
        expect(screen.getByText('…')).toBeInTheDocument();  // у 40-го хода нет хода белых

        // В начало партии — на доске позиция из FEN.
        fireEvent.keyDown(window, {key: 'ArrowUp'});
        await waitFor(() => expect(pieceOn('g8')).toBe('b k'));
        expect(pieceOn('d1')).toBe('w r');
    });

    it('пошаговая навигация идёт от позиции из FEN, первый ход — чёрных', async () => {
        stubApi({pgn: {ok: true, text: FROM_POSITION_PGN}});
        renderViewer();
        await waitFor(() => expect(pieceOn('e7')).toBe('b k'));
        fireEvent.keyDown(window, {key: 'ArrowUp'});
        await waitFor(() => expect(pieceOn('g8')).toBe('b k'));

        // 40... Kf8 — ходят чёрные, ладья белых ещё на d1.
        fireEvent.keyDown(window, {key: 'ArrowRight'});
        await waitFor(() => expect(pieceOn('f8')).toBe('b k'));
        expect(pieceOn('g8')).toBeNull();
        expect(pieceOn('d1')).toBe('w r');

        // 41. Rd8+
        fireEvent.keyDown(window, {key: 'ArrowRight'});
        await waitFor(() => expect(pieceOn('d8')).toBe('w r'));

        // Назад — снова позиция после хода чёрных.
        fireEvent.keyDown(window, {key: 'ArrowLeft'});
        await waitFor(() => expect(pieceOn('d1')).toBe('w r'));
        expect(pieceOn('f8')).toBe('b k');

        // Ход чёрных стоит в колонке чёрных: первая строка журнала — «40. … Kf8».
        const firstRow = screen.getByText('40.').parentElement as HTMLElement;
        const cells = Array.from(firstRow.children).map((el) => el.textContent?.trim());
        expect(cells[1]).toContain('…');
        expect(cells[2]).toContain('Kf8');
    });
});
