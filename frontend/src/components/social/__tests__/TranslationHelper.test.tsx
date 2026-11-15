// Режим «помощник перевода» (таск 17.7): нажать кнопку, затем текст интерфейса → предложение с ключом в модерацию.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {setTranslationHelper} from '../../../services/profileSettings';
import {TranslationHelper} from '../TranslationHelper';

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    act(() => setTranslationHelper(false));
    vi.unstubAllGlobals();
});

function page(text: string) {
    return render(
        <MemoryRouter initialEntries={['/puzzles']}>
            <p data-testid="text">{text}</p>
            <TranslationHelper/>
        </MemoryRouter>,
    );
}

describe('помощник перевода', () => {
    it('выключен — кнопки нет', () => {
        page('Жалоба отправлена');
        expect(screen.queryByTestId('translation-pick')).toBeNull();
    });

    it('нажатие на текст находит ключ и отправляет предложение с языком и страницей', async () => {
        const fetchMock = vi.fn(async () => ({ok: true, status: 201, json: async () => ({id: 1})} as Response));
        vi.stubGlobal('fetch', fetchMock);
        act(() => setTranslationHelper(true));
        page('Жалоба отправлена');
        fireEvent.click(screen.getByTestId('translation-pick'));
        fireEvent.click(screen.getByTestId('text'));
        expect(screen.getByTestId('translation-key')).toHaveValue('moderation.reportSent');
        fireEvent.change(screen.getByTestId('translation-suggestion'), {target: {value: 'Жалоба принята'}});
        await act(async () => fireEvent.submit(screen.getByTestId('translation-form')));
        const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
        expect(url).toContain('/moderation/translations');
        expect(JSON.parse(String(init.body))).toEqual({
            language: 'ru', key: 'moderation.reportSent', current: 'Жалоба отправлена', suggestion: 'Жалоба принята', context: '/puzzles',
        });
        expect(screen.getByTestId('translation-sent')).toBeInTheDocument();
    });

    it('текст не из каталога — честно говорит об этом', () => {
        act(() => setTranslationHelper(true));
        page('magnus_1990');
        fireEvent.click(screen.getByTestId('translation-pick'));
        fireEvent.click(screen.getByTestId('text'));
        expect(screen.getByTestId('translation-not-found')).toBeInTheDocument();
    });
});
