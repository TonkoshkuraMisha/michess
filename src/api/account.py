# --- FILE: src/api/account.py ---
"""Учётная запись (таски 17.5, 23.1): выгрузка своих данных и удаление аккаунта (src/services/account.py)."""

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import ensure_below_limit, record_attempt
from src.core.config import settings
from src.core.errors import ApiError
from src.core.security import verify_password
from src.db.session import get_db
from src.models.user import User
from src.schemas.user import username_key
from src.services import account as service

router = APIRouter(prefix="/account", tags=["Account"])


class DeleteAccountRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


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
    """Удаление аккаунта с подтверждением паролем; неудачные попытки — под тем же лимитом, что и вход."""
    account = f"account:{user.username_key or username_key(user.username)}"
    await ensure_below_limit(
        "login_failures", account,
        settings.RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT, settings.RATE_LIMIT_LOGIN_FAILURES_WINDOW_S,
        "too_many_password_attempts",
    )
    if not verify_password(payload.password, user.hashed_password):
        await record_attempt("login_failures", account, settings.RATE_LIMIT_LOGIN_FAILURES_WINDOW_S)
        raise ApiError(status.HTTP_400_BAD_REQUEST, "wrong_current_password")
    await service.delete_account(db, user)
