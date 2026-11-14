# --- FILE: src/services/mailer.py ---
"""
Отправка писем (таск 17.5) по стандартному SMTP: подходит любой провайдер транзакционной почты (Brevo, Amazon SES,
Postmark, Mailgun…) или свой сервер — меняются только переменные SMTP_* в .env. Без SMTP_HOST письмо не уходит,
а пишется в лог вместе со ссылкой: так работает разработка и тесты.

Тексты писем — здесь, на трёх языках интерфейса: письмо читают вне клиента, каталоги фронтенда ему недоступны.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from typing import Literal

from src.core.config import settings

logger = logging.getLogger(__name__)

Language = Literal["en", "uk", "ru"]
LANGUAGES: tuple[Language, ...] = ("en", "uk", "ru")
Kind = Literal["verify", "reset"]

TEMPLATES: dict[Kind, dict[Language, tuple[str, str]]] = {
    "verify": {
        "en": ("Confirm your e-mail for michess",
               "Hello, {username}!\n\nTo confirm this address for your michess account, open the link:\n{link}\n\n"
               "The link works for {hours} h. If you did not ask for it, just ignore this letter."),
        "uk": ("Підтвердіть e-mail для michess",
               "Вітаємо, {username}!\n\nЩоб підтвердити цю адресу для акаунта michess, відкрийте посилання:\n{link}\n\n"
               "Посилання діє {hours} год. Якщо ви цього не просили, просто проігноруйте лист."),
        "ru": ("Подтвердите e-mail для michess",
               "Здравствуйте, {username}!\n\nЧтобы подтвердить этот адрес для аккаунта michess, откройте ссылку:\n{link}\n\n"
               "Ссылка действует {hours} ч. Если вы этого не просили, просто проигнорируйте письмо."),
    },
    "reset": {
        "en": ("Reset your michess password",
               "Hello, {username}!\n\nTo set a new password, open the link:\n{link}\n\n"
               "The link works for {hours} h and only once. If you did not ask to reset the password, ignore this "
               "letter: your password stays the same."),
        "uk": ("Скидання пароля michess",
               "Вітаємо, {username}!\n\nЩоб задати новий пароль, відкрийте посилання:\n{link}\n\n"
               "Посилання діє {hours} год і лише один раз. Якщо ви не просили скинути пароль, проігноруйте лист: "
               "пароль не зміниться."),
        "ru": ("Сброс пароля michess",
               "Здравствуйте, {username}!\n\nЧтобы задать новый пароль, откройте ссылку:\n{link}\n\n"
               "Ссылка действует {hours} ч и только один раз. Если вы не просили сбросить пароль, проигнорируйте "
               "письмо: пароль не изменится."),
    },
}


def render(kind: Kind, language: str, **params: str | int) -> tuple[str, str]:
    lang: Language = next((code for code in LANGUAGES if code == language), "en")
    subject, body = TEMPLATES[kind][lang]
    return subject, body.format(**params)


def _send_smtp(message: EmailMessage) -> None:
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as smtp:
        if settings.SMTP_STARTTLS:
            smtp.starttls()
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(message)


async def send(to: str, subject: str, body: str) -> None:
    """Письмо по SMTP; без SMTP_HOST — в лог. Ошибку отправки пишем в лог и не показываем запросившему."""
    if not settings.SMTP_HOST:
        logger.info("mail (SMTP_HOST is empty, not sent) to=%s subject=%s\n%s", to, subject, body)
        return
    message = EmailMessage()
    message["From"] = settings.MAIL_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    try:
        await asyncio.to_thread(_send_smtp, message)
    except (OSError, smtplib.SMTPException):
        logger.exception("mail to %s failed", to)
