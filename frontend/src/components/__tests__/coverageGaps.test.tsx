// Покрытие фронтенда (таски 8.7 и 17.6): выпадашка оформления, история турниров, диплом, звуковой движок.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AppearancePickerDropdown} from '../chessboard/AppearancePickerDropdown';
import {TournamentHistory} from '../tournaments/TournamentHistory';
import {Diploma} from '../tournaments/Diploma';
import {BOARD_THEMES, PIECE_SETS} from '../../config/boardAppearance';
import {setToken} from '../../services/authToken';
import {SOUND_SETS, resolveMoveSound, soundEngine} from '../../services/soundEngine';

afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('выпадашка оформления доски', () => {
    function picker(isOpen: boolean) {
        const handlers = {
            onToggleOpen: vi.fn(), onClose: vi.fn(), onPieceSetChange: vi.fn(), onThemeChange: vi.fn(), onBoardSizeChange: vi.fn(),
        };
        render(<AppearancePickerDropdown isOpen={isOpen} activeTheme={BOARD_THEMES.walnut} pieceSetKey="merida"
                                         activePieceSetName="Мерида" activePieceSetShortName="Мерида" boardSize={560}
                                         responsiveBoardPx={560} {...handlers}/>);
        return handlers;
    }

    it('закрыта — только кнопка; щелчок открывает', () => {
        const h = picker(false);
        expect(screen.queryByText('Дуб')).toBeNull();
        fireEvent.click(screen.getByTitle('Выбрать комплект фигур, тему и размер доски'));
        expect(h.onToggleOpen).toHaveBeenCalled();
    });

    it('открыта — все наборы и доски, размер и «авто»', () => {
        const h = picker(true);
        expect(screen.getAllByRole('button').length).toBeGreaterThan(Object.keys(PIECE_SETS).length + Object.keys(BOARD_THEMES).length);
        fireEvent.click(screen.getByText('Дуб'));
        expect(h.onThemeChange).toHaveBeenCalledWith('oak');
        fireEvent.click(screen.getByTitle(PIECE_SETS.celtic.description));
        expect(h.onPieceSetChange).toHaveBeenCalledWith('celtic');
        const slider = screen.getByRole('slider');
        const middle = Math.round((Number(slider.getAttribute('min')) + Number(slider.getAttribute('max'))) / 2);
        fireEvent.change(slider, {target: {value: String(middle)}});
        expect(h.onBoardSizeChange).toHaveBeenCalledWith(middle);
        fireEvent.click(screen.getByText('Авто'));
        expect(h.onBoardSizeChange).toHaveBeenCalledTimes(2);
    });
});

describe('история турниров в профиле', () => {
    const tournaments = [
        {id: 1, format: 'round_robin', size: 4, status: 'finished', created_at: '2026-11-01', my_place: 2},
        {id: 2, format: 'swiss', size: 8, status: 'active', created_at: '2026-11-02', my_place: null},
    ];

    function stubApi(me: string) {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
            ok: true, status: 200, json: async () => (String(url).includes('/profile/me') ? {username: me} : tournaments),
        } as Response)));
    }

    it('свой профиль — список с местом и статусом, ссылки на турниры', async () => {
        setToken('jwt');
        stubApi('alice');
        render(<MemoryRouter><TournamentHistory username="alice"/></MemoryRouter>);
        const history = await screen.findByTestId('tournament-history');
        expect(history).toHaveTextContent('2 место из 4');
        expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/tournaments/1', '/tournaments/2']);
    });

    it('чужой профиль и гость — ничего', async () => {
        setToken('jwt');
        stubApi('bob');
        const {container} = render(<MemoryRouter><TournamentHistory username="alice"/></MemoryRouter>);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(container).toBeEmptyDOMElement();
        setToken(null);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        render(<MemoryRouter><TournamentHistory username="alice"/></MemoryRouter>);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('диплом призёра', () => {
    it('имя, место, медаль; печать открывает окно и печатает', () => {
        render(<Diploma name="alice" place={1} format="Круговой" size={4} date="15.11.2026"/>);
        const svg = screen.getByRole('img');
        expect(svg).toHaveTextContent('alice');
        expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('#d4a017');
        const win = {document: {write: vi.fn(), close: vi.fn()}, focus: vi.fn(), print: vi.fn()};
        vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
        fireEvent.click(screen.getByRole('button', {name: 'Печать'}));
        expect(win.document.write.mock.calls[0][0]).toContain('<svg');
        expect(win.print).toHaveBeenCalled();
    });

    it('сохранение в PNG: картинка рисуется на холсте и скачивается', () => {
        render(<Diploma name="alice" place={3} format="Швейцарская" size={8} date="15.11.2026"/>);
        URL.createObjectURL = vi.fn(() => 'blob:x');
        URL.revokeObjectURL = vi.fn();
        const images: { onload: (() => void) | null; src: string }[] = [];
        vi.stubGlobal('Image', class {
            onload: (() => void) | null = null;
            src = '';
            constructor() {
                images.push(this);
            }
        });
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA');
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        fireEvent.click(screen.getByRole('button', {name: 'Сохранить PNG'}));
        expect(images[0].src).toBe('blob:x');
        act(() => images[0].onload?.());
        expect(drawImage).toHaveBeenCalled();
        expect(click).toHaveBeenCalled();
    });
});

describe('звуковой движок', () => {
    function fakeAudio() {
        const param = () => ({setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn()});
        const node = () => ({connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: param(), gain: param(), Q: param(), type: '', buffer: null});
        const created = {osc: [] as { frequency: ReturnType<typeof param>; type: string }[]};
        class FakeContext {
            currentTime = 0;
            sampleRate = 8000;
            state = 'running';
            destination = {};
            createOscillator() {
                const osc = node();
                created.osc.push(osc);
                return osc;
            }
            createGain() { return node(); }
            createBiquadFilter() { return node(); }
            createBufferSource() { return node(); }
            createBuffer(_c: number, length: number) { return {getChannelData: () => new Float32Array(length)}; }
            resume() { return Promise.resolve(); }
        }
        vi.stubGlobal('AudioContext', FakeContext);
        return created;
    }

    it('все события звучат; без звука — тишина; набор звуков меняет высоту и тембр', () => {
        const created = fakeAudio();
        // Новый движок с подменённым AudioContext: модуль держит один экземпляр, контекст создаётся лениво.
        (soundEngine as unknown as { ctx: unknown }).ctx = null;
        soundEngine.setMuted(false);
        soundEngine.setSoundSet('wood');
        for (const event of ['move', 'capture', 'castle', 'check', 'promote', 'premove', 'illegal', 'start', 'chat', 'offer',
            'decline', 'low_time', 'victory', 'defeat', 'draw'] as const) {
            soundEngine.play(event);
        }
        const woodCount = created.osc.length;
        expect(woodCount).toBeGreaterThan(20);
        soundEngine.setMuted(true);
        soundEngine.play('victory');
        expect(created.osc.length).toBe(woodCount);
        expect(soundEngine.toggleMute()).toBe(false);
        soundEngine.setSoundSet('bright');
        soundEngine.play('chat');
        const last = created.osc[created.osc.length - 1];
        expect(last.type).toBe(SOUND_SETS.bright.wave);
        expect(last.frequency.setValueAtTime.mock.calls[0][0]).toBeCloseTo(880 * SOUND_SETS.bright.pitch);
        expect(localStorage.getItem('regence_sound_set')).toBe('bright');
        soundEngine.setSoundSet('wood');
    });

    it('звук хода по нотации', () => {
        expect(resolveMoveSound(null)).toBe('move');
        expect(resolveMoveSound('Qh7#')).toBe('move');   // вне обучения звука шаха нет
        expect(resolveMoveSound('e8=Q')).toBe('promote');
        expect(resolveMoveSound('O-O-O')).toBe('castle');
        expect(resolveMoveSound('Nxe5')).toBe('capture');
        expect(resolveMoveSound('e4')).toBe('move');
    });
});
