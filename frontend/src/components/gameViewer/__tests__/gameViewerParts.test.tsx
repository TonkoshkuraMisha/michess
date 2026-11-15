// Части просмотра партии, вынесенные из GameViewer.tsx (таск 17.6): модель, навигация, оформление, запись ходов.

import {createRef} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {Chess} from 'chess.js';
import {describe, expect, it, vi} from 'vitest';
import {
    annotatedMoves, chartPoints, classificationBadgeClass, computeStaticWhiteEvalCp, criticalMoments, evalCpToWhitePercentage,
} from '../viewerModel';
import type {FullGameAnalysisReport, MoveEvaluationItem} from '../viewerModel';
import {NavigationControls} from '../NavigationControls';
import {ViewerAppearancePanel} from '../ViewerAppearancePanel';
import {MoveList} from '../MoveList';

const move = (ply: number, san: string, eval_cp: number, extra: Partial<MoveEvaluationItem> = {}): MoveEvaluationItem => ({
    ply, move_number: Math.ceil(ply / 2), color: ply % 2 ? 'white' : 'black', san, uci: '', eval_cp, eval_display: (eval_cp / 100).toFixed(1),
    mate: null, best_move_uci: null, cp_loss: 0, classification: 'Good', symbol: '', ...extra,
});

const side = {accuracy: 90, best: 1, good: 1, inaccuracies: 0, mistakes: 0, blunders: 0, avg_cp_loss: 10};
const REPORT = {
    game_id: 1, engine: 'test', white: side, black: side,
    moves: [move(1, 'e4', 30), move(2, 'e5', 25), move(3, 'Qh5', -150, {symbol: '?', classification: 'Mistake'}), move(4, 'Nc6', 2000)],
    summary: {turning_point_ply: 3, white: {worst_ply: 3}, black: {worst_ply: null}, missed: [{ply: 4}, {ply: 99}]},
} as unknown as FullGameAnalysisReport;

describe('модель просмотра', () => {
    it('оценка по материалу, мат и ничья', () => {
        expect(computeStaticWhiteEvalCp(new Chess())).toEqual({cp: 0, display: '0.0'});
        expect(computeStaticWhiteEvalCp(new Chess('4k3/8/8/8/8/8/8/3QK3 w - - 0 1')).display).toBe('+9.0');
        const mate = new Chess();
        for (const san of ['f3', 'e5', 'g4', 'Qh4#']) mate.move(san);
        expect(computeStaticWhiteEvalCp(mate)).toEqual({cp: -1000, display: '-M1'});
    });

    it('шкала оценки — 4–96%, середина 50%', () => {
        expect(evalCpToWhitePercentage(0)).toBe(50);
        expect(evalCpToWhitePercentage(5000)).toBe(96);
        expect(evalCpToWhitePercentage(-5000)).toBe(4);
        expect(classificationBadgeClass('Blunder')).toContain('rose');
        expect(classificationBadgeClass(undefined)).toContain('boxwood');
    });

    it('критические моменты: по одному на ход, только существующие, по порядку', () => {
        expect(criticalMoments(REPORT)).toEqual([{ply: 3, key: 'turning'}, {ply: 4, key: 'missed'}]);
        expect(criticalMoments({...REPORT, summary: null})).toEqual([]);
    });

    it('точки графика: пешки, обрезка ±10', () => {
        const points = chartPoints(REPORT);
        expect(points.map((p) => p.evalPawns)).toEqual([0.3, 0.25, -1.5, 10]);
        expect(points[2].label).toBe('2. Qh5');
        expect(chartPoints(null)).toEqual([]);
    });

    it('ходы для PGN с разбором: оценка, мат, текст наставника, без «!»', () => {
        const report = {...REPORT, moves: [move(1, 'e4', 30, {symbol: '!'}), move(2, 'e5', 0, {mate: -3, symbol: '?'})]};
        const result = annotatedMoves([{san: 'e4'}, {san: 'e5'}, {san: 'Nf3'}], report, (coach) => (coach ? 'x' : null));
        expect(result).toEqual([
            {san: 'e4', symbol: '', comment: '[%eval 0.30]'},
            {san: 'e5', symbol: '?', comment: '[%eval #-3]'},
            {san: 'Nf3', symbol: '', comment: null},
        ]);
    });
});

describe('навигация по партии', () => {
    it('кнопки ходят по партии и не дёргают при той же позиции', () => {
        const onGo = vi.fn();
        const onFlip = vi.fn();
        render(<NavigationControls viewIndex={1} total={4} onGo={onGo} onFlip={onFlip}/>);
        fireEvent.click(screen.getByLabelText('Начало партии'));
        fireEvent.click(screen.getByLabelText('Ход назад'));
        fireEvent.click(screen.getByLabelText('Ход вперёд'));
        fireEvent.click(screen.getByLabelText('Конец партии'));
        expect(onGo.mock.calls.map((c) => c[0])).toEqual([-1, 0, 2, 3]);
        fireEvent.click(screen.getByLabelText('Перевернуть доску'));
        expect(onFlip).toHaveBeenCalled();
    });

    it('в конце партии «вперёд» ничего не делает', () => {
        const onGo = vi.fn();
        render(<NavigationControls viewIndex={3} total={4} onGo={onGo} onFlip={vi.fn()}/>);
        fireEvent.click(screen.getByLabelText('Ход вперёд'));
        fireEvent.click(screen.getByLabelText('Конец партии'));
        expect(onGo).not.toHaveBeenCalled();
    });
});

describe('оформление в просмотре', () => {
    it('выбор фигур, доски и закрытие', () => {
        const h = {onPieceSetChange: vi.fn(), onThemeChange: vi.fn(), onClose: vi.fn()};
        render(<ViewerAppearancePanel pieceSetKey="merida" themeKey="walnut" {...h}/>);
        fireEvent.click(screen.getByRole('button', {name: 'Кельтский'}));
        fireEvent.click(screen.getByRole('button', {name: 'Дуб'}));
        fireEvent.click(screen.getByLabelText('Закрыть'));
        expect(h.onPieceSetChange).toHaveBeenCalledWith('celtic');
        expect(h.onThemeChange).toHaveBeenCalledWith('oak');
        expect(h.onClose).toHaveBeenCalled();
    });
});

describe('запись ходов', () => {
    it('символ разбора, оценка, значок личной задачи, выбор хода', () => {
        const onSelect = vi.fn();
        render(<MoveList pairs={[{moveNumber: 1, white: 'e4', black: 'e5', whiteIndex: 0, blackIndex: 1},
            {moveNumber: 2, white: 'Qh5', black: '', whiteIndex: 2, blackIndex: -1}]}
                         viewIndex={0} moves={REPORT.moves} personalPlies={new Set([3])} scrollRef={createRef<HTMLDivElement>()}
                         onSelect={onSelect}/>);
        expect(screen.getByTestId('personal-badge-3')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Qh5/})).toHaveTextContent('Qh5?');
        fireEvent.click(screen.getByRole('button', {name: /^e4/}));
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: /^e5/}));
        expect(onSelect).toHaveBeenCalledWith(1, 'e5');
    });
});
