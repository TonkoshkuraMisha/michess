# --- FILE: src/models/moderation.py ---
"""
Модерация (таск 17.4): жалобы игроков (на игрока или на сообщение в чате), автоматические заявки на проверку флага
нечестной игры и апелляции. Очередь разбирает модератор (users.is_moderator), решение — код (src/services/moderation.py).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Report(Base):
    """
    Заявка в очереди модератора: жалоба игрока, автоматическая проверка флага нечестной игры, апелляция или
    придержанный текст. Решение записывается кодом.
    """
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    # player | message | cheat_review (автоматически при флаге) | appeal (апелляция на флаг) |
    # translation (предложение исправить текст интерфейса, таск 17.7)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    target_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # cheating | abuse | spam | other | auto
    reason: Mapped[str] = mapped_column(String(16))
    # Текст жалобщика и копия сообщения из чата (ввод людей — для модератора, не строки интерфейса).
    comment: Mapped[str | None] = mapped_column(String(300), nullable=True)
    message_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Для translation: «язык:ключ» каталога и страница, где предложено (контекст).
    subject: Mapped[str | None] = mapped_column(String(200), nullable=True)
    context: Mapped[str | None] = mapped_column(String(200), nullable=True)
    game_id: Mapped[int | None] = mapped_column(ForeignKey("games.id", ondelete="SET NULL"), nullable=True)
    # open | resolved
    status: Mapped[str] = mapped_column(String(16), default="open", server_default="open", index=True)
    # Решение: dismiss | warn | chat_ban | mark_cheater | clear_cheater | accept (для translation)
    action: Mapped[str | None] = mapped_column(String(16), nullable=True)
    moderator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
