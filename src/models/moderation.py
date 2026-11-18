# --- FILE: src/models/moderation.py ---
"""
Модерация (таск 17.4): жалобы игроков (на игрока или на сообщение в чате), автоматические заявки на проверку флага
нечестной игры и апелляции; с таска 30.3 — ещё жалобы на конкретный текст (личное сообщение, публикацию,
комментарий) и тексты, придержанные фильтром оскорблений; с 17.7 — предложения исправить перевод. Очередь
разбирает модератор (users.is_moderator), решение — код (src/services/moderation.py).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, one_of

# Виды заявок модератору (src/services/moderation.py, civility.py).
REPORT_KINDS = ("player", "message", "cheat_review", "appeal", "translation", "content", "held")
# Причины: выбираемые игроком (moderation.REASONS) и «auto» — заявка от автоматики.
REPORT_REASONS = ("cheating", "abuse", "spam", "other", "auto")
REPORT_STATUSES = ("open", "resolved")
# Решения модератора (moderation.ACTIONS); NULL — заявка ещё не разобрана.
REPORT_ACTIONS = ("dismiss", "warn", "chat_ban", "mark_cheater", "clear_cheater", "accept", "hide", "release")


class Report(Base):
    """
    Заявка в очереди модератора: жалоба игрока, автоматическая проверка флага нечестной игры, апелляция или
    придержанный текст. Решение записывается кодом.
    """
    __tablename__ = "reports"
    __table_args__ = (
        one_of("reports", "kind", REPORT_KINDS),
        one_of("reports", "reason", REPORT_REASONS),
        one_of("reports", "status", REPORT_STATUSES),
        one_of("reports", "action", REPORT_ACTIONS),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # player | message | cheat_review (автоматически при флаге) | appeal (апелляция на флаг) |
    # translation (предложение исправить текст интерфейса, таск 17.7) | content (жалоба на личное сообщение,
    # публикацию или комментарий, таск 30.3) | held (текст придержан фильтром оскорблений, src/services/civility.py)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    target_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # cheating | abuse | spam | other | auto
    reason: Mapped[str] = mapped_column(String(16))
    # Текст жалобщика и копия сообщения из чата (ввод людей — для модератора, не строки интерфейса).
    comment: Mapped[str | None] = mapped_column(String(300), nullable=True)
    message_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Для translation: «язык:ключ» каталога и страница, где предложено (контекст). Для content и held subject —
    # ссылка на текст: «dm:id», «post:id» или «comment:id».
    subject: Mapped[str | None] = mapped_column(String(200), nullable=True)
    context: Mapped[str | None] = mapped_column(String(200), nullable=True)
    game_id: Mapped[int | None] = mapped_column(ForeignKey("games.id", ondelete="SET NULL"), nullable=True, index=True)
    # open | resolved
    status: Mapped[str] = mapped_column(String(16), default="open", server_default="open", index=True)
    # Решение (moderation.ACTIONS): dismiss | warn | chat_ban | mark_cheater | clear_cheater | accept (для
    # translation) | hide (убрать текст) | release (выпустить придержанный текст)
    action: Mapped[str | None] = mapped_column(String(16), nullable=True)
    moderator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
