# --- FILE: src/models/collection.py ---
"""
«Забавные подборки» архива (таск 16.3): самые короткие партии, больше всего шахов и т. п. Считаются заранее
скриптом scripts/build_collections.py (правила — src/services/collections.py), здесь — готовые места в подборках.
"""

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class CollectionEntry(Base):
    __tablename__ = "collection_entries"
    __table_args__ = (UniqueConstraint("collection", "rank", name="uq_collection_rank"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    collection: Mapped[str] = mapped_column(String(32), index=True)
    rank: Mapped[int] = mapped_column(Integer)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)
    # Показатель подборки: полуходов, шахов, взятий подряд, превращений, проходных.
    value: Mapped[int] = mapped_column(Integer)
