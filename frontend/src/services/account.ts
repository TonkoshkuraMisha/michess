// --- FILE: frontend/src/services/account.ts ---
// Вход, регистрация и учётная запись: POST /api/v1/auth/login (форма OAuth2 и refresh-cookie долгого входа),
// /auth/register, /auth/change-password (src/api/auth.py); привязка и снятие почты, подтверждение по ссылке, сброс
// пароля, выгрузка и удаление данных — /api/v1/account/* (src/api/account.py); адрес почты и флаги профиля —
// GET /profile/me. Используют AuthModal.tsx, Settings.tsx и EmailLinkPages.tsx. Запрос и ошибки — apiRequest (http.ts);
// сохранять токен — дело вызывающего (authToken.setToken).

import type {Language} from '../i18n';
import {apiRequest} from './http';

/** Свои данные профиля, нужные странице настроек. */
export interface OwnAccount {
    id?: number;
    blitz_rating?: number;
    username?: string;
    email: string | null;
    translation_helper?: boolean;
    avatar?: string | null;
}

/** Ответы о силе при регистрации (таск 17.8): по ним сервер ставит стартовый рейтинг; всё необязательно. */
export interface RegisterRequest {
    username: string;
    password: string;
    experience?: string;
    strength?: string;
    invite_code?: string;
    /** Согласие с правилами сообщества и конфиденциальностью (таск 23.1). */
    accept_terms: boolean;
}

/** Ответ входа и смены пароля: новый токен доступа. */
interface TokenResponse {
    access_token: string;
}

/** POST с JSON-телом. */
const post = (body: unknown, init: RequestInit = {}): RequestInit => ({method: 'POST', body: JSON.stringify(body), ...init});

/** HTTP 429: превышен лимит попыток входа. */
const TOO_MANY_REQUESTS = 429;

export const accountApi = {
    /** Вход по имени и паролю; refresh-cookie сохраняет браузер. 429 без кода сервера — «слишком много попыток». */
    login: async (username: string, password: string): Promise<string> => {
        const form = new URLSearchParams({username, password});
        const data = await apiRequest<TokenResponse>('/auth/login', {
            method: 'POST', body: form, credentials: 'include',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        },
            (status) => (status === TOO_MANY_REQUESTS ? 'auth.tooManyAttempts' : 'auth.wrongCredentials'));
        return data.access_token;
    },
    register: (request: RegisterRequest) =>
        apiRequest<{ blitz_rating: number }>('/auth/register', post(request), 'auth.registrationFailed'),
    /** Смена пароля отзывает прежние сессии; возвращает новый токен (и новую refresh-cookie). */
    changePassword: async (currentPassword: string, newPassword: string): Promise<string> => {
        const data = await apiRequest<TokenResponse>('/auth/change-password',
            post({current_password: currentPassword, new_password: newPassword}, {credentials: 'include'}),
            'settings.passwordChangeFailed');
        return data.access_token;
    },
    me: () => apiRequest<OwnAccount>('/profile/me'),
    /** Привязать почту (письмо со ссылкой придёт на языке игрока) или снять её; нужен пароль. */
    linkEmail: (email: string, password: string, language: Language) =>
        apiRequest<unknown>('/account/email', post({email, password, language}), 'settings.emailFailed'),
    removeEmail: (password: string) => apiRequest<unknown>('/account/email/remove', post({password}), 'settings.emailFailed'),
    /** Подтвердить почту по ссылке из письма; возвращает подтверждённый адрес. */
    verifyEmail: (token: string) =>
        apiRequest<{ email: string }>('/account/email/verify', post({token}), 'serverErrors.email_link_invalid'),
    requestPasswordReset: (email: string, language: Language) =>
        apiRequest<unknown>('/account/password-reset', post({email, language}), 'auth.resetFailed'),
    confirmPasswordReset: (token: string, newPassword: string) =>
        apiRequest<unknown>('/account/password-reset/confirm', post({token, new_password: newPassword}),
            'serverErrors.email_link_invalid'),
    /** Все свои данные одним JSON (право на выгрузку). */
    exportData: () => apiRequest<unknown>('/account/export', {}, 'settings.exportFailed'),
    deleteAccount: (password: string) => apiRequest<unknown>('/account/delete', post({password}), 'settings.deleteFailed'),
};
