// Память ботов на карточке (таски 32.1–32.2): сила против игроков и «помнит вас» со счётом.

import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {describe, expect, it, vi} from 'vitest';
import {HISTORICAL_BOTS} from '../../../config/champions';
import {scorePoints} from '../../../services/botCatalog';
import {HistoricalBotsPanel} from '../HistoricalBotsPanel';

function panel(extra: Partial<Parameters<typeof HistoricalBotsPanel>[0]> = {}) {
    return render(
        <MemoryRouter>
            <HistoricalBotsPanel selectedBotId="morphy" onSelectBot={vi.fn()} selectedBotProfile={HISTORICAL_BOTS.morphy}
                                 activeBot={null} activeBotProfile={null} gameId={null} gameOverResult={null}
                                 isBotThinking={false} botComment={null} onStartBotGame={vi.fn()}
                                 canStartFromPosition={false} startFromPosition={false} onStartFromPositionChange={vi.fn()}
                                 {...extra}/>
        </MemoryRouter>,
    );
}

describe('память ботов на карточке', () => {
    it('счёт с половинками', () => {
        expect([scorePoints(0), scorePoints(0.5), scorePoints(2.5), scorePoints(3)]).toEqual(['0', '½', '2½', '3']);
    });

    it('постоянный соперник: бот помнит и избегает проигранных вариантов', () => {
        panel({
            live: {morphy: {rating: 1980, games: 64}},
            rivals: {morphy: {bot_id: 'morphy', games: 3, bot_points: 0.5, remembers: true}},
        });
        expect(screen.getByTestId('bot-live-strength')).toHaveTextContent('Против игроков: 1980 (партий: 64)');
        const rivalry = screen.getByTestId('bot-rivalry');
        expect(rivalry).toHaveTextContent('помнит вас: партий 3, счёт 2½ : ½');
        expect(rivalry).toHaveTextContent('избегает вариантов');
    });

    it('одна партия — просто знакомство; без партий — строки нет', () => {
        const {unmount} = panel({rivals: {morphy: {bot_id: 'morphy', games: 1, bot_points: 1, remembers: false}}});
        expect(screen.getByTestId('bot-rivalry')).toHaveTextContent('Вы уже играли с');
        unmount();
        panel();
        expect(screen.queryByTestId('bot-rivalry')).toBeNull();
        expect(screen.queryByTestId('bot-live-strength')).toBeNull();
    });
});
