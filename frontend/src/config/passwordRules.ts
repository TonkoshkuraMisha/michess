// --- FILE: frontend/src/config/passwordRules.ts ---
// Правила пароля, которые клиент проверяет до запроса, чтобы сразу показать ошибку. Решает сервер: min_length
// в схемах регистрации, смены и сброса пароля (src/schemas/user.py, src/api/account.py, src/api/auth.py).
// Используют страница настроек (Settings.tsx) и страница сброса пароля по ссылке из письма (EmailLinkPages.tsx).

/** Наименьшая длина нового пароля; должна совпадать с min_length на сервере. */
export const MIN_PASSWORD_LENGTH = 8;
