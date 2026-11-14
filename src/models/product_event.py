from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.models.base import Base


class ProductEvent(Base):
    """
    Продуктовое событие (таск 23.5): своя аналитика без сторонних трекеров. Только вид события, игрок и время —
    ни IP, ни имени, ни содержимого партий. Каждый вид — не чаще раза в сутки UTC на игрока: этого хватает для
    воронки (первая партия, первая задача) и удержания (активные дни), а таблица растёт предсказуемо.
    """

    __tablename__ = "product_events"
    __table_args__ = (UniqueConstraint("user_id", "kind", "day", name="uq_product_event_daily"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
