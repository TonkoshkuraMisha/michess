# --- FILE: migrations/versions/c3f8a2e1d9b7_split_rating_by_time_control.py ---

"""split_rating_by_time_control

Один общий ELO-рейтинг заменён на отдельные пулю/блиц/рапид/классику (как на chess.com и
lichess.org) — пуля и классика не сравнимы между собой, а общая цифра их смешивала. Категория
определяется по base_time_ms/increment_ms партии (та же эвристика, что в
src.services.rating.classify_time_control: оценка длительности — база + 40 добавлений).

Заодно заводится счётчик сыгранных рейтинговых партий по категориям — раньше он каждый раз
пересчитывался запросом COUNT(*) по games при завершении партии.

Revision ID: c3f8a2e1d9b7
Revises: b7e3f1a9c2d4
Create Date: 2026-11-11 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3f8a2e1d9b7"
down_revision: str | Sequence[str] | None = "b7e3f1a9c2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATEGORIES = ("bullet", "blitz", "rapid", "classical")


def _classify(base_time_ms: int, increment_ms: int) -> str:
    estimated_s = base_time_ms / 1000 + 40 * (increment_ms / 1000)
    if estimated_s < 180:
        return "bullet"
    if estimated_s < 480:
        return "blitz"
    if estimated_s < 1500:
        return "rapid"
    return "classical"


def upgrade() -> None:
    for category in CATEGORIES:
        op.add_column(
            "users", sa.Column(f"{category}_rating", sa.Integer(), server_default="1200", nullable=False)
        )
        op.add_column(
            "users", sa.Column(f"{category}_games_played", sa.Integer(), server_default="0", nullable=False)
        )

    bind = op.get_bind()

    # Существующий общий рейтинг — стартовое значение для всех категорий сразу, иначе у уже
    # игравших пользователей он бы сбросился к 1200 во всех категориях, кроме фактической.
    bind.execute(sa.text(
        "UPDATE users SET bullet_rating = rating, blitz_rating = rating, "
        "rapid_rating = rating, classical_rating = rating"
    ))

    # Число уже сыгранных рейтинговых партий по категориям — иначе K-фактор ELO сразу после
    # миграции считал бы всех новичками (K=40) вне зависимости от реальной истории партий.
    rows = bind.execute(sa.text(
        "SELECT white_player_id, black_player_id, base_time_ms, increment_ms "
        "FROM games WHERE status = 'COMPLETED' AND is_rated = true"
    )).fetchall()

    counts: dict[tuple[int, str], int] = {}
    for white_id, black_id, base_time_ms, increment_ms in rows:
        category = _classify(base_time_ms, increment_ms)
        counts[(white_id, category)] = counts.get((white_id, category), 0) + 1
        counts[(black_id, category)] = counts.get((black_id, category), 0) + 1

    for (user_id, category), count in counts.items():
        bind.execute(
            sa.text(f"UPDATE users SET {category}_games_played = :count WHERE id = :uid"),  # noqa: S608
            {"count": count, "uid": user_id},
        )

    op.drop_column("users", "rating")


def downgrade() -> None:
    op.add_column("users", sa.Column("rating", sa.Integer(), server_default="1200", nullable=False))
    bind = op.get_bind()
    # Блиц — ближайший по смыслу к историческому единому рейтингу.
    bind.execute(sa.text("UPDATE users SET rating = blitz_rating"))

    for category in CATEGORIES:
        op.drop_column("users", f"{category}_rating")
        op.drop_column("users", f"{category}_games_played")
