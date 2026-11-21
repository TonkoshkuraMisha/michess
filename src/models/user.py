"""
Игрок (таблица users). В той же таблице лежат боты и архивные игроки из PGN — у них is_bot и нет username_key.

Что хранится: имя и ключ имени без учёта регистра, хэш пароля и версия токенов (src/core/security.py),
необязательный подтверждённый e-mail, четыре рейтинга по категориям контроля времени и счётчики партий к ним
(src/services/rating.py), рейтинг лестницы и рейтинг решателя задач, признаки античита (trust_factor, is_cheater —
src/services/anticheat.py), роль модератора, настройки интерфейса (язык, тема, аватар), страна для конференций
(src/services/conferences.py). При удалении аккаунта строка не стирается, а обезличивается
(src/services/account.py).
"""

from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.models.base import Base, one_of

# Кто может писать игроку личные сообщения (src/services/direct_messages.py, POLICIES).
DM_POLICIES = ("all", "following", "nobody")

RatingCategory = Literal["bullet", "blitz", "rapid", "classical"]
RATING_CATEGORIES: tuple[RatingCategory, ...] = ("bullet", "blitz", "rapid", "classical")


class User(Base):
    """
    Запись таблицы users: живой игрок, бот или архивный игрок из PGN. Что в каких полях — в описании модуля выше.
    """
    __tablename__ = "users"
    __table_args__ = (one_of("users", "dm_policy", DM_POLICIES),)

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    # Нормализованное имя (casefold) аккаунтов, входящих по паролю: уникальность без учёта
    # регистра («Misha» и «misha» — один аккаунт) и вход в любом регистре. У архивных игроков
    # из PGN и ботов — NULL: их имена из заголовков партий могут различаться только регистром,
    # а NULL уникальный индекс не ограничивает.
    username_key: Mapped[str | None] = mapped_column(String(50), unique=True, index=True, nullable=True)
    # Хэш bcrypt (src/core/security.py). У ботов и архивных игроков — метка, которая хэшем не является
    # («!historical_bot_no_login!» — src/api/bots.py, «!historical_archive_no_login!» — src/db/seed.py): войти
    # под ними нельзя; по второй метке «Просмотр» и поиск игроков отличают архивных игроков.
    hashed_password: Mapped[str] = mapped_column(String)
    # Версия токенов: входит в JWT и сверяется при каждой проверке. Увеличение (смена пароля,
    # «выйти на всех устройствах») делает недействительными все ранее выданные токены.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Аккаунт удалён по просьбе игрока (таск 17.5): имя заменено на deleted_<id>, пароль непригоден, личные данные
    # стёрты; партии остаются у соперников без его имени.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Подтверждённый e-mail (таск 17.5) — необязателен; нужен для сброса пароля. Хранится только подтверждённый:
    # адрес, который ещё не подтвердили, живёт в одноразовой ссылке (EmailToken), и чужой адрес так не занять.
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True, nullable=True)
    # Согласие с условиями при регистрации (таск 23.1, src/services/legal.py): редакция документов и момент согласия.
    # У архивных игроков из PGN, ботов и аккаунтов, созданных до появления согласия, — NULL.
    terms_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ELO-рейтинг по отдельности для каждой категории контроля времени (как на chess.com и
    # lichess.org) — единого «общего» рейтинга больше нет, пуля/блиц/рапид/классика не
    # сравнимы между собой. Категория определяется по base_time_ms/increment_ms партии,
    # см. src.services.rating.classify_time_control.
    bullet_rating: Mapped[int] = mapped_column(Integer, default=1200, server_default="1200", nullable=False)
    blitz_rating: Mapped[int] = mapped_column(Integer, default=1200, server_default="1200", nullable=False)
    rapid_rating: Mapped[int] = mapped_column(Integer, default=1200, server_default="1200", nullable=False)
    classical_rating: Mapped[int] = mapped_column(Integer, default=1200, server_default="1200", nullable=False)

    # Число сыгранных рейтинговых партий в каждой категории — определяет K-фактор ELO
    # (новичкам рейтинг двигается быстрее). Хранится как счётчик, а не через COUNT(*) по
    # games при каждом завершении партии.
    bullet_games_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    blitz_games_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    rapid_games_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    classical_games_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    # Клубная лестница (таск 10.4): отдельный рейтинг в партиях с ботами без подсказок движка и
    # возвратов хода. Пройденные ступени — таблица ladder_beaten (src/models/ladder.py), текущую считает
    # src/services/ladder.py.
    ladder_rating: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000", nullable=False)
    ladder_games: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Рейтинг решателя задач (таск 13.1) — отдельная категория, на игровые рейтинги не влияет.
    puzzle_rating: Mapped[int] = mapped_column(Integer, default=1500, server_default="1500", nullable=False)
    puzzle_games: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Личные рекорды режима на время (таск 13.3): решено задач за 3 и за 5 минут.
    puzzle_best_3: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    puzzle_best_5: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    # Исторический бот (играбельный AI) или архивный исторический игрок (партии из PGN,
    # посмотреть — нельзя сыграть) — не реальный зарегистрированный игрок, вне таблицы лидеров.
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    # Античит (src/services/anticheat.py): фактор доверия начинается со 100 и уменьшается штрафами за «машинный»
    # ритм ходов; ниже anticheat.CHEATER_TRUST_THRESHOLD (30) ставится флаг is_cheater и создаётся заявка
    # модератору. Снять или подтвердить флаг может только модератор (src/services/moderation.py).
    is_cheater: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    trust_factor: Mapped[int] = mapped_column(Integer, default=100)
    # Модерация (таск 17.4): роль модератора (scripts/make_moderator.py) и отключённый чат до момента.
    is_moderator: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    chat_banned_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Языки (таск 17.7): язык интерфейса хранится в профиле (переходит между устройствами) и режим «помощник
    # перевода» — кнопка «Предложить исправление текста».
    language: Mapped[str | None] = mapped_column(String(2), nullable=True)
    translation_helper: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # Оформление (таск 18.3): выбранная тема-комплект (код из frontend/src/config/themePresets.ts) — переходит между
    # устройствами; гость хранит её в браузере.
    theme_preset: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Аватар (таск 18.4) из собственного набора: фигура «Льюис» и цвет фона, например «wN-3»; нет — по имени.
    avatar: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Кто может писать личные сообщения (таск 30.1): all | following (только те, на кого подписан я) | nobody.
    dm_policy: Mapped[str] = mapped_column(String(16), default="all", server_default="all", nullable=False)
    # Конференция (таск 33.6, src/services/conferences.py): страна, которую игрок сам указал в профиле (код ISO
    # 3166-1 alpha-2), и сезон «ГГГГ-ММ», в котором он последний раз менял конференцию (одна смена за сезон).
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    country_season: Mapped[str | None] = mapped_column(String(7), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def rating_for(self, category: RatingCategory) -> int:
        """Рейтинг игрока в категории контроля времени (колонка <категория>_rating)."""
        return getattr(self, f"{category}_rating")

    def games_played_for(self, category: RatingCategory) -> int:
        """Число рейтинговых партий в категории (колонка <категория>_games_played) — от него зависит K-фактор."""
        return getattr(self, f"{category}_games_played")


# Профиль, регистрация, поиск игроков и жалобы ищут имя без учёта регистра (lower(username)): без индекса по этому
# выражению каждый такой запрос читал всю таблицу (ревизия базы 29.1).
Index("ix_users_username_lower", func.lower(User.username))
