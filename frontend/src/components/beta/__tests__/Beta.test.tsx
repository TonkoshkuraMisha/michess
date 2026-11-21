// Программа беты (таск 24.4): «Сообщить о проблеме» с контекстом страницы, ссылка на сообщество из настроек сервера,
// приглашения и очередь сообщений у модератора, регистрация по коду-приглашению.

import {act, fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import AuthModal from '../../AuthModal';
import {setToken} from '../../../services/authToken';
import {communityPlatform, inviteLink, resetSiteConfig} from '../../../services/beta';
import {FeedbackPanel, InvitesPanel} from '../BetaAdmin';
import {CommunityLink, ReportProblem} from '../ReportProblem';

type Reply = { status?: number; body: unknown };

function stub(handler: (url: string, init?: RequestInit) => Reply | unknown) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const reply = handler(String(url), init);
        const {status = 200, body} = reply && typeof reply === 'object' && 'body' in reply ? reply as Reply : {body: reply};
        return {ok: status < 400, status, json: async () => body} as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stub>, method: string, part: string) =>
    (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][])
        .filter(([url, init]) => (init?.method ?? 'GET') === method && url.includes(part));

const headers = (init: RequestInit | undefined) => (init?.headers ?? {}) as Record<string, string>;

const CONFIG = {invite_only: false, community_url: 'https://t.me/example', version: '1.2.2'};

beforeEach(() => resetSiteConfig());
afterEach(() => {
    setToken(null);
    resetSiteConfig();
    vi.unstubAllGlobals();
});

describe('сообщить о проблеме', () => {
    it('гость отправляет текст; прикладываются путь страницы, язык и размер окна — без параметров адреса', async () => {
        const fetchMock = stub((url) => (url.endsWith('/beta/config') ? CONFIG : {id: 7}));
        const onClose = vi.fn();
        render(<MemoryRouter initialEntries={['/reset-password?token=secret']}><ReportProblem onClose={onClose}/></MemoryRouter>);

        expect(await screen.findByText(/версию приложения \(1\.2\.2\)/)).toBeInTheDocument();
        expect(screen.getByTestId('report-problem-context')).toHaveTextContent('/reset-password');
        expect(screen.getByTestId('report-problem-context')).not.toHaveTextContent('secret');
        fireEvent.change(screen.getByTestId('report-problem-text'), {target: {value: '  Часы спешат на минуту  '}});
        await act(async () => fireEvent.click(screen.getByTestId('report-problem-send')));

        const [[url, init]] = calls(fetchMock, 'POST', '/beta/feedback');
        expect(url).toMatch(/\/api\/v1\/beta\/feedback$/);
        expect(JSON.parse(String(init?.body))).toEqual({
            message: 'Часы спешат на минуту', page: '/reset-password', language: 'ru',
            screen: `${window.innerWidth}x${window.innerHeight}`,
        });
        expect(headers(init).Authorization).toBeUndefined();
        expect(screen.getByTestId('report-problem-sent')).toHaveTextContent('Спасибо! Сообщение получено.');
        fireEvent.keyDown(window, {key: 'Escape'});
        expect(onClose).toHaveBeenCalled();
    });

    it('слишком короткий текст не отправляется', async () => {
        const fetchMock = stub(() => ({}));
        render(<MemoryRouter><ReportProblem onClose={vi.fn()}/></MemoryRouter>);
        fireEvent.change(screen.getByTestId('report-problem-text'), {target: {value: ' ой '}});
        fireEvent.click(screen.getByTestId('report-problem-send'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Напишите хотя бы пару слов');
        expect(calls(fetchMock, 'POST', '/beta/feedback')).toHaveLength(0);
    });

    it('игрок отправляет с токеном; лимит сообщений — сколько ждать', async () => {
        setToken('jwt');
        const fetchMock = stub((url) => (url.endsWith('/beta/feedback')
            ? {status: 429, body: {detail: {code: 'too_many_feedback', params: {retry_after: 90}, message: '…'}}} : {}));
        render(<MemoryRouter><ReportProblem onClose={vi.fn()}/></MemoryRouter>);
        fireEvent.change(screen.getByTestId('report-problem-text'), {target: {value: 'Не работает кнопка'}});
        await act(async () => fireEvent.click(screen.getByTestId('report-problem-send')));
        expect(screen.getByRole('alert')).toHaveTextContent('Слишком много сообщений — попробуйте через 90 с');
        const [[, init]] = calls(fetchMock, 'POST', '/beta/feedback');
        expect(headers(init).Authorization).toBe('Bearer jwt');
    });
});

describe('канал сообщества', () => {
    it('ссылка видна, только когда задана в настройках сервера', async () => {
        stub(() => CONFIG);
        render(<CommunityLink/>);
        const link = await screen.findByTestId('community-link');
        expect(link).toHaveAttribute('href', 'https://t.me/example');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveTextContent('Канал regence в Telegram');
    });

    it.each([
        {community_url: null}, {community_url: ''}, {community_url: 'javascript:alert(1)'}, {}, [], null,
    ])('без действующей ссылки ничего не показывается: %j', async (config) => {
        const fetchMock = stub(() => config);
        render(<CommunityLink/>);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await act(async () => undefined);
        expect(screen.queryByTestId('community-link')).toBeNull();
    });

    it('площадка определяется по адресу', () => {
        expect(communityPlatform('https://t.me/example')).toBe('telegram');
        expect(communityPlatform('https://discord.gg/abc')).toBe('discord');
        expect(communityPlatform('https://example.org/t.me')).toBe('generic');
        expect(communityPlatform('не адрес')).toBe('generic');
    });
});

describe('приглашения у модератора', () => {
    const invite = (over: object) => ({
        id: 1, code: 'K7QF2MXN9B', note: null, max_uses: null, uses: 0, expires_at: null, revoked_at: null,
        created_at: '2026-11-16T10:00:00+00:00', state: 'active', ...over,
    });

    it('список: сколько пришло по каждому коду, состояние, отзыв', async () => {
        const fetchMock = stub(() => ({invite_only: true, invites: [
            invite({id: 1, uses: 3, max_uses: 10, note: 'клуб'}), invite({id: 2, code: 'ZZZZZZZZZZ', uses: 5, state: 'revoked'}),
        ]}));
        render(<InvitesPanel/>);
        expect(await screen.findByTestId('beta-invite-uses-1')).toHaveTextContent('пришло: 3 из 10');
        expect(screen.getByTestId('beta-invite-uses-2')).toHaveTextContent('пришло: 5');
        expect(screen.getByTestId('beta-invite-mode')).toHaveTextContent('Регистрация закрыта: только по приглашениям.');
        expect(screen.getByTestId('beta-invite-2')).toHaveTextContent('отозван');
        // У отозванного кода действий нет.
        expect(screen.queryByTestId('beta-invite-revoke-2')).toBeNull();
        await act(async () => fireEvent.click(screen.getByTestId('beta-invite-revoke-1')));
        expect(calls(fetchMock, 'POST', '/beta/invites/1/revoke')).toHaveLength(1);
    });

    it('создание кода с лимитом и сроком; пустые поля не отправляются', async () => {
        const fetchMock = stub(() => ({invite_only: false, invites: []}));
        render(<InvitesPanel/>);
        expect(await screen.findByText('Кодов пока нет.')).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('beta-invite-note'), {target: {value: ' школа '}});
        fireEvent.change(screen.getByTestId('beta-invite-max'), {target: {value: '25'}});
        await act(async () => fireEvent.submit(screen.getByTestId('beta-invite-form')));
        fireEvent.change(screen.getByTestId('beta-invite-max'), {target: {value: ''}});
        fireEvent.change(screen.getByTestId('beta-invite-days'), {target: {value: '14'}});
        await act(async () => fireEvent.submit(screen.getByTestId('beta-invite-form')));
        const bodies = calls(fetchMock, 'POST', '/beta/invites').map(([, init]) => JSON.parse(String(init?.body)));
        expect(bodies).toEqual([{note: 'школа', max_uses: 25}, {expires_in_days: 14}]);
    });

    it('ссылка-приглашение ведёт на сайт с кодом', async () => {
        expect(inviteLink('K7QF2MXN9B')).toBe(`${window.location.origin}/?invite=K7QF2MXN9B`);
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
        stub(() => ({invites: [invite({})]}));
        render(<InvitesPanel/>);
        const copy = await screen.findByTestId('beta-invite-copy-1');
        await act(async () => fireEvent.click(copy));
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?invite=K7QF2MXN9B`);
        expect(screen.getByTestId('beta-invite-copy-1')).toHaveTextContent('Скопировано');
        Reflect.deleteProperty(navigator, 'clipboard');
    });
});

describe('очередь сообщений у модератора', () => {
    const item = (over: object) => ({
        id: 1, message: 'Задача зависла\nпосле второго хода', page: '/puzzles/42', app_version: '1.2.2', language: 'uk',
        screen: '390x844', status: 'new', author: null, created_at: '2026-11-16T10:00:00+00:00', updated_at: null, ...over,
    });

    it('сообщение с контекстом, смена статуса, фильтр по статусу', async () => {
        const fetchMock = stub((url) => (url.includes('status=done')
            ? {items: [item({id: 5, status: 'done', author: 'alice'})], counts: {new: 1, in_progress: 1, done: 1, rejected: 0}}
            : {items: [item({})], counts: {new: 1, in_progress: 1, done: 1, rejected: 0}}));
        render(<FeedbackPanel/>);
        expect(await screen.findByTestId('beta-feedback-context-1')).toHaveTextContent('/puzzles/42 · v1.2.2 · uk · 390x844');
        expect(screen.getByTestId('beta-feedback-1')).toHaveTextContent('гость');
        expect(screen.getByTestId('beta-feedback-tab-open')).toHaveTextContent('К разбору (2)');
        expect(screen.getByTestId('beta-feedback-tab-done')).toHaveTextContent('Сделано (1)');
        // Текущий статус кнопкой не предлагается.
        expect(screen.queryByTestId('beta-feedback-1-new')).toBeNull();

        await act(async () => fireEvent.click(screen.getByTestId('beta-feedback-1-in_progress')));
        const [[url, init]] = calls(fetchMock, 'POST', '/beta/feedback/1/status');
        expect(url).toMatch(/\/beta\/feedback\/1\/status$/);
        expect(JSON.parse(String(init?.body))).toEqual({status: 'in_progress'});

        await act(async () => fireEvent.click(screen.getByTestId('beta-feedback-tab-done')));
        expect(await screen.findByTestId('beta-feedback-5')).toHaveTextContent('alice');
        expect(screen.queryByTestId('beta-feedback-1')).toBeNull();
    });

    it('чужой ответ сервера не ломает панель', async () => {
        stub(() => ({reports: []}));
        render(<FeedbackPanel/>);
        expect(await screen.findByText('Здесь пусто.')).toBeInTheDocument();
        expect(screen.getByTestId('beta-feedback-tab-open')).toHaveTextContent('К разбору (0)');
    });
});

describe('регистрация по приглашению', () => {
    const register = (fetchMock: ReturnType<typeof stub>) => calls(fetchMock, 'POST', '/auth/register')
        .map(([, init]) => JSON.parse(String(init?.body)));

    function fill(username: string, password: string) {
        fireEvent.change(screen.getByPlaceholderText('например, string1'), {target: {value: username}});
        fireEvent.change(screen.getByPlaceholderText('••••••••'), {target: {value: password}});
        fireEvent.click(screen.getByTestId('auth-terms'));  // согласие с условиями (таск 23.1)
    }

    it('открытая регистрация: поля кода нет, код не отправляется', async () => {
        const fetchMock = stub((url) => (url.endsWith('/auth/register') ? {body: {blitz_rating: 1200}} : {access_token: 'jwt'}));
        render(<AuthModal onSuccess={vi.fn()}/>);
        fireEvent.click(screen.getByRole('button', {name: /Нет аккаунта/}));
        expect(screen.queryByTestId('auth-invite')).toBeNull();
        fill('alice', 'secret-pass');
        await act(async () => fireEvent.click(screen.getByRole('button', {name: /Зарегистрироваться/})));
        expect(register(fetchMock)).toEqual([{username: 'alice', password: 'secret-pass', accept_terms: true}]);
    });

    it('закрытая регистрация: код обязателен; отказ сервера — понятный текст', async () => {
        const fetchMock = stub((url) => (url.endsWith('/auth/register')
            ? {status: 403, body: {detail: {code: 'registration_invite_invalid', params: {}, message: '…'}}} : {}));
        render(<AuthModal onSuccess={vi.fn()} inviteOnly/>);
        fireEvent.click(screen.getByRole('button', {name: /Нет аккаунта/}));
        expect(screen.getByTestId('auth-invite')).toBeRequired();
        expect(screen.getByTestId('auth-invite-only')).toHaveTextContent('Регистрация сейчас только по приглашениям.');
        fill('alice', 'secret-pass');
        fireEvent.change(screen.getByTestId('auth-invite'), {target: {value: ' k7qf2mxn9b '}});
        await act(async () => fireEvent.click(screen.getByRole('button', {name: /Зарегистрироваться/})));
        expect(register(fetchMock)).toEqual([{username: 'alice', password: 'secret-pass', accept_terms: true, invite_code: 'k7qf2mxn9b'}]);
        expect(screen.getByRole('alert')).toHaveTextContent('Код-приглашение недействителен, истёк или уже исчерпан');
    });

    it('ссылка-приглашение: сразу регистрация, код вписан и проверен', async () => {
        const fetchMock = stub((url) => (url.includes('/beta/invites/check') ? {valid: true} : {}));
        render(<AuthModal onSuccess={vi.fn()} inviteCode="K7QF2MXN9B"/>);
        expect(screen.getByRole('heading', {name: 'Регистрация аккаунта'})).toBeInTheDocument();
        expect(screen.getByTestId('auth-invite')).toHaveValue('K7QF2MXN9B');
        expect(screen.getByTestId('auth-invite')).not.toBeRequired();
        expect(await screen.findByTestId('auth-invite-status')).toHaveTextContent('Приглашение действует');
        expect(calls(fetchMock, 'GET', '/beta/invites/check')[0][0]).toMatch(/check\?code=K7QF2MXN9B$/);
        // Код изменили — прежний вердикт больше не показывается.
        fireEvent.change(screen.getByTestId('auth-invite'), {target: {value: 'OTHER'}});
        expect(screen.queryByTestId('auth-invite-status')).toBeNull();
    });

    it('недействительная ссылка-приглашение — об этом сказано сразу', async () => {
        stub((url) => (url.includes('/beta/invites/check') ? {valid: false} : {}));
        render(<AuthModal onSuccess={vi.fn()} inviteCode="OLDCODE"/>);
        expect(await screen.findByTestId('auth-invite-status')).toHaveTextContent('Приглашение недействительно, истекло или уже исчерпано');
    });
});
