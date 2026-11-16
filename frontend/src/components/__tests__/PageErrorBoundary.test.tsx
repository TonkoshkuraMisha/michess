// Предохранитель страниц: ошибка отрисовки показывает сообщение вместо страницы, переход на другой адрес — сбрасывает.

import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {describe, expect, it, vi} from 'vitest';
import {PageErrorBoundary} from '../PageErrorBoundary';

function Broken({fail}: { fail: boolean }) {
    if (fail) throw new Error('boom');
    return <p data-testid="page-ok">ok</p>;
}

describe('предохранитель страниц', () => {
    it('сообщение вместо упавшей страницы и сброс на новом адресе', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const view = render(<MemoryRouter><PageErrorBoundary resetKey="/a"><Broken fail/></PageErrorBoundary></MemoryRouter>);
        expect(screen.getByTestId('page-error')).toHaveTextContent('На этой странице произошла ошибка');
        view.rerender(<MemoryRouter><PageErrorBoundary resetKey="/b"><Broken fail={false}/></PageErrorBoundary></MemoryRouter>);
        expect(screen.getByTestId('page-ok')).toBeInTheDocument();
        spy.mockRestore();
    });
});
