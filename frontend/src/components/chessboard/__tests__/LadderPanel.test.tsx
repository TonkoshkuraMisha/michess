// Клубная лестница: прогресс игрока и старт партии со следующим соперником.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LadderPanel} from '../LadderPanel';
import {ladderOutcomeMessage} from '../hooks/useBotGame';
import {renderStatus} from '../status';
import {makeI18n} from '../../../i18n';

const STATE = {
    rating: 1032, games: 3, step: 1, total: 3, active_opponent: null,
    rungs: [
        {key: 'archetype:rusher', kind: 'archetype', id: 'rusher', rating: 640, measured: true, status: 'beaten'},
        {key: 'archetype:quiet', kind: 'archetype', id: 'quiet', rating: 900, measured: false, status: 'current'},
        {key: 'morphy', kind: 'historical', id: 'morphy', rating: 2050, measured: true, status: 'locked'},
    ],
};

const START = {
    opponent: {key: 'archetype:quiet', kind: 'archetype', id: 'quiet', rating: 900, bot_id: null, config: {}},
    color: 'black', step: 1, forfeited: null,
};

function stub() {
    const fetchMock = vi.fn(async (input: string | URL | Request) => ({
        ok: true, status: 200,
        json: async () => (String(input).endsWith('/start') ? START : STATE),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => localStorage.setItem('token', 'jwt'));
afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('LadderPanel', () => {
    it('показывает рейтинг, прогресс и ступени', async () => {
        stub();
        render(<LadderPanel playDisabled={false} onStart={vi.fn()} lastOutcome={null}/>);

        expect(await screen.findByTestId('ladder-rating')).toHaveTextContent('1032');
        expect(screen.getByText('1/3')).toBeInTheDocument();
        expect(screen.getByText('Следующий: Тихоня')).toBeInTheDocument();
        expect(screen.getByLabelText('пройден')).toBeInTheDocument();
        expect(screen.getByLabelText('закрыт')).toBeInTheDocument();
    });

    it('старт отправляет цвет и отдаёт соперника, выбранного сервером', async () => {
        const fetchMock = stub();
        const onStart = vi.fn();
        render(<LadderPanel playDisabled={false} onStart={onStart} lastOutcome={null}/>);

        const black = await screen.findByRole('button', {name: /Чёрными/});
        await act(async () => fireEvent.click(black));

        const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/bots/ladder/start')) as unknown as [string, RequestInit];
        expect(JSON.parse(String(call[1].body))).toEqual({color: 'black'});
        expect(onStart).toHaveBeenCalledWith(START);
    });

    it('пока идёт партия, начать новую нельзя', async () => {
        stub();
        render(<LadderPanel playDisabled onStart={vi.fn()} lastOutcome={null}/>);
        expect(await screen.findByRole('button', {name: /Белыми/})).toBeDisabled();
    });
});

describe('итог партии лестницы', () => {
    const base = {delta: 0, rating: 1000, step: 0, promoted: false, opponent: 'archetype:quiet'};

    const promoted = {...base, counted: true, reason: null, delta: 18, rating: 1018, promoted: true};

    it('засчитанная победа', () => {
        expect(renderStatus(ladderOutcomeMessage(promoted), makeI18n('ru').t))
            .toBe('Лестница: рейтинг 1018 (+18) — открыт следующий соперник!');
    });

    it('итог на всех трёх языках', () => {
        expect(renderStatus(ladderOutcomeMessage(promoted), makeI18n('en').t))
            .toBe('Ladder: rating 1018 (+18) — the next opponent is unlocked!');
        expect(renderStatus(ladderOutcomeMessage(promoted), makeI18n('uk').t))
            .toBe('Драбина: рейтинг 1018 (+18) — відкрито наступного суперника!');
        expect(renderStatus(ladderOutcomeMessage({...promoted, delta: -7, rating: 993, promoted: false}), makeI18n('en').t))
            .toBe('Ladder: rating 993 (-7).');
    });

    it('незасчитанная партия называет причину', () => {
        expect(renderStatus(ladderOutcomeMessage({...base, counted: false, reason: 'takeback'}), makeI18n('ru').t))
            .toBe('Партия не засчитана в лестницу: в партии был возврат хода.');
    });
});
