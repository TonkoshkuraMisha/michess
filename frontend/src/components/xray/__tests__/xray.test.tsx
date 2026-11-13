// Рентген доски (таск 12.1): слой на доске и панель режимов.

import {act, fireEvent, render, renderHook, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {XrayOverlay} from '../XrayOverlay';
import {XrayPanel} from '../XrayPanel';
import {useXraySettings} from '../useXraySettings';
import type {XrayMode} from '../useXraySettings';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function overlay(fen: string, modes: XrayMode[], extra: { side?: 'w' | 'b'; selectedSquare?: string } = {}) {
    return render(<XrayOverlay fen={fen} side={extra.side ?? 'w'} modes={new Set(modes)} flipped={false}
                               selectedSquare={extra.selectedSquare}/>);
}

afterEach(() => localStorage.clear());

describe('XrayOverlay', () => {
    it('без режимов — ничего', () => {
        const {container} = overlay(START, []);
        expect(container.querySelector('svg')).toBeNull();
    });

    it('контроль: число перевеса на полях, пустые поля без отметки', () => {
        overlay(START, ['control']);
        expect(screen.getByTestId('xray-control-f3').textContent).toBe('+3');
        expect(screen.getByTestId('xray-control-f6').textContent).toBe('−3');
        expect(screen.queryByTestId('xray-control-e4')).toBeNull();
    });

    it('под ударом и перегрузка', () => {
        // Конь d4 и слон b1 защищены ладьёй d1 — не висят, но ладья перегружена.
        overlay('4k3/8/8/8/r2N4/8/8/rB1R2K1 w - - 0 1', ['hanging']);
        expect(screen.queryByTestId('xray-hanging-d4')).toBeNull();
        expect(screen.getByTestId('xray-overloaded-d1')).toBeTruthy();
        // Незащищённый конь под пешкой — висит.
        overlay('4k3/8/4p3/3N4/8/8/8/4K3 w - - 0 1', ['hanging']);
        expect(screen.getByTestId('xray-hanging-d5')).toBeTruthy();
    });

    it('взятия разной толщины, шах и мат', () => {
        overlay('6k1/5ppp/8/3n4/8/4N3/5PPP/R5K1 w - - 0 1', ['captures', 'checks']);
        expect(screen.getByTestId('xray-capture-winning').getAttribute('stroke-width')).toBe('2.4');
        expect(screen.getByTestId('xray-mate')).toBeTruthy();
    });

    it('связка, пешки и защиты', () => {
        overlay('4k3/p7/2n5/3P4/B7/8/5PPP/4K3 w - - 0 1', ['lines', 'pawns', 'defenses']);
        expect(screen.getByTestId('xray-pin')).toBeTruthy();
        expect(screen.getByTestId('xray-pawn-isolated-d5')).toBeTruthy();
        expect(screen.getByTestId('xray-pawn-passed-h2')).toBeTruthy();
        expect(screen.getAllByTestId('xray-defense').length).toBeGreaterThan(0);
    });

    it('за другую сторону — её взятия', () => {
        overlay('4k3/8/8/3n4/8/4N3/8/4K3 w - - 0 1', ['captures'], {side: 'b'});
        expect(screen.getByTestId('xray-capture-winning')).toBeTruthy();
    });

    it('безопасные и опасные поля выбранной фигуры', () => {
        overlay('4k3/8/8/8/3p4/8/8/4KN2 w - - 0 1', ['safety'], {selectedSquare: 'f1'});
        expect(screen.getByTestId('xray-danger-e3')).toBeTruthy();
        expect(screen.getByTestId('xray-safe-g3')).toBeTruthy();
    });

    it('все ходы', () => {
        const {container} = overlay(START, ['moves']);
        expect(container.querySelectorAll('svg > line')).toHaveLength(20);
    });
});

describe('XrayPanel и настройки', () => {
    it('режимы включаются по одному и запоминаются; легенда — у включённого', () => {
        const {result} = renderHook(() => useXraySettings());
        const {rerender} = render(<XrayPanel settings={result.current}/>);
        act(() => fireEvent.click(screen.getByTestId('xray-mode-control')));
        rerender(<XrayPanel settings={result.current}/>);
        expect(result.current.modes.has('control')).toBe(true);
        expect(JSON.parse(localStorage.getItem('michess_xray_modes') ?? '[]')).toEqual(['control']);
        expect(screen.getByText(/число — перевес нападающих/)).toBeTruthy();

        act(() => fireEvent.click(screen.getByTestId('xray-for-opponent')));
        rerender(<XrayPanel settings={result.current}/>);
        expect(result.current.forOpponent).toBe(true);

        const again = renderHook(() => useXraySettings());
        expect(again.result.current.modes.has('control')).toBe(true);
    });

    it('без выбора фигуры режима «безопасные поля» нет; испорченные настройки — пусто', () => {
        localStorage.setItem('michess_xray_modes', '{broken');
        const {result} = renderHook(() => useXraySettings());
        expect(result.current.modes.size).toBe(0);
        render(<XrayPanel settings={result.current} canSelect={false}/>);
        expect(screen.queryByTestId('xray-mode-safety')).toBeNull();
    });
});
