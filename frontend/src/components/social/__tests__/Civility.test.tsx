// Уважительное общение (таск 30.3): предупреждение фильтра и «отправить на проверку», пометка «ждёт модератора»,
// жалоба на текст в один шаг, скрытие переписки, правила общения.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {CommunityRulesPage, TextReportButton} from '../Civility';
import {FeedPage} from '../FeedPage';
import {MessagesPage} from '../MessagesPage';

type Handler = (url: string, init?: RequestInit) => unknown;

function stubFetch(handler: Handler) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const body = handler(String(url), init);
        const failed = body instanceof Error;
        return {
            ok: !failed, status: failed ? 409 : 200,
            json: async () => (failed ? {detail: {code: body.message, params: {}, message: ''}} : body),
        } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const posted = (mock: ReturnType<typeof stubFetch>, part: string) => mock.mock.calls
    .filter(([u, i]) => String(u).includes(part) && i?.method === 'POST')
    .map(([, i]) => JSON.parse(String(i?.body)));

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('фильтр оскорблений', () => {
    it('сообщение: предупреждение, «отправить на проверку» и пометка «ждёт модератора»', async () => {
        const fetchMock = stubFetch((url, init) => {
            if (url.endsWith('/settings')) return {dm_policy: 'all', blocked: []};
            if (url.includes('/with/magnus') && init?.method === 'POST') {
                const sent = JSON.parse(String(init.body));
                if (!sent.send_anyway) return new Error('text_flagged');
                return {id: 5, mine: true, body: sent.body, attachment: null, created_at: null, read: false, held: true};
            }
            if (url.includes('/with/magnus')) return {username: 'magnus', avatar: null, can_write: true, reason: null, blocked: false, messages: []};
            return {unread: 0, conversations: []};
        });
        render(<MemoryRouter initialEntries={['/messages/magnus']}><Routes>
            <Route path="/messages/:username" element={<MessagesPage/>}/>
        </Routes></MemoryRouter>);
        await screen.findByTestId('dm-composer');
        fireEvent.change(screen.getByTestId('dm-input'), {target: {value: 'плохие слова'}});
        await act(async () => fireEvent.click(screen.getByTestId('dm-send')));
        expect(await screen.findByTestId('flagged-notice')).toHaveTextContent('Похоже на оскорбление');
        expect(screen.getByTestId('dm-input')).toHaveValue('плохие слова');      // текст не потерян — можно переписать
        await act(async () => fireEvent.click(screen.getByTestId('flagged-send-anyway')));
        expect(posted(fetchMock, '/with/magnus').map((b) => b.send_anyway)).toEqual([false, true]);
        expect(screen.queryByTestId('flagged-notice')).toBeNull();
        expect(await screen.findByTestId('held-note')).toHaveTextContent('Ждёт модератора');
    });

    it('публикация: «переформулировать» закрывает предупреждение без отправки', async () => {
        const fetchMock = stubFetch((_url, init) => (init?.method === 'POST' ? new Error('text_flagged') : {posts: [], page: 20}));
        render(<MemoryRouter initialEntries={['/feed']}><Routes><Route path="/feed" element={<FeedPage/>}/></Routes></MemoryRouter>);
        await screen.findByTestId('feed-empty');
        fireEvent.change(screen.getByTestId('feed-input'), {target: {value: 'плохие слова'}});
        await act(async () => fireEvent.click(screen.getByTestId('feed-publish')));
        await screen.findByTestId('flagged-notice');
        fireEvent.click(screen.getByTestId('flagged-rephrase'));
        expect(screen.queryByTestId('flagged-notice')).toBeNull();
        expect(posted(fetchMock, '/api/v1/feed')).toHaveLength(1);
    });
});

describe('жалоба и скрытие', () => {
    it('жалоба на текст: причина одним нажатием', async () => {
        const fetchMock = stubFetch(() => ({id: 1}));
        render(<MemoryRouter><TextReportButton subject="post:7"/></MemoryRouter>);
        fireEvent.click(screen.getByTestId('text-report'));
        await act(async () => fireEvent.click(screen.getByTestId('text-report-spam')));
        expect(posted(fetchMock, '/reports/text')).toEqual([{subject: 'post:7', reason: 'spam'}]);
        expect(screen.getByTestId('text-report-sent')).toHaveTextContent('Жалоба принята');
    });

    it('скрыть переписку — запрос и возврат к списку', async () => {
        const fetchMock = stubFetch((url) => {
            if (url.endsWith('/settings')) return {dm_policy: 'all', blocked: []};
            if (url.endsWith('/hide')) return {unread: 0};
            if (url.includes('/with/magnus')) return {username: 'magnus', avatar: null, can_write: true, reason: null, blocked: false, messages: []};
            return {unread: 0, conversations: []};
        });
        render(<MemoryRouter initialEntries={['/messages/magnus']}><Routes>
            <Route path="/messages" element={<MessagesPage/>}/>
            <Route path="/messages/:username" element={<MessagesPage/>}/>
        </Routes></MemoryRouter>);
        await screen.findByTestId('dm-composer');
        await act(async () => fireEvent.click(screen.getByTestId('dm-hide')));
        expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/with/magnus/hide') && i?.method === 'POST')).toBe(true);
        expect(await screen.findByText('Выберите переписку слева.')).toBeInTheDocument();
    });

    it('правила общения на странице', () => {
        render(<MemoryRouter><CommunityRulesPage/></MemoryRouter>);
        const page = screen.getByTestId('rules-page');
        expect(page).toHaveTextContent('Правила общения');
        // Либеральная редакция (решение владельца 17.11.2026): запреты защищают человека, а не тон.
        expect(page).toHaveTextContent('Здесь говорят свободно.');
        expect(page).toHaveTextContent('Мы не оцениваем вкус и тон.');
        expect(page).toHaveTextContent('Нельзя травить человека');
        expect(screen.getAllByRole('listitem')).toHaveLength(6);
    });
});
