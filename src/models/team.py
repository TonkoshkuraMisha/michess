# --- FILE: src/models/team.py ---
"""
Команды и сезонная лига (таск 17.2): игрок состоит не больше чем в одной команде. Очки лиги считаются по сыгранным
рейтинговым партиям между игроками разных команд (src/services/league.py) — отдельной таблицы результатов нет.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Имя команды — текст игрока (не строка интерфейса); уникально без учёта регистра (проверяет сервис).
    name: Mapped[str] = mapped_column(String(30), unique=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    # Один игрок — одна команда.
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
