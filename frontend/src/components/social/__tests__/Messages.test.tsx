// Личные сообщения (таск 30.1): распознавание вложений, переписка, отправка с карточкой, отказ, колокольчик.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {attachmentLink, detectAttachment} from '../../../services/messages';
import {MessagesPage} from '../MessagesPage';
import {NotificationBell} from '../SocialHeader';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

type Handler = (url: string, init?: RequestInit) => unknown;

function stubFetch(handler: Handler) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const body = handler(String(url), init);
        const failed = body instanceof Error;
        return {
            ok: !failed, status: failed ? 403 : 200,
            json: async () => (failed ? {detail: {code: body.message, params: {}, message: ''}} : body),
        } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function page(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/messages" element={<MessagesPage/>}/>
                <Route path="/messages/:username" element={<MessagesPage/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

const message = (id: number, mine: boolean, body: string, attachment: unknown = null) =>
    ({id, mine, body, attachment, created_at: '2026-11-17T10:00:00Z', read: true});

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('вложения', () => {
    it('ссылки и FEN распознаются, прочее — нет', () => {
        expect(detectAttachment('https://site.example/game/42')).toEqual({kind: 'game', ref: '42'});
        expect(detectAttachment('/tournaments/7?tab=table')).toEqual({kind: 'tournament', ref: '7'});
        expect(detectAttachment('https://site.example/learn/fork-basics')).toEqual({kind: 'lesson', ref: 'fork-basics'});
        expect(detectAttachment(`  ${START} `)).toEqual({kind: 'position', ref: START});
        expect(detectAttachment('8/8/8/8/8/8/8/8')).toEqual({kind: 'position', ref: '8/8/8/8/8/8/8/8'});
        expect(detectAttachment('привет')).toBeNull();
        expect(detectAttachment('/game/abc')).toBeNull();
        expect(attachmentLink({kind: 'game', ref: '42'})).toBe('/game/42');
        expect(attachmentLink({kind: 'position', ref: START})).toBeNull();
    });
});

describe('страница сообщений', () => {
    it('список переписок и пустое состояние', async () => {
        stubFetch((url) => {
            if (url.endsWith('/settings')) return {dm_policy: 'all', blocked: []};
            return {
                unread: 1, conversations: [{username: 'magnus', avatar: null, unread: 1, blocked: false,
                    last: message(3, false, '', {kind: 'puzzle', ref: '5', fen: START, rating: 1500})}],
            };
        });
        page('/messages');
        const list = await screen.findByTestId('dm-conversations');
        expect(list).toHaveTextContent('magnus');
        expect(list).toHaveTextContent('новых: 1');
        expect(list).toHaveTextContent('Задача');
        expect(screen.getByText('Выберите переписку слева.')).toBeInTheDocument();
        expect(await screen.findByTestId('dm-policy')).toHaveValue('all');
    });

    it('переписка, отправка текста с карточкой партии', async () => {
        const fetchMock = stubFetch((url, init) => {
            if (url.endsWith('/settings')) return {dm_policy: 'all', blocked: []};
            if (url.includes('/with/magnus') && init?.method === 'POST') {
                const sent = JSON.parse(String(init.body));
                return message(10, true, sent.body, {kind: 'game', ref: '42', white: 'me', black: 'magnus', result: '1-0'});
            }
            if (url.includes('/with/magnus')) {
                return {username: 'magnus', avatar: null, can_write: true, reason: null, blocked: false,
                    messages: [message(1, false, 'Привет!'), message(2, true, '', {kind: 'position', ref: START})]};
            }
            return {unread: 0, conversations: []};
        });
        page('/messages/magnus');
        expect(await screen.findByTestId('dm-theirs')).toHaveTextContent('Привет!');
        expect(screen.getByTestId('attachment-position')).toBeInTheDocument();
        expect(screen.getByTestId('mini-diagram')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('dm-attach-toggle'));
        fireEvent.change(screen.getByTestId('dm-attach-ref'), {target: {value: 'https://x.example/game/42'}});
        expect(screen.getByTestId('dm-attach-kind')).toHaveValue('game');
        fireEvent.change(screen.getByTestId('dm-input'), {target: {value: 'Смотри партию'}});
        await act(async () => fireEvent.keyDown(screen.getByTestId('dm-input'), {key: 'Enter'}));

        const post = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/with/magnus') && i?.method === 'POST');
        expect(JSON.parse(String(post?.[1]?.body))).toEqual({body: 'Смотри партию', attachment: {kind: 'game', ref: '42'}});
        const card = await screen.findByTestId('attachment-game');
        expect(card).toHaveTextContent('me — magnus · 1-0');
        expect(card.querySelector('a')).toHaveAttribute('href', '/game/42');
        expect(screen.getByTestId('dm-input')).toHaveValue('');
        expect(screen.queryByTestId('dm-attach')).toBeNull();
    });

    it('закрытая переписка: причина вместо поля ввода', async () => {
        stubFetch((url) => {
            if (url.endsWith('/settings')) return {dm_policy: 'all', blocked: []};
            if (url.includes('/with/magnus')) {
                return {username: 'magnus', avatar: null, can_write: false, reason: 'dm_closed', blocked: false, messages: []};
            }
            return {unread: 0, conversations: []};
        });
        page('/messages/magnus');
        expect(await screen.findByTestId('dm-refusal')).toHaveTextContent('Этот игрок не принимает от вас сообщений');
        expect(screen.queryByTestId('dm-composer')).toBeNull();
    });

    it('ошибка отправки показывается текстом из каталога', async () => {
        stubFetch((url, init) => {
            if (url.endsWith('/settings')) return {dm_policy: 'all', blocked: []};
            if (url.includes('/with/magnus') && init?.method === 'POST') return new Error('attachment_invalid');
            if (url.includes('/with/magnus')) return {username: 'magnus', avatar: null, can_write: true, reason: null, blocked: false, messages: []};
            return {unread: 0, conversations: []};
        });
        page('/messages/magnus');
        await screen.findByTestId('dm-composer');
        fireEvent.click(screen.getByTestId('dm-attach-toggle'));
        fireEvent.change(screen.getByTestId('dm-attach-ref'), {target: {value: '999'}});
        await act(async () => fireEvent.click(screen.getByTestId('dm-send')));
        expect(await screen.findByRole('alert')).toHaveTextContent('Эту партию, позицию или материал нельзя вложить');
    });

    it('гость видит просьбу войти', () => {
        setToken(null);
        page('/messages');
        expect(screen.getByTestId('dm-login')).toBeInTheDocument();
    });
});

describe('колокольчик', () => {
    it('непрочитанные сообщения входят в счётчик, первая строка ведёт в «Сообщения»', async () => {
        stubFetch((url, init) => {
            if (url.endsWith('/messages/unread')) return {unread: 3};
            return init?.method === 'POST' ? {unread: 0, items: []} : {unread: 1, items: []};
        });
        render(<MemoryRouter><NotificationBell/></MemoryRouter>);
        await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('4'));
        await act(async () => fireEvent.click(screen.getByTestId('notification-bell')));
        const link = screen.getByTestId('notification-messages');
        expect(link).toHaveAttribute('href', '/messages');
        expect(link).toHaveTextContent('новых: 3');
        // Колокольчик отмечает прочитанными уведомления, но не сообщения: те — только в самой переписке.
        expect(screen.getByTestId('notification-badge')).toHaveTextContent('3');
    });
});
