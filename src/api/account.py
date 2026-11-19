# --- FILE: src/api/account.py ---
"""
Учётная запись (/account; таски 17.5, 23.1, 24.3): выгрузка своих данных и партий, удаление аккаунта
(src/services/account.py), привязка e-mail и сброс пароля по ссылке из письма (src/services/email_links.py,
отправка — src/services/mailer.py).

Привязка и удаление требуют пароль; неудачные попытки считаются тем же счётчиком, что и неудачные входы. Письма
ограничены по адресу получателя и по адресу отправителя запроса (RATE_LIMIT_EMAIL_*). Подтверждение адреса и сброс
пароля идут без входа — по одноразовому токену из письма (таблица email_tokens).
"""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import client_ip, enforce_rate_limit, ensure_below_limit, record_attempt
from src.core.config import settings
from src.core.errors import ApiError
from src.core.security import verify_password
from src.db.session import get_db
from src.models.user import User
from src.schemas.user import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, username_key
from src.services import account as service
from src.services import email_links

router = APIRouter(prefix="/account", tags=["Account"])


class DeleteAccountRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


# Простая проверка формы адреса; настоящая проверка — письмо со ссылкой.
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
Language = Literal["en", "uk", "ru"]


class EmailRequest(BaseModel):
    email: str = Field(..., max_length=254, pattern=EMAIL_PATTERN)
    password: str = Field(..., min_length=1, max_length=128)
    language: Language = "en"


class TokenRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)


class ResetRequest(BaseModel):
    email: str = Field(..., max_length=254, pattern=EMAIL_PATTERN)
    language: Language = "en"


class ResetConfirm(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)
    new_password: str = Field(..., min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


async def _check_password(user: User, password: str) -> None:
    """Подтверждение паролем; неудачные попытки — под тем же лимитом, что и вход."""
    account = f"account:{user.username_key or username_key(user.username)}"
    await ensure_below_limit(
        "login_failures", account,
        settings.RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT, settings.RATE_LIMIT_LOGIN_FAILURES_WINDOW_S,
        "too_many_password_attempts",
    )
    if not verify_password(password, user.hashed_password):
        await record_attempt("login_failures", account, settings.RATE_LIMIT_LOGIN_FAILURES_WINDOW_S)
        raise ApiError(status.HTTP_400_BAD_REQUEST, "wrong_current_password")


async def _limit_mail(request: Request, email: str) -> None:
    """Письма со ссылками: не больше N на адрес и на IP за окно — чтобы через нас не засыпали чужой ящик."""
    window = settings.RATE_LIMIT_EMAIL_WINDOW_S
    await enforce_rate_limit("mail", f"ip:{client_ip(request)}", settings.RATE_LIMIT_EMAIL_PER_IP, window,
                             "too_many_emails")
    await enforce_rate_limit("mail", f"to:{email_links.normalize(email)}", settings.RATE_LIMIT_EMAIL_PER_ADDRESS,
                             window, "too_many_emails")


@router.get("/export")
async def export_my_data(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Все данные игрока одним файлом JSON (GDPR, право на переносимость); только свои, нужен вход."""
    data = await service.export_data(db, user)
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="regence-{user.id}.json"'})


@router.get("/games.pgn", response_class=PlainTextResponse)
async def export_my_games_pgn(offset: int = Query(0, ge=0), user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    """
    Свои завершённые партии одним файлом PGN (таск 24.3) — открыть в любой шахматной программе. За один запрос —
    не больше account.GAMES_PGN_LIMIT партий, от старых к новым; общее число — в заголовке X-Total-Count, дальше —
    параметр offset.
    """
    text, total = await service.games_pgn(db, user, offset)
    return PlainTextResponse(text, media_type="application/x-chess-pgn", headers={
        "Content-Disposition": f'attachment; filename="regence-games-{user.id}.pgn"', "X-Total-Count": str(total),
    })


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
        payload: DeleteAccountRequest,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """
    Удаление своего аккаунта с подтверждением паролем. Строка в users не стирается, а обезличивается: имя
    заменяется на deleted_<id>, личные данные и свои записи (прогресс, задачи, турниры, импорт) удаляются, все
    токены отзываются; партии остаются у соперников. Пока идёт партия — отказ 409 account_in_game.
    """
    await _check_password(user, payload.password)
    await service.delete_account(db, user)


@router.post("/email", status_code=status.HTTP_202_ACCEPTED)
async def request_email(
        payload: EmailRequest, request: Request,
        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Привязать e-mail: письмо со ссылкой подтверждения; адрес попадёт в профиль только по ссылке."""
    await _check_password(user, payload.password)
    await _limit_mail(request, payload.email)
    await email_links.request_verification(db, user, payload.email, payload.language)


@router.post("/email/remove", status_code=status.HTTP_204_NO_CONTENT)
async def remove_email(
        payload: DeleteAccountRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    """Отвязать e-mail (с паролем): после этого сбросить пароль по почте нельзя."""
    await _check_password(user, payload.password)
    user.email = None
    await db.commit()


@router.post("/email/verify")
async def verify_email(payload: TokenRequest, db: AsyncSession = Depends(get_db)):
    """Ссылка из письма (без входа — по токену из неё): адрес подтверждён и записан в профиль (users.email)."""
    user = await email_links.confirm_verification(db, payload.token)
    return {"email": user.email}


@router.post("/password-reset", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(payload: ResetRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Письмо со ссылкой сброса (без входа). Ответ одинаковый, есть такой адрес или нет, — чтобы по нему нельзя было
    узнать, привязан ли адрес к чьему-то аккаунту.
    """
    await _limit_mail(request, payload.email)
    await email_links.request_reset(db, payload.email, payload.language)


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_password_reset(payload: ResetConfirm, db: AsyncSession = Depends(get_db)):
    """Новый пароль по ссылке из письма: все сессии и прочие ссылки сброса отзываются."""
    await email_links.confirm_reset(db, payload.token, payload.new_password)
