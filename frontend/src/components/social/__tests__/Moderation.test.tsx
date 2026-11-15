// Модерация (таск 17.4): жалоба из профиля, жалоба на сообщение в чате, очередь модератора, апелляция.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {ModerationPage, ReportButton} from '../ModerationPage';
import {GameChatPanel} from '../../chessboard/GameChatPanel';

function stub(handler: (url: string, init?: RequestInit) => unknown) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({ok: true, status: 200, json: async () => handler(String(url), init)} as Response));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof stub>) =>
    (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([, init]) => init?.method === 'POST');

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('модерация', () => {
    it('жалоба на игрока из профиля', async () => {
        const fetchMock = stub(() => ({id: 1}));
        render(<ReportButton username="troll"/>);
        fireEvent.click(screen.getByTestId('report-open'));
        fireEvent.change(screen.getByTestId('report-reason'), {target: {value: 'cheating'}});
        await act(async () => fireEvent.submit(screen.getByTestId('report-form')));
        expect(JSON.parse(String(posts(fetchMock)[0][1].body))).toMatchObject({target: 'troll', kind: 'player', reason: 'cheating'});
        expect(screen.getByTestId('report-sent')).toBeInTheDocument();
    });

    it('жалоба на сообщение соперника в чате партии — с копией текста; на свои сообщения кнопки нет', async () => {
        const fetchMock = stub(() => ({id: 2}));
        render(<GameChatPanel messages={[{sender: 'troll', text: 'ты слабак', timestamp: 1}, {sender: 'me', text: 'спокойно', timestamp: 2}]} chatInput=""
                              onChatInputChange={vi.fn()} onSendMessage={vi.fn()} onSendPreset={vi.fn()} isSpectator={false}
                              onLeaveSpectate={vi.fn()} myName="me" gameId={77}/>);
        expect(screen.queryByTestId('report-message-1')).toBeNull();
        await act(async () => fireEvent.click(screen.getByTestId('report-message-0')));
        expect(JSON.parse(String(posts(fetchMock)[0][1].body))).toEqual({
            target: 'troll', kind: 'message', reason: 'abuse', message_text: 'ты слабак', game_id: 77,
        });
        expect(screen.getByText('Жалоба отправлена')).toBeInTheDocument();
    });

    it('очередь модератора и решение', async () => {
        const item = {id: 5, kind: 'message', reason: 'abuse', comment: null, message_text: 'ты слабак', game_id: 77, created_at: null,
            reporter: 'me', target: 'troll', target_is_cheater: false, target_trust: 100, reports_on_target: 3};
        const fetchMock = stub((url) => (url.endsWith('/me') ? {is_moderator: true, is_cheater: false, open_appeal: false, chat_banned_until: null}
            : url.endsWith('/queue') ? {reports: [item]} : {id: 5, action: 'chat_ban'}));
        render(<MemoryRouter><ModerationPage/></MemoryRouter>);
        expect(await screen.findByTestId('mod-item-5')).toHaveTextContent('ты слабак');
        expect(screen.getByTestId('mod-item-5')).toHaveTextContent('жалоб на игрока: 3');
        expect(screen.queryByTestId('act-5-mark_cheater')).toBeNull();   // на сообщение — без флага нечестной игры
        await act(async () => fireEvent.click(screen.getByTestId('act-5-chat_ban')));
        expect(posts(fetchMock)[0][0]).toContain('/reports/5/resolve');
    });

    it('апелляция для отмеченного игрока', async () => {
        const fetchMock = stub((url) => (url.endsWith('/me') ? {is_moderator: false, is_cheater: true, open_appeal: false, chat_banned_until: null} : {id: 9}));
        render(<MemoryRouter><ModerationPage/></MemoryRouter>);
        fireEvent.change(await screen.findByTestId('appeal-text'), {target: {value: 'играл сам'}});
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Подать апелляцию'})));
        expect(JSON.parse(String(posts(fetchMock)[0][1].body))).toEqual({comment: 'играл сам'});
    });
});
