// --- FILE: frontend/src/components/__tests__/About.test.tsx ---
// Страница «О проекте»: каждый набор фигур и каждый портрет показан с автором и лицензией;
// сохранённый выбор убранного (несвободного) набора фигур переводится на свободный.

import {render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it} from 'vitest';
import About from '../About';
import {PIECE_SETS, getSavedPieceSetKey} from '../../config/boardAppearance';
import portraitCredits from '../../config/portraitCredits.json';

function renderAbout() {
    return render(
        <MemoryRouter>
            <About/>
        </MemoryRouter>,
    );
}

afterEach(() => {
    localStorage.clear();
});

describe('About', () => {
    it('называет движок, его лицензию и ссылку на исходный код', () => {
        renderAbout();
        expect(screen.getByText(/GNU GPL версии 3/)).toBeInTheDocument();
        expect(screen.getByRole('link', {name: /github\.com\/official-stockfish\/Stockfish/})).toBeInTheDocument();
    });

    it('показывает автора и лицензию каждого набора фигур из интерфейса', () => {
        renderAbout();
        const table = screen.getAllByRole('table')[0];
        for (const set of Object.values(PIECE_SETS)) {
            const row = within(table).getByText(set.shortName).closest('tr') as HTMLElement;
            expect(within(row).getByText(set.author)).toBeInTheDocument();
            expect(within(row).getByText(set.license)).toBeInTheDocument();
        }
    });

    it('показывает запись об источнике для каждого портрета', () => {
        renderAbout();
        const table = screen.getAllByRole('table')[1];
        const rows = within(table).getAllByRole('row');
        expect(rows).toHaveLength(Object.keys(portraitCredits).length + 1);
        // Имя шахматиста ведёт на страницу файла на Викискладе.
        const carlsen = within(table).getByRole('link', {name: 'Магнус Карлсен'});
        expect(carlsen.getAttribute('href')).toContain('commons.wikimedia.org');
    });
});

describe('наборы фигур', () => {
    it('в интерфейсе нет наборов с некоммерческой лицензией', () => {
        for (const set of Object.values(PIECE_SETS)) {
            expect(set.license).not.toMatch(/NC/i);
            expect(set.author).not.toBe('');
        }
    });

    it.each([
        ['maestro', 'fantasy'],
        ['alpha', 'merida'],
        ['cardinal', 'outline'],
        ['unknown-set', 'merida'],
    ])('сохранённый набор %s заменяется на %s', (saved, expected) => {
        localStorage.setItem('michess_piece_set', saved);
        expect(getSavedPieceSetKey()).toBe(expected);
    });
});
