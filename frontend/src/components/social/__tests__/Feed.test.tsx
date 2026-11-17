// Лента и публикации (таск 30.2): лента, публикация с карточкой, «нравится», комментарии, публикации в профиле.

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setToken} from '../../../services/authToken';
import {detectAttachment} from '../../../services/messages';
import {notificationLink} from '../../../services/social';
import type {AppNotification} from '../../../services/social';
import {FeedPage, PostPage, ProfilePosts} from '../FeedPage';
import {notificationText} from '../SocialHeader';
import {makeI18n} from '../../../i18n';

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

const post = (id: number, extra: Record<string, unknown> = {}) => ({
    id, author: 'magnus', avatar: null, body: `Пост ${id}`, attachment: null, created_at: '2026-11-17T10:00:00Z',
    likes: 0, liked: false, comments: 0, mine: false, hidden: false, ...extra,
});

function at(path: string, state?: unknown) {
    return render(
        <MemoryRouter initialEntries={[{pathname: path, state}]}>
            <Routes>
                <Route path="/feed" element={<FeedPage/>}/>
                <Route path="/feed/post/:postId" element={<PostPage/>}/>
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => setToken('jwt'));
afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
});

describe('лента', () => {
    it('публикации подписок, «нравится» и публикация с карточкой', async () => {
        const fetchMock = stubFetch((url, init) => {
            if (url.endsWith('/like')) return post(1, {likes: 1, liked: true});
            if (init?.method === 'POST') {
                const sent = JSON.parse(String(init.body));
                return post(9, {author: 'me', mine: true, body: sent.body,
                    attachment: {kind: 'library', ref: '5', white: 'Anderssen', black: 'Kieseritzky', result: '1-0', year: 1851}});
            }
            return {posts: [post(1)], page: 20};
        });
        at('/feed');
        expect(await screen.findByText('Пост 1')).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByTestId('feed-like')));
        expect(screen.getByTestId('feed-like')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('feed-like')).toHaveTextContent('1');

        fireEvent.change(screen.getByTestId('feed-input'), {target: {value: 'Бессмертная!'}});
        fireEvent.click(screen.getByTestId('feed-attach-toggle'));
        fireEvent.change(screen.getByTestId('feed-attach-ref'), {target: {value: 'https://x.example/library/game/5'}});
        expect(screen.getByTestId('feed-attach-kind')).toHaveValue('library');
        await act(async () => fireEvent.click(screen.getByTestId('feed-publish')));
        const sent = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/api/v1/feed') && i?.method === 'POST');
        expect(JSON.parse(String(sent?.[1]?.body))).toEqual({body: 'Бессмертная!', attachment: {kind: 'library', ref: '5'}});
        const cards = await screen.findAllByTestId('feed-post');
        expect(cards[0]).toHaveTextContent('Бессмертная!');
        expect(cards[0]).toHaveTextContent('Anderssen — Kieseritzky · 1-0 · 1851');
        expect(screen.getByTestId('attachment-library').querySelector('a')).toHaveAttribute('href', '/library/game/5');
    });

    it('«Поделиться» открывает поле с готовым достижением; ошибка — текстом каталога', async () => {
        stubFetch((_url, init) => (init?.method === 'POST' ? new Error('posting_banned') : {posts: [], page: 20}));
        at('/feed', {attach: {kind: 'achievement', ref: 'first_game'}});
        expect(await screen.findByTestId('feed-empty')).toBeInTheDocument();
        expect(screen.getByTestId('attachment-achievement')).toHaveTextContent('Первая партия');
        await act(async () => fireEvent.click(screen.getByTestId('feed-publish')));
        expect(await screen.findByRole('alert')).toHaveTextContent('Модератор временно запретил вам публикации и комментарии');
    });

    it('страница публикации: комментарии и новый комментарий', async () => {
        stubFetch((url, init) => {
            if (url.endsWith('/comments') && init?.method === 'POST') {
                return {id: 2, author: 'me', body: 'Спасибо', created_at: null, mine: true, can_delete: true};
            }
            return {post: post(4, {comments: 1}), comments: [
                {id: 1, author: 'magnus', body: 'Красиво', created_at: null, mine: false, can_delete: false}]};
        });
        at('/feed/post/4');
        expect(await screen.findByText('Красиво')).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('comment-input'), {target: {value: 'Спасибо'}});
        await act(async () => fireEvent.click(screen.getByTestId('comment-send')));
        expect(screen.getAllByTestId('post-comment')).toHaveLength(2);
        expect(screen.getByTestId('feed-post')).toHaveTextContent('Комментариев: 2');
    });

    it('гость: просьба войти; публикации игрока в профиле видны', async () => {
        setToken(null);
        stubFetch(() => ({posts: [post(3)], page: 20}));
        at('/feed');
        expect(screen.getByTestId('feed-login')).toBeInTheDocument();
        render(<MemoryRouter><ProfilePosts username="magnus"/></MemoryRouter>);
        await waitFor(() => expect(screen.getByTestId('profile-posts')).toHaveTextContent('Пост 3'));
    });
});

describe('мелочи', () => {
    it('ссылка на партию библиотеки и уведомление о комментарии', () => {
        expect(detectAttachment('/library/game/12')).toEqual({kind: 'library', ref: '12'});
        expect(detectAttachment('/game/12')).toEqual({kind: 'game', ref: '12'});
        const n = {id: 1, kind: 'post_comment', payload: {from: 'magnus', post_id: 7}, created_at: null, read: false} as AppNotification;
        expect(notificationLink(n)).toBe('/feed/post/7');
        expect(notificationText(n, makeI18n('ru').t)).toBe('Новый комментарий от magnus к вашей публикации');
    });
});
