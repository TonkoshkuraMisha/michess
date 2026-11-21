// Экран окончания турнира (17.11, таблица — 21.11): кубок цвета места и фанфары у призёра, значок места без фанфар
// у остальных, таблица участников и сводка игрока, один раз на турнир, повтор кнопкой; и у доски после последней партии.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {soundEngine} from '../../../services/soundEngine';
import {markCelebrated, shouldCelebrate, TournamentCelebration} from '../TournamentCelebration';
import {TournamentGameBar} from '../TournamentGameBar';
import {TournamentView} from '../TournamentsPage';

const player = (seat: number, kind: string, place: number | null) => ({
    seat, kind, user_id: kind === 'user' ? 1 : null, bot_key: kind === 'bot' ? 'morphy' : null, personality_name: null,
    rating: 1500, place, eliminated_round: null, config: null,
});

function finished(myPlace: number) {
    return {
        id: 41, format: 'round_robin', size: 2, status: 'finished', base_time_ms: 300000, increment_ms: 0, current_round: 1,
        created_at: '2026-11-17T10:00:00Z', finished_at: '2026-11-17T11:00:00Z', my_seat: 1, withdrawn: false, event_key: null,
        players: [player(1, 'user', myPlace), player(2, 'bot', myPlace === 1 ? 2 : 1)],
        games: [{id: 31, round: 1, board: 1, stage: 'main', white_seat: 1, black_seat: 2, base_time_ms: 300000,
            increment_ms: 0, result: myPlace === 1 ? '1-0' : '0-1', game_id: 9}],
        standings: [{seat: 1, points: myPlace === 1 ? 1 : 0, head_to_head: 0, sonneborn_berger: 0, place: myPlace},
            {seat: 2, points: myPlace === 1 ? 0 : 1, head_to_head: 0, sonneborn_berger: 0, place: myPlace === 1 ? 2 : 1}],
    };
}

function stub(body: unknown) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
        ok: true, status: 200, json: async () => (String(url).includes('/profile/me') ? {username: 'misha'} : body),
    }) as Response));
}

beforeEach(() => {
    setToken('jwt');
    localStorage.clear();
});
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('праздник призёра', () => {
    it('кубок цвета места, название турнира, фанфары; закрывается кнопкой и Escape', () => {
        const fanfare = vi.spyOn(soundEngine, 'playFanfare').mockImplementation(() => undefined);
        const onClose = vi.fn();
        const {unmount} = render(<TournamentCelebration place={1} title="Киев 1903" size={14} onClose={onClose}/>);
        expect(screen.getByTestId('celebration-title')).toHaveTextContent('Чемпион!');
        expect(screen.getByTestId('celebration-trophy-1')).toBeInTheDocument();
        expect(screen.getByTestId('celebration-subtitle')).toHaveTextContent('Киев 1903');
        expect(screen.getByTestId('tournament-celebration')).toHaveTextContent('Место 1 из 14');
        expect(fanfare).toHaveBeenCalledWith(1);
        fireEvent.keyDown(window, {key: 'Escape'});
        fireEvent.click(screen.getByTestId('celebration-close'));
        expect(onClose).toHaveBeenCalledTimes(2);
        unmount();
        render(<TournamentCelebration place={3} title="x" size={8} onClose={onClose}/>);
        expect(screen.getByTestId('celebration-title')).toHaveTextContent('Бронза!');
        expect(screen.getByTestId('celebration-trophy-3')).toBeInTheDocument();
    });

    it('один раз на турнир', () => {
        expect(shouldCelebrate(41)).toBe(true);
        markCelebrated(41);
        expect(shouldCelebrate(41)).toBe(false);
        expect(shouldCelebrate(42)).toBe(true);
    });

    it('страница турнира: экран при первом взгляде, повтор кнопкой; вне тройки — значок места без фанфар', async () => {
        vi.spyOn(soundEngine, 'playFanfare').mockImplementation(() => undefined);
        stub(finished(2));
        const view = render(<MemoryRouter initialEntries={['/tournaments/41']}><Routes>
            <Route path="/tournaments/:tournamentId" element={<TournamentView/>}/>
        </Routes></MemoryRouter>);
        expect(await screen.findByTestId('celebration-title')).toHaveTextContent('Серебро!');
        fireEvent.click(screen.getByTestId('celebration-close'));
        expect(screen.queryByTestId('tournament-celebration')).toBeNull();
        expect(shouldCelebrate(41)).toBe(false);
        fireEvent.click(screen.getByTestId('celebrate-again'));
        expect(screen.getByTestId('tournament-celebration')).toBeInTheDocument();
        view.unmount();

        localStorage.clear();
        const fanfare = vi.spyOn(soundEngine, 'playFanfare').mockClear();
        stub(finished(5));
        render(<MemoryRouter initialEntries={['/tournaments/41']}><Routes>
            <Route path="/tournaments/:tournamentId" element={<TournamentView/>}/>
        </Routes></MemoryRouter>);
        expect(await screen.findByTestId('celebration-title')).toHaveTextContent('Турнир завершён');
        expect(screen.getByTestId('celebration-badge')).toHaveTextContent('5');
        expect(screen.queryByTestId('celebration-confetti')).toBeNull();
        expect(fanfare).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('celebration-close'));
        expect(screen.getByTestId('celebrate-again')).toHaveTextContent('Итоги');
    });

    it('таблица участников и сводка: строка игрока подсвечена, рейтинги и очки на месте', () => {
        const rows = [
            {key: 1, place: 1, name: 'Морфи', rating: 2100, score: '2', mine: false},
            {key: 2, place: 2, name: 'misha', rating: 1500, score: '1,5', mine: true},
            {key: 3, place: 3, name: 'Андерсен', rating: null, score: '0,5', mine: false},
        ];
        render(<TournamentCelebration place={2} title="Круговой · 3" size={3} onClose={vi.fn()} rows={rows}
                                      stats={{points: '1,5', wins: 1, draws: 1, losses: 0, rating: 1500}}/>);
        expect(screen.getByTestId('celebration-row-2')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByTestId('celebration-row-1')).not.toHaveAttribute('aria-current');
        expect(screen.getByTestId('celebration-row-1')).toHaveTextContent('Морфи');
        expect(screen.getByTestId('celebration-row-1')).toHaveTextContent('2100');
        expect(screen.getByTestId('celebration-row-2')).toHaveTextContent('1,5');
        expect(screen.getAllByTestId('player-avatar')).toHaveLength(3);
        expect(screen.getByTestId('celebration-stat-record')).toHaveTextContent('1/1/0');
        expect(screen.getByTestId('celebration-stat-rating')).toHaveTextContent('1500');
    });

    it('у доски: после последней партии, когда турнир закончен и игрок в тройке', async () => {
        vi.spyOn(soundEngine, 'playFanfare').mockImplementation(() => undefined);
        stub(finished(1));
        render(<MemoryRouter><TournamentGameBar tournamentId={41} tournamentGameId={31} gameOver/></MemoryRouter>);
        await waitFor(() => expect(screen.getByTestId('celebration-title')).toHaveTextContent('Чемпион!'));
        await act(async () => fireEvent.click(screen.getByTestId('celebration-close')));
        expect(shouldCelebrate(41)).toBe(false);
    });
});
