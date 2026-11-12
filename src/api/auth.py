import secrets

from fastapi import APIRouter, Depends, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import WS_TICKET_PREFIX, get_current_user
from src.api.rate_limit import client_ip, enforce_rate_limit, ensure_below_limit, record_attempt
from src.core.config import settings
from src.core.errors import ApiError
from src.core.security import create_user_token, get_password_hash, verify_password
from src.db import redis as redis_module
from src.db.session import get_db
from src.models.user import User
from src.schemas.user import UserCreate, UserResponse, username_key

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Имена, совпадающие с маршрутами (/profile/me, /profile/leaderboard ...) или выдающие себя
# за администрацию сайта. Сравнение без учёта регистра.
RESERVED_USERNAMES = frozenset({
    "me", "leaderboard", "games", "matchmaking", "profile", "auth", "api", "ws",
    "admin", "administrator", "moderator", "support", "system", "root",
    "michess", "bot", "guest", "anonymous", "null", "undefined",
})

# Хэш для сравнения, когда пользователя нет: ответ занимает столько же времени, что и при
# неверном пароле, и по времени нельзя узнать, существует ли аккаунт.
_DUMMY_PASSWORD_HASH = get_password_hash("timing-equalizer-not-a-real-password")


def _is_reserved(username: str) -> bool:
    from src.api.bots import reserved_bot_usernames
    from src.db.seed import get_champion_meta

    key = username_key(username)
    return (
        key in RESERVED_USERNAMES
        or key in reserved_bot_usernames()
        or get_champion_meta(username) is not None  # профиль чемпиона перекрыл бы аккаунт
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(user_in: UserCreate, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Register a new user.
    """
    await enforce_rate_limit(
        "register", f"ip:{client_ip(request)}",
        settings.RATE_LIMIT_REGISTER_PER_IP, settings.RATE_LIMIT_REGISTER_WINDOW_S,
        "too_many_registrations",
    )

    if _is_reserved(user_in.username):
        raise ApiError(status.HTTP_400_BAD_REQUEST, "username_reserved")

    key = username_key(user_in.username)
    # username_key есть у аккаунтов с паролем; архивные игроки из PGN и боты его не имеют,
    # поэтому с ними сверяемся и по самому имени.
    result = await db.execute(select(User.id).where(or_(
        User.username_key == key,
        func.lower(User.username) == user_in.username.lower(),
    )))
    if result.first() is not None:
        raise ApiError(status.HTTP_400_BAD_REQUEST, "username_taken")

    new_user = User(
        username=user_in.username,
        username_key=key,
        hashed_password=get_password_hash(user_in.password),
    )
    db.add(new_user)
    try:
        await db.commit()
    except IntegrityError:
        # Параллельная регистрация того же имени (в другом регистре) — уникальный индекс в БД.
        await db.rollback()
        raise ApiError(status.HTTP_400_BAD_REQUEST, "username_taken") from None
    await db.refresh(new_user)

    return new_user


async def _find_login_user(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()
    if user is None:
        # Вход в любом регистре: «misha» найдёт аккаунт «Misha».
        result = await db.execute(select(User).where(User.username_key == username_key(username)))
        user = result.scalars().first()
    return user


@router.post("/login")
async def login(
        request: Request,
        form_data: OAuth2PasswordRequestForm = Depends(),
        db: AsyncSession = Depends(get_db)
):
    """
    OAuth2 compatible token login, get an access token for future requests.

    Подбор пароля ограничен дважды: все попытки с одного IP (перебор по многим аккаунтам)
    и неудачные попытки на один аккаунт (перебор одного пароля с многих адресов).
    """
    await enforce_rate_limit(
        "login", f"ip:{client_ip(request)}",
        settings.RATE_LIMIT_LOGIN_PER_IP, settings.RATE_LIMIT_LOGIN_WINDOW_S,
        "too_many_login_attempts",
    )
    account = f"account:{username_key(form_data.username)}"
    await ensure_below_limit(
        "login_failures", account,
        settings.RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT, settings.RATE_LIMIT_LOGIN_FAILURES_WINDOW_S,
        "account_login_locked",
    )

    user = await _find_login_user(db, form_data.username)
    password_ok = verify_password(form_data.password, user.hashed_password if user else _DUMMY_PASSWORD_HASH)

    if user is None or not password_ok:
        await record_attempt("login_failures", account, settings.RATE_LIMIT_LOGIN_FAILURES_WINDOW_S)
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "login_failed", headers={"WWW-Authenticate": "Bearer"})

    access_token = create_user_token(user)

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


@router.post("/ws-ticket")
async def issue_ws_ticket(current_user: User = Depends(get_current_user)):
    """
    Одноразовый тикет для подключения WebSocket (?ticket=...), действует WS_TICKET_TTL_S секунд.
    JWT в адресе WebSocket попадал бы в логи сервера и прокси.
    """
    await enforce_rate_limit(
        "ws_ticket", f"user:{current_user.id}", settings.RATE_LIMIT_WS_TICKETS, 60,
        "too_many_reconnects",
    )
    ticket = secrets.token_urlsafe(32)
    await redis_module.redis_client.set(
        f"{WS_TICKET_PREFIX}{ticket}",
        f"{current_user.id}:{current_user.token_version}",
        ex=settings.WS_TICKET_TTL_S,
    )
    return {"ticket": ticket, "expires_in": settings.WS_TICKET_TTL_S}


async def _revoke_all_tokens(db: AsyncSession, user: User) -> None:
    """Отзывает все выданные токены пользователя и закрывает его открытые WebSocket."""
    from src.services.connection_manager import manager

    user.token_version = (user.token_version or 0) + 1
    await db.commit()
    await manager.revoke_sessions(user.id)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_everywhere(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Выход на всех устройствах: все выданные токены (включая текущий) перестают действовать."""
    await _revoke_all_tokens(db, current_user)


class PasswordChange(BaseModel):
    current_password: str = Field(..., max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


@router.post("/change-password")
async def change_password(
        payload: PasswordChange,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """
    Смена пароля. Все ранее выданные токены отзываются (на случай, если пароль меняют из-за
    утечки), а текущему клиенту возвращается новый токен, чтобы он остался в системе.
    """
    account = f"account:{current_user.username_key or username_key(current_user.username)}"
    await ensure_below_limit(
        "login_failures", account,
        settings.RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT, settings.RATE_LIMIT_LOGIN_FAILURES_WINDOW_S,
        "too_many_password_attempts",
    )
    if not verify_password(payload.current_password, current_user.hashed_password):
        await record_attempt("login_failures", account, settings.RATE_LIMIT_LOGIN_FAILURES_WINDOW_S)
        raise ApiError(status.HTTP_400_BAD_REQUEST, "wrong_current_password")

    current_user.hashed_password = get_password_hash(payload.new_password)
    await _revoke_all_tokens(db, current_user)
    return {"access_token": create_user_token(current_user), "token_type": "bearer"}
