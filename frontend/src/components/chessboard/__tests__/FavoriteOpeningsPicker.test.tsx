// Любимые дебюты соперника (таск 21.2): поиск по таблице, добавление до трёх, удаление, названия выбранных по позициям.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {useState} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {FavoriteOpeningsPicker, OpeningsLine} from '../FavoriteOpeningsPicker';

const RUY = {eco: 'C60', name: 'Ruy Lopez', epd: 'ruy', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']};
const ITALIAN = {eco: 'C50', name: 'Italian Game', epd: 'ita', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4']};
const SICILIAN = {eco: 'B20', name: 'Sicilian Defense', epd: 'sic', moves: ['e2e4', 'c7c5']};
const ALL = [RUY, ITALIAN, SICILIAN, {eco: 'D06', name: "Queen's Gambit", epd: 'qg', moves: ['d2d4', 'd7d5', 'c2c4']}];

function stub() {
    const mock = vi.fn(async (url: string) => {
        const params = new URL(String(url), 'http://x').searchParams;
        const epds = params.getAll('epd');
        const q = (params.get('q') ?? '').toLowerCase();
        const found = epds.length ? ALL.filter((o) => epds.includes(o.epd)) : ALL.filter((o) => o.name.toLowerCase().includes(q) || q === 'all');
        return {ok: true, json: async () => ({openings: found})} as Response;
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

function Harness() {
    const [value, setValue] = useState({white: [] as string[], black: ['sic']});
    return (
        <>
            <FavoriteOpeningsPicker white={value.white} black={value.black} onChange={(side, epds) => setValue((v) => ({...v, [side]: epds}))}/>
            <OpeningsLine white={value.white} black={value.black}/>
        </>
    );
}

const search = async (side: 'white' | 'black', text: string) => {
    fireEvent.change(screen.getByTestId(`openings-search-${side}`), {target: {value: text}});
    await act(async () => {
        vi.advanceTimersByTime(300);
    });
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('любимые дебюты', () => {
    it('выбранные показываются по названиям; поиск добавляет, до трёх; удаление', async () => {
        vi.useFakeTimers();
        stub();
        await act(async () => render(<Harness/>));
        expect(screen.getByTestId('openings-black')).toHaveTextContent('B20 Sicilian Defense');
        expect(screen.getByTestId('openings-line')).toHaveTextContent('♚ Sicilian Defense');

        await search('white', 'ruy');
        await act(async () => fireEvent.click(screen.getAllByTestId('opening-option-white')[0]));
        expect(screen.getByTestId('openings-white')).toHaveTextContent('C60 Ruy Lopez');
        expect(screen.getByTestId('openings-line')).toHaveTextContent('♔ Ruy Lopez · ♚ Sicilian Defense');

        await search('white', 'all');
        const options = screen.getAllByTestId('opening-option-white');
        expect(options[0]).toBeDisabled();  // уже выбран
        await act(async () => fireEvent.click(options[1]));
        await search('white', 'all');
        await act(async () => fireEvent.click(screen.getAllByTestId('opening-option-white')[3]));
        expect(screen.queryByTestId('openings-search-white')).toBeNull();  // три — больше нельзя

        await act(async () => fireEvent.click(screen.getByLabelText('Убрать Ruy Lopez')));
        expect(screen.getByTestId('openings-white')).not.toHaveTextContent('Ruy Lopez');
        expect(screen.getByTestId('openings-search-white')).toBeInTheDocument();
    });

    it('короткий запрос не ищет; без дебютов строки карточки нет', async () => {
        vi.useFakeTimers();
        const mock = stub();
        const {container} = await act(async () => render(<OpeningsLine/>));
        expect(container).toBeEmptyDOMElement();
        await act(async () => render(<FavoriteOpeningsPicker white={[]} black={[]} onChange={() => undefined}/>));
        await search('white', 'r');
        expect(mock).not.toHaveBeenCalled();
    });
});
