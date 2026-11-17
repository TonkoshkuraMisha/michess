"""
Библиотека партий (таск 27.1): отдельная от партий игроков и ботов (`games`) база — подборки владельца, партии
мастеров, примерные партии пешечных структур и дебютного репертуара. Только заголовки и ходы; комментарии к ходам —
позже (27.4). Импорт — scripts/import_library.py (27.2).

Коллекции — дерево (папка → подпапка). Партия может лежать в нескольких коллекциях; одинаковые партии из разных
файлов сливаются по `moves_hash` (игроки + год + ходы). Видимость задаёт коллекция: public — всем, owner — только
владельцу коллекции, staff — модераторам.
"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base

VISIBILITIES = ("public", "owner", "staff")


class LibraryCollection(Base):
    """Коллекция библиотеки — узел дерева папок, со своей видимостью: публичная, только владельцу или служебная."""
    __tablename__ = "library_collections"

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("library_collections.id", ondelete="CASCADE"),
                                                  nullable=True, index=True)
    # Полный путь «Пешечные структуры/Изолированная пешка» — ключ повторного импорта.
    path: Mapped[str] = mapped_column(String(500), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    visibility: Mapped[str] = mapped_column(String(8), default="public", server_default="public")
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="", server_default="")
    sort: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LibraryGame(Base):
    """
    Партия библиотеки: заголовки и главная линия ходов; метки для поиска (пешечная структура, «закончилась матом»)
    ставит разметка.
    """
    __tablename__ = "library_games"

    id: Mapped[int] = mapped_column(primary_key=True)
    moves_hash: Mapped[str] = mapped_column(String(64), unique=True)
    white: Mapped[str] = mapped_column(String(120), default="", server_default="", index=True)
    black: Mapped[str] = mapped_column(String(120), default="", server_default="", index=True)
    event: Mapped[str] = mapped_column(String(200), default="", server_default="")
    site: Mapped[str] = mapped_column(String(200), default="", server_default="")
    date: Mapped[str] = mapped_column(String(10), default="", server_default="")
    year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    round: Mapped[str] = mapped_column(String(20), default="", server_default="")
    result: Mapped[str] = mapped_column(String(7), default="*", server_default="*")
    white_elo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_elo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eco: Mapped[str] = mapped_column(String(3), default="", server_default="", index=True)
    opening: Mapped[str] = mapped_column(String(200), default="", server_default="")
    start_fen: Mapped[str | None] = mapped_column(String(100), nullable=True)
    plies: Mapped[int] = mapped_column(Integer, default=0, server_default="0", index=True)
    # Пешечная структура партии (таск 27.5, src/services/pawn_structures.py); None — не определена.
    structure: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    # Партия закончилась матом на доске (миниатюры 27.9 выбираются по этой метке).
    mate_finish: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", index=True)
    moves: Mapped[str] = mapped_column(Text, default="", server_default="")  # UCI через пробел
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LibraryGameCollection(Base):
    """Связь «партия — коллекция»: одна партия может лежать в нескольких коллекциях."""
    __tablename__ = "library_game_collections"
    __table_args__ = (UniqueConstraint("collection_id", "game_id", name="uq_library_game_collection"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    collection_id: Mapped[int] = mapped_column(ForeignKey("library_collections.id", ondelete="CASCADE"), index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("library_games.id", ondelete="CASCADE"), index=True)
    sort: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class LibraryAnnotation(Base):
    """
    Аннотация партии библиотеки (таск 27.4, docs/research/library-annotations.md): одна на партию. body — документ
    {"evals": [...], "comments": {ply: {"comment": [{key, params}], "arrows": [...]}}, "notes": {...}} — комментарии
    наставника кодами coach.* (как в «Классике» 14.7) и, позже, свои тексты на трёх языках. Статус: auto — черновик
    наставника (виден всем с пометкой), draft / review — у авторов, approved — проверено владельцем.
    """

    __tablename__ = "library_annotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("library_games.id", ondelete="CASCADE"), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(10), default="auto", server_default="auto", index=True)
    body: Mapped[dict] = mapped_column(JSON, default=dict)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
