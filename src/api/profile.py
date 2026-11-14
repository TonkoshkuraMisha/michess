# --- FILE: src/api/profile.py ---

import time
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import and_, asc, case, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.api.bots import CUSTOM_BOT_USERNAME
from src.api.deps import get_current_user
from src.core.errors import ApiError
from src.db.seed import ensure_champion_seeded, extract_pgn_metadata, get_champion_meta
from src.db.session import get_db
from src.models.game import Game, GameStatus
from src.models.user import RatingCategory, User
from src.schemas.user import username_key
from src.services.ladder import rungs as ladder_rungs
from src.services.rating import ESTIMATED_MOVES, category_duration_bounds_ms, classify_time_control

router = APIRouter(prefix="/profile", tags=["Profile & Games"])


class QueueJoinRequest(BaseModel):
    base_time_ms: int = 180000
    increment_ms: int = 0
    min_rating: int | None = None
    max_rating: int | None = None
    rated: bool = True


async def _resolve_user(db: AsyncSession, username: str) -> User | None:
    """Игрок по имени из адреса; удалённый аккаунт (таск 17.5) публичного профиля и партий не имеет."""
    user = await _find_user(db, username)
    return None if user is None or user.deleted_at is not None else user


async def _find_user(db: AsyncSession, username: str) -> User | None:
    champ_meta = get_champion_meta(username)
    if champ_meta is not None:
        champ_user = await ensure_champion_seeded(db, champ_meta["id"])
        if champ_user is not None:
            return champ_user

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()
    if user:
        return user

    # Без учёта регистра (/profile/Alice для alice) — только точное совпадение имени. Поиск по
    # подстроке (ILIKE '%name%') открывал по несуществующему или опечатанному имени профиль и
    # партии постороннего игрока, а "%" и "_" в адресе совпадали с кем угодно.
    result = await db.execute(select(User).where(User.username_key == username_key(username)))
    user = result.scalars().first()
    if user:
        return user

    # Архивные игроки и боты без username_key.
    result = await db.execute(
        select(User).where(func.lower(User.username) == username.lower()).order_by(User.id).limit(1)
    )
    return result.scalars().first()


async def _build_active_game_payload(db: AsyncSession, game_id: int, user_id: int) -> dict | None:
    """Формирует полный слепок активной партии для игрока (цвет, часы, FEN, PGN, версия стейта)."""
    from src.services.game_state import is_rated_state, pending_draw_offer, state_manager

    state = await state_manager.get_game_state(game_id)
    if not state or state.get("status") != "in_progress":
        return None

    white_id = int(state["white_id"])
    black_id = int(state["black_id"])
    if int(user_id) not in (white_id, black_id):
        return None

    white_user = await db.get(User, white_id)
    black_user = await db.get(User, black_id)
    category = classify_time_control(int(state.get("base_time_ms", 180000)), int(state.get("increment_ms", 0)))

    now_ms = int(time.time() * 1000)
    elapsed = max(0, now_ms - int(state.get("last_move_at", now_ms)))
    turn = state.get("turn", "white")
    w_ms = int(state.get("white_time_ms", 180000))
    b_ms = int(state.get("black_time_ms", 180000))

    white_time = max(0, w_ms - elapsed) if turn in ("white", "w") else w_ms
    black_time = max(0, b_ms - elapsed) if turn in ("black", "b") else b_ms

    return {
        "active": True,
        "event": "match_found",
        "game_id": int(game_id),
        "color": "white" if int(user_id) == white_id else "black",
        "opponent_id": black_id if int(user_id) == white_id else white_id,
        "white_username": white_user.username if white_user else "",
        "white_rating": white_user.rating_for(category) if white_user else 1200,
        "black_username": black_user.username if black_user else "",
        "black_rating": black_user.rating_for(category) if black_user else 1200,
        "is_rated": is_rated_state(state),
        "base_time_ms": int(state.get("base_time_ms", 180000)),
        "increment_ms": int(state.get("increment_ms", 0)),
        "white_time_ms": white_time,
        "black_time_ms": black_time,
        "fen": state.get("board_fen"),
        "pgn": state.get("pgn", ""),
        "state_version": int(state.get("state_version", 0)),
        "draw_offer_from": pending_draw_offer(state),
    }


@router.get("/me")
async def get_my_profile(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "bullet_rating": current_user.bullet_rating,
        "blitz_rating": current_user.blitz_rating,
        "rapid_rating": current_user.rapid_rating,
        "classical_rating": current_user.classical_rating,
        # Свой флаг игрок видит; числовой фактор доверия не отдаём, чтобы им нельзя было
        # калибровать обход античита.
        "is_cheater": current_user.is_cheater,
        "created_at": current_user.created_at,
    }


_LEADERBOARD_RATING_COLUMN: dict[RatingCategory, Any] = {
    "bullet": User.bullet_rating,
    "blitz": User.blitz_rating,
    "rapid": User.rapid_rating,
    "classical": User.classical_rating,
}


@router.get("/leaderboard")
async def get_leaderboard(
        category: RatingCategory = Query("blitz", description="Категория контроля времени"),
        limit: int = Query(50, ge=1, le=100, description="Количество игроков в топе"),
        db: AsyncSession = Depends(get_db),
):
    rating_column = _LEADERBOARD_RATING_COLUMN[category]
    query = (
        select(User)
        .where(User.is_cheater == False, User.is_bot == False, User.deleted_at.is_(None))  # noqa: E712
        .order_by(desc(rating_column))
        .limit(limit)
    )
    result = await db.execute(query)
    top_users = result.scalars().all()

    return [
        {"rank": index + 1, "username": user.username, "rating": user.rating_for(category)}
        for index, user in enumerate(top_users)
    ]


@router.get("/games/my-active")
async def get_my_active_game(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """Возвращает текущую активную партию авторизованного игрока (для синхронизации старта и ходов)."""
    from src.services.game_state import state_manager

    gid_str = await state_manager.redis.get(f"user:{current_user.id}:current_game")
    if not gid_str:
        return {"active": False}

    payload = await _build_active_game_payload(db, int(gid_str), current_user.id)
    if not payload:
        return {"active": False}
    return payload


async def _active_game_payload_or_none(db: AsyncSession, user_id: int) -> dict | None:
    from src.services.game_state import state_manager

    game_id = await state_manager.get_active_game_id(user_id)
    if game_id is None:
        return None
    return await _build_active_game_payload(db, game_id, user_id)


@router.post("/matchmaking/join")
async def join_matchmaking_http(
        req: QueueJoinRequest,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """Публикует вызов в лобби по HTTP (или сразу запускает матч, если соперник уже ждёт)."""
    from src.services.matchmaker import MatchmakingError, matchmaker

    try:
        matched_gid = await matchmaker.join_queue(
            user_id=current_user.id,
            username=current_user.username,
            rating=current_user.rating_for(classify_time_control(req.base_time_ms, req.increment_ms)),
            base_time_ms=req.base_time_ms,
            increment_ms=req.increment_ms,
            min_rating=req.min_rating,
            max_rating=req.max_rating,
            db=db,
            rated=req.rated,
        )
    except MatchmakingError as err:
        # Фронтенд дублирует действие по WS и HTTP: если WS уже стартовал партию, отдаём её.
        payload = await _active_game_payload_or_none(db, current_user.id) if err.code == "self_in_game" else None
        if payload:
            return payload
        raise err.to_http(409) from err
    if matched_gid is not None:
        payload = await _build_active_game_payload(db, int(matched_gid), current_user.id)
        if payload:
            return payload
    return {"active": False, "queued": True}


@router.post("/matchmaking/leave")
async def leave_matchmaking_http(current_user: User = Depends(get_current_user)):
    """Удаляет вызов игрока из очереди лобби."""
    from src.services.matchmaker import matchmaker
    await matchmaker.leave_queue(current_user.id)
    return {"status": "left"}


@router.post("/matchmaking/accept/{target_user_id}")
async def accept_challenge_http(
        target_user_id: int,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """
    Принимает вызов соперника из лобби по HTTP и возвращает данные начавшейся партии.
    Безопасен к гонкам с WebSocket-сообщением accept_challenge.
    """
    from src.services.connection_manager import manager
    from src.services.game_state import state_manager
    from src.services.matchmaker import MatchmakingError, matchmaker

    if int(target_user_id) == current_user.id:
        raise ApiError(400, "own_challenge")

    try:
        game_id = await matchmaker.accept_challenge(
            challenger_id=int(target_user_id),
            acceptor_id=current_user.id,
            connection_manager=manager,
            state_manager=state_manager,
            db=db,
        )
    except MatchmakingError as err:
        # Фронтенд дублирует действие по WS и HTTP: проигравший гонку запрос отдаёт уже
        # начавшуюся партию игрока, а не ошибку.
        if err.code in ("self_in_game", "challenge_gone", "players_busy"):
            payload = await _active_game_payload_or_none(db, current_user.id)
            if payload:
                return payload
        status_code = 404 if err.code == "challenge_gone" else 409
        raise err.to_http(status_code) from err

    payload = await _build_active_game_payload(db, int(game_id), current_user.id)
    if not payload:
        raise ApiError(404, "game_init_failed")

    return payload


@router.get("/games/live")
async def get_live_games(db: AsyncSession = Depends(get_db)):
    """Возвращает список активных партий, идущих прямо сейчас (для вкладки Live и режима зрителя)."""
    from src.services.connection_manager import manager
    from src.services.game_state import is_rated_state, state_manager

    game_ids = await state_manager.redis.smembers("active_games")
    if not game_ids:
        return []

    active_states: list[tuple[int, dict]] = []
    user_ids: set[int] = set()

    for gid_raw in game_ids:
        try:
            gid = int(gid_raw)
        except ValueError:
            continue
        state = await state_manager.get_game_state(gid)
        if not state or state.get("status") != "in_progress":
            continue

        white_id = int(state["white_id"])
        black_id = int(state["black_id"])
        user_ids.add(white_id)
        user_ids.add(black_id)
        active_states.append((gid, state))

    if not active_states:
        return []

    users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_map = {u.id: u for u in users_res.scalars().all()}

    live_list: list[dict[str, Any]] = []
    for gid, state in active_states:
        white_id = int(state["white_id"])
        black_id = int(state["black_id"])
        white_user = users_map.get(white_id)
        black_user = users_map.get(black_id)
        spectators_set = await manager.get_spectator_ids(gid)
        category = classify_time_control(int(state.get("base_time_ms", 180000)), int(state.get("increment_ms", 0)))

        live_list.append({
            "game_id": gid,
            "white_id": white_id,
            "black_id": black_id,
            "white_username": white_user.username if white_user else "",
            "white_rating": white_user.rating_for(category) if white_user else 1200,
            "black_username": black_user.username if black_user else "",
            "black_rating": black_user.rating_for(category) if black_user else 1200,
            "is_rated": is_rated_state(state),
            "base_time_ms": int(state.get("base_time_ms", 180000)),
            "increment_ms": int(state.get("increment_ms", 0)),
            "state_version": int(state.get("state_version", 0)),
            "spectators_count": len(spectators_set),
        })

    live_list.sort(key=lambda x: x["game_id"], reverse=True)
    return live_list


@router.get("/{username}")
async def get_user_profile(username: str, db: AsyncSession = Depends(get_db)):
    user = await _resolve_user(db, username)
    if not user:
        raise ApiError(404, "user_not_found", username=username)

    return {
        "id": user.id,
        "username": user.username,
        "bullet_rating": user.bullet_rating,
        "blitz_rating": user.blitz_rating,
        "rapid_rating": user.rapid_rating,
        "classical_rating": user.classical_rating,
        "created_at": user.created_at,
        # Клубная лестница — отдельно от рейтинга партий между людьми (src/services/ladder.py).
        "ladder": {
            "rating": user.ladder_rating,
            "games": user.ladder_games,
            "step": user.ladder_step,
            "total": len(ladder_rungs()),
        },
    }


def _archive_conditions(user_id: int) -> list:
    """Партии игрока, которые показываются в истории: завершённые и с записью ходов."""
    return [
        or_(Game.white_player_id == user_id, Game.black_player_id == user_id),
        Game.status == GameStatus.COMPLETED,
        Game.pgn.is_not(None),
        Game.pgn != "",
        Game.is_simulation.is_(False),  # партии ботов в турнирах — не в архиве и статистике
    ]


@router.get("/{username}/stats")
async def get_user_stats(username: str, db: AsyncSession = Depends(get_db)):
    """
    Итоги по всем партиям игрока (тем же, что в истории): всего, победы, ничьи, поражения.
    Считается одним запросом в БД — раньше страница профиля считала их по последним 30 партиям.
    """
    user = await _resolve_user(db, username)
    if not user:
        raise ApiError(404, "user_not_found", username=username)

    is_white = Game.white_player_id == user.id
    won = or_(and_(is_white, Game.result == "1-0"), and_(~is_white, Game.result == "0-1"))
    lost = or_(and_(is_white, Game.result == "0-1"), and_(~is_white, Game.result == "1-0"))
    row = (await db.execute(
        select(
            func.count(Game.id),
            func.coalesce(func.sum(case((won, 1), else_=0)), 0),
            func.coalesce(func.sum(case((Game.result == "1/2-1/2", 1), else_=0)), 0),
            func.coalesce(func.sum(case((lost, 1), else_=0)), 0),
        ).where(*_archive_conditions(user.id))
    )).one()

    return {
        "total": int(row[0]),
        "wins": int(row[1]),
        "draws": int(row[2]),
        "losses": int(row[3]),
        # Рейтинговых партий по категориям — по ним страница выбирает, какой график показать первым.
        "rated_games": {category: user.games_played_for(category) for category in _LEADERBOARD_RATING_COLUMN},
    }


@router.get("/{username}/rating-history")
async def get_rating_history(
        username: str,
        category: RatingCategory = Query("blitz", description="Категория контроля времени"),
        limit: int = Query(200, ge=1, le=1000, description="Сколько последних партий вернуть"),
        db: AsyncSession = Depends(get_db),
):
    """
    Рейтинг игрока после каждой рейтинговой партии категории — в хронологическом порядке.
    Берётся из сохранённых при завершении партии значений (рейтинг до партии + изменение),
    а не восстанавливается приблизительно на клиенте.
    """
    user = await _resolve_user(db, username)
    if not user:
        raise ApiError(404, "user_not_found", username=username)

    estimated_ms = Game.base_time_ms + ESTIMATED_MOVES * Game.increment_ms
    lower, upper = category_duration_bounds_ms(category)
    conditions = [
        or_(Game.white_player_id == user.id, Game.black_player_id == user.id),
        Game.status == GameStatus.COMPLETED,
        Game.is_rated == True,  # noqa: E712
        Game.finished_at.is_not(None),
        Game.white_initial_rating.is_not(None),
        Game.black_initial_rating.is_not(None),
        Game.white_rating_delta.is_not(None),
        Game.black_rating_delta.is_not(None),
    ]
    if lower is not None:
        conditions.append(estimated_ms >= lower)
    if upper is not None:
        conditions.append(estimated_ms < upper)

    rows = (await db.execute(
        select(
            Game.id, Game.finished_at, Game.white_player_id, Game.result,
            Game.white_initial_rating, Game.white_rating_delta,
            Game.black_initial_rating, Game.black_rating_delta,
        )
        .where(*conditions)
        .order_by(desc(Game.finished_at), desc(Game.id))
        .limit(limit)
    )).all()

    points = []
    for game_id, finished_at, white_id, result, w_initial, w_delta, b_initial, b_delta in reversed(rows):
        played_white = white_id == user.id
        initial, delta = (w_initial, w_delta) if played_white else (b_initial, b_delta)
        points.append({
            "game_id": game_id,
            "finished_at": finished_at.isoformat(),
            "rating": initial + delta,
            "delta": delta,
            "color": "white" if played_white else "black",
            "result": result,
        })

    return {"category": category, "current_rating": user.rating_for(category), "points": points}


@router.get("/{username}/games")
async def get_user_games(
        username: str,
        limit: int = Query(25, ge=1, le=2000),
        offset: int = Query(0, ge=0),
        sort: str = Query("desc"),
        db: AsyncSession = Depends(get_db),
):
    user = await _resolve_user(db, username)
    if not user:
        raise ApiError(404, "user_not_found", username=username)

    WhiteUser = aliased(User)
    BlackUser = aliased(User)

    conditions = _archive_conditions(user.id)

    count_query = select(func.count(Game.id)).where(*conditions)
    total_count = (await db.execute(count_query)).scalar() or 0

    null_date_flag = case(
        (or_(Game.pgn_date.is_(None), Game.pgn_date == "", Game.pgn_date.like("?%")), 1),
        else_=0,
    )

    if sort == "asc":
        order_clauses = [
            asc(null_date_flag),
            asc(Game.pgn_date),
            asc(Game.finished_at),
            asc(Game.id),
        ]
    else:
        order_clauses = [
            asc(null_date_flag),
            desc(Game.pgn_date),
            desc(Game.finished_at),
            desc(Game.id),
        ]

    games_query = (
        select(
            Game.id,
            Game.status,
            Game.is_rated,
            Game.result,
            Game.pgn_date,
            Game.site,
            Game.eco,
            Game.finished_at,
            Game.pgn,
            Game.base_time_ms,
            Game.increment_ms,
            Game.personality_name,
            Game.assisted,
            WhiteUser.username,
            WhiteUser.bullet_rating,
            WhiteUser.blitz_rating,
            WhiteUser.rapid_rating,
            WhiteUser.classical_rating,
            BlackUser.username,
            BlackUser.bullet_rating,
            BlackUser.blitz_rating,
            BlackUser.rapid_rating,
            BlackUser.classical_rating,
        )
        .join(WhiteUser, Game.white_player_id == WhiteUser.id)
        .join(BlackUser, Game.black_player_id == BlackUser.id)
        .where(*conditions)
        .order_by(*order_clauses)
        .limit(limit)
        .offset(offset)
    )

    rows = (await db.execute(games_query)).all()

    items = []
    for (
            game_id,
            status_val,
            is_rated,
            result_val,
            pgn_date,
            site,
            eco,
            finished_at,
            pgn_text,
            base_time_ms,
            increment_ms,
            personality_name,
            assisted,
            w_name,
            w_bullet,
            w_blitz,
            w_rapid,
            w_classical,
            b_name,
            b_bullet,
            b_blitz,
            b_rapid,
            b_classical,
    ) in rows:
        # Текущий рейтинг соперника в категории именно этой партии (пуля/блиц/рапид/классика),
        # а не общий — отдельных «общих» рейтингов в системе больше нет.
        category = classify_time_control(base_time_ms, increment_ms)
        w_rating = {"bullet": w_bullet, "blitz": w_blitz, "rapid": w_rapid, "classical": w_classical}[category]
        b_rating = {"bullet": b_bullet, "blitz": b_blitz, "rapid": b_rapid, "classical": b_classical}[category]
        if (not pgn_date or not site or not eco or not result_val or result_val == "*") and pgn_text:
            fallback_meta = extract_pgn_metadata(pgn_text, fallback_result=result_val or "*")
            result_val = result_val if (result_val and result_val != "*") else fallback_meta["result"]
            pgn_date = pgn_date or fallback_meta["pgn_date"]
            site = site or fallback_meta["site"]
            eco = eco or fallback_meta["eco"]

        # Соперник из мастерской хранится как общий бот — в архиве показываем имя персоналии.
        if personality_name:
            w_name = personality_name if w_name == CUSTOM_BOT_USERNAME else w_name
            b_name = personality_name if b_name == CUSTOM_BOT_USERNAME else b_name

        items.append({
            "game_id": game_id,
            "white_username": w_name,
            "white_rating": w_rating,
            "black_username": b_name,
            "black_rating": b_rating,
            "status": status_val.value if hasattr(status_val, "value") else str(status_val),
            "is_rated": is_rated,
            "assisted": bool(assisted),
            "result": result_val or "*",
            "pgn_date": pgn_date,
            "site": site,
            "eco": eco,
            "finished_at": finished_at.isoformat() if finished_at else None,
        })

    return {
        "total": total_count,
        "items": items,
    }


@router.get("/games/{game_id}/summary")
async def get_game_summary(game_id: int, db: AsyncSession = Depends(get_db)):
    """
    Статус и итог партии. Нужен клиенту, который пропустил game_over (обрыв WebSocket в момент
    завершения): по этому ответу он завершает партию у себя, а не остаётся в «вечной» игре.
    """
    game = await db.get(Game, game_id)
    if not game:
        raise ApiError(404, "game_not_found", game_id=game_id)
    return {
        "game_id": game.id,
        "status": game.status.value,
        "result": game.result,
        "termination": game.termination,
        "white_delta": game.white_rating_delta,
        "black_delta": game.black_rating_delta,
    }


@router.get("/games/{game_id}/pgn")
async def download_pgn(game_id: int, db: AsyncSession = Depends(get_db)):
    game = await db.get(Game, game_id)
    if not game or not game.pgn:
        raise ApiError(404, "pgn_not_found", game_id=game_id)

    headers = {"Content-Disposition": f"attachment; filename=michess_game_{game_id}.pgn"}
    return PlainTextResponse(content=game.pgn, media_type="application/x-chess-pgn", headers=headers)


@router.get("/matchmaking/queue")
async def get_matchmaking_queue():
    from src.services.matchmaker import matchmaker
    return await matchmaker.get_queue_players()
