// «Инструменты» (таск 16.4): экспорт PGN, импорт FEN/PGN, редактор позиции, «Найти мат», переход в анализ.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {buildPgn, sansOf, STANDARD_FEN} from '../../../services/pgnExport';
import {fenOf, placementOf, positionProblem} from '../PositionEditor';
import {parseImport, ToolsPage} from '../ToolsPage';

const cell = (name: string) => document.querySelector(`[data-square="${name}"]`) as HTMLElement;

function Probe() {
    const location = useLocation();
    return <pre data-testid="probe">{JSON.stringify(location.state)}</pre>;
}

function renderTools() {
    return render(
        <MemoryRouter initialEntries={['/tools']}>
            <Routes>
                <Route path="/tools" element={<ToolsPage/>}/>
                <Route path="/" element={<Probe/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

function stub(mate: unknown = {found: true, mate_in: 1, line: ['a1a8'], san: ['Ra8#']}) {
    const fetchMock = vi.fn(async (url: string) => ({
        ok: true, status: 200,
        json: async () => (String(url).includes('find-mate') ? mate : {fen: '', opening: null, moves: [], games: []}),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('экспорт PGN', () => {
    it('ходы, значки и комментарии; своя позиция — с заголовками SetUp/FEN и номером хода чёрных', () => {
        const pgn = buildPgn({headers: {White: 'A', Black: 'B'}, result: '1-0',
            moves: [{san: 'e4'}, {san: 'e5', symbol: '?!', comment: 'слабее {d5}'}, {san: 'Qh5'}]});
        expect(pgn).toContain('[White "A"]');
        expect(pgn).toContain('[Result "1-0"]');
        expect(pgn).toContain('1. e4 e5?! {слабее d5} 2. Qh5 1-0');
        const custom = buildPgn({startFen: '6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 7', moves: [{san: 'Kf8'}, {san: 'Ra8#'}]});
        expect(custom).toContain('[FEN "6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 7"]');
        expect(custom).toContain('7... Kf8 8. Ra8# *');
        expect(sansOf(STANDARD_FEN, ['e2e4', 'e7e5'])).toEqual(['e4', 'e5']);
    });
});

describe('импорт', () => {
    it('FEN, PGN из начальной позиции и с заголовком FEN; мусор — null', () => {
        expect(parseImport('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')).toEqual({fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', moves: []});
        expect(parseImport('1. e4 e5 2. Nf3 *')).toEqual({fen: STANDARD_FEN, moves: ['e2e4', 'e7e5', 'g1f3']});
        const withFen = parseImport('[SetUp "1"]\n[FEN "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"]\n\n1. Ra8# 1-0');
        expect(withFen).toEqual({fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', moves: ['a1a8']});
        expect(parseImport('просто текст')).toBeNull();
    });

    it('загруженная линия — на доске; из своей позиции справочник не показывается', async () => {
        stub();
        renderTools();
        fireEvent.click(screen.getByTestId('tools-tab-import'));
        fireEvent.change(screen.getByTestId('tools-import-text'), {target: {value: '[FEN "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"]\n\n1. Ra8# 1-0'}});
        fireEvent.click(screen.getByTestId('tools-import'));
        expect(screen.getByTestId('tools-line')).toHaveTextContent('1. Ra8#');
        expect(screen.getByTestId('tools-explorer-custom')).toBeInTheDocument();
    });
});

describe('редактор позиции', () => {
    it('расстановка ↔ FEN, рокировки только при фигурах на местах', () => {
        const placement = placementOf(STANDARD_FEN);
        expect(fenOf(placement, 'w', 'KQkq')).toBe(STANDARD_FEN);
        delete placement.h1;
        expect(fenOf(placement, 'b', 'KQkq').split(' ').slice(1, 3)).toEqual(['b', 'Qkq']);
    });

    it('ошибки позиции', () => {
        const check = (fen: string) => positionProblem(placementOf(fen), fen);
        expect(check('8/8/8/8/8/8/8/4K3 w - - 0 1')).toBe('tools.editor.needKings');
        expect(check('4k3/8/8/8/8/8/8/P3K3 w - - 0 1')).toBe('tools.editor.pawnsOnEdge');
        expect(check('R3k3/8/8/8/8/8/8/4K3 w - - 0 1')).toBe('tools.editor.opponentInCheck');
        expect(check('R3k3/8/8/8/8/8/8/4K3 b - - 0 1')).toBeNull();
    });

    it('щелчки по доске ставят фигуры, корректную позицию можно взять на доску', () => {
        stub();
        renderTools();
        fireEvent.click(screen.getByTestId('tools-tab-editor'));
        fireEvent.click(screen.getByTestId('editor-clear'));
        expect(screen.getByTestId('editor-problem')).toHaveTextContent('по одному королю');
        fireEvent.click(screen.getByTestId('brush-K'));
        fireEvent.click(cell('g1'));
        fireEvent.click(screen.getByTestId('brush-k'));
        fireEvent.click(cell('g8'));
        fireEvent.click(screen.getByTestId('brush-R'));
        fireEvent.click(cell('a1'));
        expect(screen.getByTestId('editor-fen')).toHaveTextContent('6k1/8/8/8/8/8/8/R5K1 w - - 0 1');
        fireEvent.click(screen.getByTestId('editor-use'));
        expect(screen.getByTestId('tools-tab-board')).toHaveAttribute('aria-selected', 'true');
    });
});

describe('доска инструментов', () => {
    it('«Найти мат» показывает линию; «Анализ» передаёт позицию на главную доску', async () => {
        const fetchMock = stub();
        renderTools();
        await act(async () => fireEvent.click(screen.getByTestId('tools-mate-search')));
        expect(await screen.findByTestId('tools-mate-result')).toHaveTextContent('Мат в 1: Ra8#');
        const call = fetchMock.mock.calls.find(([u]) => String(u).includes('find-mate'))!;
        expect(JSON.parse(String((call as unknown as [string, RequestInit])[1].body))).toEqual({fen: STANDARD_FEN, moves: 3});
        fireEvent.click(screen.getByTestId('tools-analyze'));
        expect(screen.getByTestId('probe')).toHaveTextContent(STANDARD_FEN);
    });

    it('мата нет — понятное сообщение', async () => {
        stub({found: false, mate_in: null, line: [], san: []});
        renderTools();
        await act(async () => fireEvent.click(screen.getByTestId('tools-mate-search')));
        expect(await screen.findByTestId('tools-mate-result')).toHaveTextContent('Мата не длиннее 3 ходов нет.');
    });
});
