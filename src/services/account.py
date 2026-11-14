# --- FILE: src/services/account.py ---
"""
Учётная запись игрока (таски 17.5 и 23.1, GDPR): выгрузка своих данных и удаление аккаунта.

Удаление — анонимизация, а не стирание строки: партии общие с соперниками и остаются в их истории, но без имени
игрока (deleted_<id>). Личное стирается: персоналии, прогресс уроков и задач, личные задачи, рекорды, турниры,
сессии лестницы и турнира в Redis. Пароль заменяется непригодным хешем, все токены отзываются.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import ApiError
from src.core.security import get_password_hash
from src.models.email_token import EmailToken
from src.models.game import Game, GameStatus
from src.models.lesson import LessonProgress
from src.models.personality import BotPersonality
from src.models.puzzle import DrillRecord, PersonalPuzzle, PuzzleAttempt, ThemeProgress
from src.models.tournament import Tournament
from src.models.user import User

EXPORT_FORMAT = 1


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


async def export_data(db: AsyncSession, user: User) -> dict:
    """Всё, что сервер хранит об игроке, одним документом JSON (партии — с PGN)."""
    games = (await db.execute(
        select(Game).where(or_(Game.white_player_id == user.id, Game.black_player_id == user.id))
        .order_by(Game.created_at)
    )).scalars().all()
    opponent_ids = {g.black_player_id if g.white_player_id == user.id else g.white_player_id for g in games}
    names: dict[int, str] = {}
    if opponent_ids:
        rows = await db.execute(select(User.id, User.username).where(User.id.in_(opponent_ids)))
        names = {row.id: row.username for row in rows}

    personalities = (await db.execute(
        select(BotPersonality).where(BotPersonality.owner_id == user.id))).scalars().all()
    lessons = (await db.execute(select(LessonProgress).where(LessonProgress.user_id == user.id))).scalars().all()
    themes = (await db.execute(select(ThemeProgress).where(ThemeProgress.user_id == user.id))).scalars().all()
    attempts = (await db.execute(select(PuzzleAttempt).where(PuzzleAttempt.user_id == user.id)
                                 .order_by(PuzzleAttempt.created_at))).scalars().all()
    personal = (await db.execute(select(PersonalPuzzle).where(PersonalPuzzle.user_id == user.id))).scalars().all()
    records = (await db.execute(select(DrillRecord).where(DrillRecord.user_id == user.id))).scalars().all()
    tournaments = (await db.execute(select(Tournament).where(Tournament.owner_id == user.id))).scalars().all()

    return {
        "format": EXPORT_FORMAT,
        "exported_at": datetime.now(UTC).isoformat(),
        "profile": {
            "id": user.id, "username": user.username, "email": user.email, "created_at": _iso(user.created_at),
            "ratings": {
                "bullet": user.bullet_rating, "blitz": user.blitz_rating,
                "rapid": user.rapid_rating, "classical": user.classical_rating,
                "ladder": user.ladder_rating, "puzzles": user.puzzle_rating,
            },
            "games_played": {
                "bullet": user.bullet_games_played, "blitz": user.blitz_games_played,
                "rapid": user.rapid_games_played, "classical": user.classical_games_played,
                "ladder": user.ladder_games, "puzzles": user.puzzle_games,
            },
        },
        "games": [
            {
                "id": g.id, "color": "white" if g.white_player_id == user.id else "black",
                "opponent": names.get(g.black_player_id if g.white_player_id == user.id else g.white_player_id),
                "result": g.result, "termination": g.termination, "status": g.status.value,
                "base_time_ms": g.base_time_ms, "increment_ms": g.increment_ms, "is_rated": g.is_rated,
                "created_at": _iso(g.created_at), "finished_at": _iso(g.finished_at), "pgn": g.pgn,
            }
            for g in games
        ],
        "personalities": [
            {"name": p.name, "config_json": p.config_json, "created_at": _iso(p.created_at)} for p in personalities
        ],
        "lessons": [
            {"lesson": lp.lesson_id, "step": lp.step, "steps_total": lp.steps_total,
             "completed_at": _iso(lp.completed_at), "exam_score": lp.exam_score, "exam_total": lp.exam_total}
            for lp in lessons
        ],
        "puzzle_themes": [
            {"theme": tp.theme, "stage": tp.stage, "solved": tp.solved, "mastered": tp.mastered} for tp in themes
        ],
        "puzzle_attempts": [
            {"puzzle_id": a.puzzle_id, "solved": a.solved, "hints_used": a.hints_used,
             "rating_before": a.rating_before, "rating_after": a.rating_after, "at": _iso(a.created_at)}
            for a in attempts
        ],
        "personal_puzzles": [
            {"game_id": pp.game_id, "ply": pp.ply, "fen": pp.fen, "played": pp.played, "solution": pp.solution,
             "done": pp.done}
            for pp in personal
        ],
        "drill_records": [{"combo": r.combo, "best": r.best} for r in records],
        "tournaments": [
            {"id": t.id, "format": t.format, "size": t.size, "status": t.status,
             "created_at": _iso(t.created_at), "finished_at": _iso(t.finished_at)}
            for t in tournaments
        ],
    }


async def delete_account(db: AsyncSession, user: User) -> None:
    """Анонимизирует аккаунт и стирает личные данные; идущая партия — отказ (сначала её нужно доиграть)."""
    active = await db.scalar(select(Game.id).where(
        or_(Game.white_player_id == user.id, Game.black_player_id == user.id),
        Game.status.in_((GameStatus.PENDING, GameStatus.IN_PROGRESS)),
    ).limit(1))
    if active is not None:
        raise ApiError(409, "account_in_game")

    for model, column in (
            (BotPersonality, BotPersonality.owner_id), (LessonProgress, LessonProgress.user_id),
            (ThemeProgress, ThemeProgress.user_id), (PuzzleAttempt, PuzzleAttempt.user_id),
            (PersonalPuzzle, PersonalPuzzle.user_id), (DrillRecord, DrillRecord.user_id),
            (Tournament, Tournament.owner_id), (EmailToken, EmailToken.user_id),
    ):
        await db.execute(delete(model).where(column == user.id))

    anonymous = f"deleted_{user.id}"
    user.username = anonymous
    user.username_key = anonymous
    user.email = None
    user.hashed_password = get_password_hash(secrets.token_urlsafe(32))
    user.deleted_at = datetime.now(UTC)
    user.token_version = (user.token_version or 0) + 1
    await db.commit()

    # Сессии честной партии (лестница, турнир) и открытые WebSocket.
    from src.services import ladder
    from src.services.connection_manager import manager

    for scope in ladder.SCOPES:
        await ladder.clear_session(user.id, scope)
    await manager.revoke_sessions(user.id)
