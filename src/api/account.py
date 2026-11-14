# --- FILE: src/api/account.py ---
"""Учётная запись (таски 17.5, 23.1): выгрузка своих данных и удаление аккаунта (src/services/account.py)."""

from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import client_ip, enforce_rate_limit, ensure_below_limit, record_attempt
from src.core.config import settings
from src.core.errors import ApiError
from src.core.security import verify_password
from src.db.session import get_db
from src.models.user import User
from src.schemas.user import username_key
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
    new_password: str = Field(..., min_length=8, max_length=128)


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
    """Все данные игрока одним файлом JSON (GDPR, право на переносимость)."""
    data = await service.export_data(db, user)
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="michess-{user.id}.json"'})


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
        payload: DeleteAccountRequest,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """Удаление аккаунта с подтверждением паролем."""
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
    """Ссылка из письма: адрес подтверждён и записан в профиль."""
    user = await email_links.confirm_verification(db, payload.token)
    return {"email": user.email}


@router.post("/password-reset", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(payload: ResetRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Письмо со ссылкой сброса. Ответ одинаковый, есть такой адрес или нет."""
    await _limit_mail(request, payload.email)
    await email_links.request_reset(db, payload.email, payload.language)


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_password_reset(payload: ResetConfirm, db: AsyncSession = Depends(get_db)):
    """Новый пароль по ссылке из письма: все сессии и прочие ссылки сброса отзываются."""
    await email_links.confirm_reset(db, payload.token, payload.new_password)
