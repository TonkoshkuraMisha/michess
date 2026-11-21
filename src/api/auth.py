"""
Регистрация и вход (/auth).

* Регистрация: правила имени — src/schemas/user.py; имена маршрутов, ботов и чемпионов зарезервированы
  (RESERVED_USERNAMES, reserved_bot_usernames). При REGISTRATION_INVITE_ONLY нужен действующий код-приглашение
  (src/services/beta.py). Ответы на два необязательных вопроса дают стартовый рейтинг (src/services/onboarding.py).
* Вход: пароль сверяется с хэшем (src/core/security.py). Подбор ограничен дважды — все попытки с одного адреса и
  неудачные попытки на один аккаунт (настройки RATE_LIMIT_LOGIN_*). Для несуществующего имени сверяется
  пароль-пустышка, чтобы по времени ответа нельзя было узнать, есть ли такой аккаунт.
* Сессия: короткий access-токен в ответе и refresh-токен в cookie HttpOnly (src/services/auth_sessions.py);
  /refresh выдаёт новый access-токен, /logout снимает сессию на этом устройстве, /logout-all и смена пароля
  отзывают все токены и закрывают открытые WebSocket игрока.
* /ws-ticket — одноразовый тикет для подключения WebSocket (см. src/api/deps.py).
"""

import secrets

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import WS_TICKET_PREFIX, get_current_user
from src.api.rate_limit import client_ip, enforce_rate_limit, ensure_below_limit, record_attempt
from src.core.config import settings
from src.core.errors import ApiError, error_payload
from src.core.security import create_user_token, get_password_hash, verify_password
from src.db import redis as redis_module
from src.db.session import get_db
from src.models.user import RATING_CATEGORIES, User
from src.schemas.user import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, UserCreate, UserResponse, username_key
from src.services import auth_sessions, beta, legal, product_metrics
from src.services.onboarding import starting_rating

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Имена, совпадающие с маршрутами (/profile/me, /profile/leaderboard ...) или выдающие себя
# за администрацию сайта. Сравнение без учёта регистра.
RESERVED_USERNAMES = frozenset({
    "me", "leaderboard", "games", "matchmaking", "profile", "auth", "api", "ws",
    "admin", "administrator", "moderator", "support", "system", "root",
    "regence", "michess", "bot", "guest", "anonymous", "null", "undefined",
})

# Хэш для сравнения, когда пользователя нет: ответ занимает столько же времени, что и при
# неверном пароле, и по времени нельзя узнать, существует ли аккаунт.
_DUMMY_PASSWORD_HASH = get_password_hash("timing-equalizer-not-a-real-password")


def _is_reserved(username: str) -> bool:
    """
    Имя занять нельзя: оно совпадает (без учёта регистра) с маршрутом или служебным словом, с id бота или архетипа
    либо с именем чемпиона из архива. Той же проверкой пользуются имена соперников мастерской
    (src/api/personalities.py).
    """
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
    Регистрация (без входа): создаёт запись в users и возвращает данные нового игрока; токен выдаёт отдельный
    запрос /auth/login. Порядок проверок: лимит регистраций с адреса → согласие с условиями (terms_not_accepted,
    400; таск 23.1) → код-приглашение (при закрытой
    регистрации) → зарезервированное имя → занятость имени без учёта регистра. Отказы — коды
    too_many_registrations (429), registration_invite_* (403), username_reserved и username_taken (400).
    """
    await enforce_rate_limit(
        "register", f"ip:{client_ip(request)}",
        settings.RATE_LIMIT_REGISTER_PER_IP, settings.RATE_LIMIT_REGISTER_WINDOW_S,
        "too_many_registrations",
    )

    legal.require_consent(user_in.accept_terms, settings.REQUIRE_TERMS_CONSENT)

    # Закрытая регистрация (таск 24.4): без кода-приглашения дальше не идём — и занятость имён не раскрываем.
    invite_code = beta.normalize_code(user_in.invite_code)
    if settings.REGISTRATION_INVITE_ONLY:
        if not invite_code:
            raise ApiError(status.HTTP_403_FORBIDDEN, "registration_invite_required")
        if not await beta.invite_usable(db, invite_code):
            raise ApiError(status.HTTP_403_FORBIDDEN, "registration_invite_invalid")

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

    # Стартовый рейтинг по ответам при регистрации (таск 17.8) — во всех категориях игры и в задачах. Без ответов —
    # значения по умолчанию модели (игра 1200, задачи 1500).
    ratings: dict[str, int] = {}
    if user_in.experience is not None or user_in.strength is not None:
        start = starting_rating(user_in.experience, user_in.strength)
        ratings = {f"{c}_rating": start for c in (*RATING_CATEGORIES, "puzzle")}
    new_user = User(
        username=user_in.username,
        username_key=key,
        hashed_password=get_password_hash(user_in.password),
        **ratings,
    )
    legal.record_consent(new_user, user_in.accept_terms)
    db.add(new_user)
    # Код списывается в той же транзакции, что и создание аккаунта. При открытой регистрации код необязателен:
    # действующий засчитывается (видно, кто пришёл по приглашению), недействительный — не мешает.
    if not await beta.consume_invite(db, invite_code) and settings.REGISTRATION_INVITE_ONLY:
        await db.rollback()  # код исчерпали или отозвали между проверкой и списанием
        raise ApiError(status.HTTP_403_FORBIDDEN, "registration_invite_invalid")
    try:
        await db.commit()
    except IntegrityError:
        # Параллельная регистрация того же имени (в другом регистре) — уникальный индекс в БД.
        await db.rollback()
        raise ApiError(status.HTTP_400_BAD_REQUEST, "username_taken") from None
    await db.refresh(new_user)
    await product_metrics.record_event(db, new_user.id, product_metrics.REGISTERED)
    await db.commit()

    return new_user


async def _find_login_user(db: AsyncSession, username: str) -> User | None:
    """Запись для входа: сначала точное имя, затем без учёта регистра (username_key)."""
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
        response: Response,
        form_data: OAuth2PasswordRequestForm = Depends(),
        db: AsyncSession = Depends(get_db)
):
    """
    Вход по имени и паролю (форма OAuth2: поля username и password). Возвращает короткий access-токен и ставит
    refresh-cookie долгого входа (src/services/auth_sessions.py). Неверное имя или пароль — один и тот же ответ
    401 login_failed.

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
    auth_sessions.set_refresh_cookie(response, await auth_sessions.issue(user.id, user.token_version or 0))

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


@router.post("/refresh")
async def refresh_session(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    """
    Новый короткий access-токен по refresh-cookie (таск 17.5): клиент зовёт при загрузке страницы и незадолго до
    истечения токена. 401 — сессии нет или она отозвана (выход, «выйти везде», смена пароля, удаление аккаунта).
    """
    token = auth_sessions.read_refresh_cookie(request.cookies)
    found = await auth_sessions.lookup(token)
    user = await db.get(User, found[0]) if found else None
    if (token is None or found is None or user is None or user.deleted_at is not None
            or (user.token_version or 0) != found[1]):
        # Ответ собирается здесь, а не исключением: иначе стирание отозванной cookie потерялось бы.
        rejected = JSONResponse({"detail": error_payload("not_authenticated")}, status_code=401,
                                headers={"WWW-Authenticate": "Bearer"})
        auth_sessions.clear_refresh_cookie(rejected)
        auth_sessions.clear_refresh_cookie(rejected, auth_sessions.LEGACY_REFRESH_COOKIE)
        return rejected
    # Срок cookie продлевается вместе с записью в Redis: активный игрок не выходит сам собой.
    # Кука под прежним именем переезжает под новое (LEGACY_REFRESH_COOKIE).
    auth_sessions.set_refresh_cookie(response, token)
    if auth_sessions.LEGACY_REFRESH_COOKIE in request.cookies:
        auth_sessions.clear_refresh_cookie(response, auth_sessions.LEGACY_REFRESH_COOKIE)
    return {"access_token": create_user_token(user), "token_type": "bearer"}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request) -> Response:
    """Выход на этом устройстве: refresh-сессия удаляется, cookie стирается. Access-токен клиент забывает сам."""
    await auth_sessions.revoke(auth_sessions.read_refresh_cookie(request.cookies))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    auth_sessions.clear_refresh_cookie(response)
    auth_sessions.clear_refresh_cookie(response, auth_sessions.LEGACY_REFRESH_COOKIE)
    return response


@router.post("/ws-ticket")
async def issue_ws_ticket(current_user: User = Depends(get_current_user)):
    """
    Одноразовый тикет для подключения WebSocket (?ticket=...), действует WS_TICKET_TTL_S секунд.
    JWT в адресе WebSocket попадал бы в логи сервера и прокси. Только для вошедших; не больше
    RATE_LIMIT_WS_TICKETS тикетов в минуту на игрока. Тикет хранится в Redis (ws_ticket:<тикет>) и забирается
    при подключении (src/api/deps.get_current_user_ws).
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
    """Смена пароля: текущий пароль для подтверждения и новый (не короче 8 знаков)."""
    current_password: str = Field(..., max_length=128)
    new_password: str = Field(..., min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


@router.post("/change-password")
async def change_password(
        payload: PasswordChange,
        response: Response,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """
    Смена пароля. Все ранее выданные токены отзываются (на случай, если пароль меняют из-за
    утечки), а текущему клиенту возвращается новый токен, чтобы он остался в системе.
    Неверный текущий пароль — 400 wrong_current_password; такие попытки считаются тем же счётчиком, что и
    неудачные входы на аккаунт.
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
    # Прежние refresh-сессии отозваны вместе с версией токенов; этому клиенту — новая.
    auth_sessions.set_refresh_cookie(response, await auth_sessions.issue(current_user.id, current_user.token_version))
    return {"access_token": create_user_token(current_user), "token_type": "bearer"}
