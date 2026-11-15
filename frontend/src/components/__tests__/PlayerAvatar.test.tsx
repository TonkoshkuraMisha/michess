// Собственные аватары (таск 18.4): по имени, пока не выбран; выбор фигуры и фона; никаких внешних адресов.

import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {AvatarPicker, PlayerAvatar, avatarCode} from '../PlayerAvatar';

describe('аватары', () => {
    it('по имени — устойчиво и без внешних адресов; выбранный — как выбран; мусор — по имени', () => {
        expect(avatarCode('magnus')).toBe(avatarCode('Magnus'));
        expect(avatarCode('magnus')).toMatch(/^[wb][KQRBNP]-[0-7]$/);
        expect(avatarCode('magnus', 'bN-3')).toBe('bN-3');
        expect(avatarCode('magnus', 'https://evil/x.svg')).toBe(avatarCode('magnus'));
        render(<PlayerAvatar username="magnus" avatar="wQ-2"/>);
        const img = screen.getByTestId('player-avatar').querySelector('img')!;
        expect(img.getAttribute('src')).toBe('/assets/pieces/lewis/wQ.svg');
    });

    it('выбор: фигура сохраняет фон, фон сохраняет фигуру', () => {
        const onChange = vi.fn();
        render(<AvatarPicker username="magnus" value="wQ-2" onChange={onChange}/>);
        expect(screen.getByTestId('avatar-piece-wQ')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('avatar-piece-bN'));
        expect(onChange).toHaveBeenLastCalledWith('bN-2');
        fireEvent.click(screen.getByTestId('avatar-bg-5'));
        expect(onChange).toHaveBeenLastCalledWith('wQ-5');
    });
});
