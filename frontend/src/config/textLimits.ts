// --- FILE: frontend/src/config/textLimits.ts ---
// Наибольшая длина текстов, которые пишет игрок, и размер страницы переписки. Решает сервер: числа здесь повторяют его
// проверки, чтобы поле ввода не принимало лишнего и игрок не получал отказ после отправки. Изменили на сервере —
// поменяйте и здесь. Используют поля общения (components/social/*).

/** Публикация в ленте — src/services/feed.py, BODY_MAX. */
export const FEED_POST_MAX = 2000;
/** Комментарий к публикации — src/services/feed.py, COMMENT_MAX. */
export const FEED_COMMENT_MAX = 500;
/** Личное сообщение — src/services/direct_messages.py, BODY_MAX. */
export const DIRECT_MESSAGE_MAX = 1000;
/**
 * Сообщений переписки на странице — src/services/direct_messages.py, PAGE: полная страница значит, что раньше есть ещё
 * сообщения (кнопка «Показать раньше»).
 */
export const DIRECT_MESSAGES_PAGE = 50;
/** Комментарий к жалобе, текст апелляции и предложенный перевод — max_length=300 в src/api/moderation.py. */
export const MODERATION_TEXT_MAX = 300;
/** Название команды — src/services/league.py, NAME_MAX. */
export const TEAM_NAME_MAX = 30;
/** Строка поиска игрока — max_length=30 у GET /social/search (src/api/social.py). */
export const PLAYER_SEARCH_MAX = 30;
