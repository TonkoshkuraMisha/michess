// Страница «Конфиденциальность» (таск 23.1): все пять разделов и заголовок берутся из каталога i18n.
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {PrivacyPage} from '../PrivacyPage';

describe('PrivacyPage', () => {
    it('показывает заголовок и пять разделов', () => {
        render(<PrivacyPage/>);
        expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Конфиденциальность');
        expect(screen.getAllByRole('heading', {level: 2})).toHaveLength(5);
        expect(screen.getByTestId('privacy-page')).toHaveTextContent('90 дней');
    });
});
