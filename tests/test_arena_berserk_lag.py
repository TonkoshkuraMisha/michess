# --- FILE: tests/test_arena_berserk_lag.py ---
"""Берсерк в аренах и квота лага во всех PvP-партиях (таск 33.3)."""

import asyncio
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from src.api.websockets import matchmaking_endpoint
from src.db.session import get_session_factory
from src.main import app
from src.models.arena import Arena, ArenaGame, ArenaPlayer
from src.models.game import Game, GameStatus
from src.services import arena
from src.services import game_state as game_state_module
from src.services.game_state import (
    LAG_PER_GAME_MS,
    LAG_PER_MOVE_MS,
    evaluate_clock_expiry,
    lag_allowance_ms,
    lag_credit_ms,
    next_timeout_deadline_ms,
    state_manager,
)
from tests.test_ws_rate_limit import _CLOSE, QueueSocket, _run, _user

API = "/api/v1/arenas"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _ws(user, messages: list) -> QueueSocket:
    """Сообщения клиента через настоящий эндпоинт WebSocket с тестовой базой (действие «берсерк» пишет в неё)."""
    socket = QueueSocket()
    for message in messages:
        socket.incoming.put_nowait(message)
    socket.incoming.put_nowait(_CLOSE)
    factory = app.dependency_overrides[get_session_factory]()
    await asyncio.wait_for(matchmaking_endpoint(socket, user, factory), timeout=5)
    return socket


@pytest.fixture
def frozen_clock(monkeypatch) -> int:
    """Часы партии стоят: времена ходов в тестах квоты не зависят от скорости машины. Возвращает «сейчас» в мс."""
    now_ms = int(time.time() * 1000)
    monkeypatch.setattr(game_state_module, "time", SimpleNamespace(time=lambda: now_ms / 1000))
    return now_ms


async def _rewind(game_id: int, now_ms: int, ms: int) -> None:
    """Сдвигает последний ход партии в прошлое: «с тех пор прошло ms»."""
    await state_manager.update_game_state(game_id, {"last_move_at": now_ms - ms})


# --- Квота лага ----------------------------------------------------------------------------------------------


def test_lag_credit_is_capped_per_move_and_per_game():
    fresh = {"white_lag_ms": 0}
    assert lag_credit_ms(fresh, "white", 1000, 900) == 100                      # лаг 100 мс возвращается целиком
    assert lag_credit_ms(fresh, "white", 1000, 0) == LAG_PER_MOVE_MS            # не больше квоты хода
    assert lag_credit_ms(fresh, "white", 1000, 5000) == 0                       # клиент думал «дольше» сервера
    assert lag_credit_ms(fresh, "white", 1000, None) == 0                       # клиент времени не назвал
    assert lag_credit_ms(fresh, "white", 1000, -400) == LAG_PER_MOVE_MS         # отрицательное время — как ноль
    nearly_spent = {"white_lag_ms": LAG_PER_GAME_MS - 120}
    assert lag_allowance_ms(nearly_spent, "white") == 120
    assert lag_credit_ms(nearly_spent, "white", 1000, 0) == 120                 # остаток квоты партии
    assert lag_credit_ms({"white_lag_ms": LAG_PER_GAME_MS}, "white", 1000, 0) == 0
    assert lag_allowance_ms({}, "black") == LAG_PER_MOVE_MS                     # состояние старой партии без поля


async def test_move_gets_lag_back_and_quota_runs_out(frozen_clock):
    await state_manager.initialize_game(game_id=3301, white_id=11, black_id=12, base_time_ms=60_000, increment_ms=0)
    await _rewind(3301, frozen_clock, 1000)
    first = await state_manager.process_atomic_move(3301, 11, "c1", "e2e4", client_elapsed_ms=800)
    assert (first["lag_credit_ms"], first["white_time_ms"]) == (200, 59_200)    # 60 с − 1 с + 200 мс лага
    assert (await state_manager.get_game_state(3301))["white_lag_ms"] == 200

    # Клиент без времени обдумывания: часы идут по серверу, квота не тратится.
    await _rewind(3301, frozen_clock, 1000)
    second = await state_manager.process_atomic_move(3301, 12, "c2", "e7e5")
    assert (second["lag_credit_ms"], second["black_time_ms"]) == (0, 59_000)

    # Квота партии кончается: вернётся только её остаток.
    await state_manager.update_game_state(3301, {"white_lag_ms": LAG_PER_GAME_MS - 50})
    await _rewind(3301, frozen_clock, 1000)
    third = await state_manager.process_atomic_move(3301, 11, "c3", "g1f3", client_elapsed_ms=0)
    assert third["lag_credit_ms"] == 50
    assert (await state_manager.get_game_state(3301))["white_lag_ms"] == LAG_PER_GAME_MS


def test_flag_waits_for_the_lag_allowance():
    now = int(time.time() * 1000)
    state = {"white_id": 1, "black_id": 2, "turn": "white", "white_time_ms": 1000, "black_time_ms": 5000,
             "white_disconnected": "false", "black_disconnected": "false", "last_move_at": now - 1200}
    assert evaluate_clock_expiry(state, now) is None                            # время вышло, но ход ещё может идти
    assert evaluate_clock_expiry({**state, "last_move_at": now - 1000 - LAG_PER_MOVE_MS}, now) == ("0-1", 2, "timeout")
    assert next_timeout_deadline_ms({**state, "state_version": 5}) == now - 1200 + 1000 + LAG_PER_MOVE_MS
    spent = {**state, "white_lag_ms": LAG_PER_GAME_MS}
    assert evaluate_clock_expiry(spent, now) == ("0-1", 2, "timeout")           # квота израсходована — отсрочки нет


async def test_late_move_is_saved_by_lag_but_not_without_it(frozen_clock):
    for game_id, client_ms, outcome in ((3302, 900, "success"), (3303, None, "game_over")):
        await state_manager.initialize_game(game_id=game_id, white_id=11, black_id=12, base_time_ms=60_000,
                                            increment_ms=0)
        await state_manager.update_game_state(game_id, {"white_time_ms": 1000})
        await _rewind(game_id, frozen_clock, 1150)                              # ход пришёл через 150 мс после флага
        res = await state_manager.process_atomic_move(game_id, 11, "c1", "e2e4", client_elapsed_ms=client_ms)
        assert res["status"] == outcome
        if outcome == "success":
            assert res["white_time_ms"] == 100                                  # 1000 − 1150 + 250 лага
        else:
            assert (res["result"], res["termination"]) == ("0-1", "timeout")


@pytest.mark.parametrize(("time_taken", "refunded"), [(700, True), ("abc", False), (True, False), (-5, False),
                                                      (None, False)])
async def test_client_move_message_carries_the_thinking_time(frozen_clock, time_taken, refunded):
    """Настоящий путь клиента: make_move с time_taken_ms; мусор вместо числа — возврата времени нет."""
    await state_manager.initialize_game(game_id=3304, white_id=921, black_id=922, base_time_ms=60_000, increment_ms=0)
    await _rewind(3304, frozen_clock, 1000)
    socket = await _run(_user(921), [{"action": "make_move", "game_id": 3304, "move": "e2e4", "state_version": 0,
                                      "time_taken_ms": time_taken}])
    # Лаг 300 мс возвращён — или часы идут строго по серверу.
    assert socket.events("move_made")[0]["white_time_ms"] == (59_300 if refunded else 59_000)


# --- Берсерк -------------------------------------------------------------------------------------------------


def _arena(now: datetime, base_ms: int = 180_000, inc_ms: int = 2_000, fmt: str = "arena") -> Arena:
    return Arena(base_time_ms=base_ms, increment_ms=inc_ms, starts_at=now - timedelta(minutes=5),
                 ends_at=now + timedelta(minutes=50), format=fmt)


@pytest.mark.parametrize(("base_ms", "inc_ms", "fmt", "allowed"), [
    (60_000, 0, "arena", False),          # пуля 1+0 — лотерея
    (120_000, 1_000, "arena", True),
    (180_000, 2_000, "arena", True),
    (600_000, 0, "arena", True),
    (600_000, 5_000, "swiss", False),     # в швейцарке берсерка нет
])
def test_berserk_is_not_for_one_minute_bullet_or_swiss(base_ms, inc_ms, fmt, allowed):
    item = _arena(datetime.now(UTC), base_ms, inc_ms, fmt)
    assert arena.berserk_allowed(item) is allowed
    assert arena.view(item)["berserk"] is allowed


async def _paired_game(client, db, item: Arena, token_1: str, token_2: str) -> tuple[int, dict]:
    db.add(item)
    await db.commit()
    for token in (token_1, token_2):
        assert client.post(f"{API}/{item.id}/join", headers=auth(token)).status_code == 200
    client.post(f"{API}/{item.id}/ready", headers=auth(token_1))
    game_id = client.post(f"{API}/{item.id}/ready", headers=auth(token_2)).json()["game_id"]
    return game_id, await state_manager.get_game_state(game_id)


async def test_berserk_through_the_real_client_path(client, db_session, test_user_1, test_user_2, token_user_1,
                                                    token_user_2):
    """Арена 3+2: пара через HTTP, берсерк и ходы — сообщениями WebSocket, итог — в таблице арены."""
    item = _arena(datetime.now(UTC))
    game_id, state = await _paired_game(client, db_session, item, token_user_1, token_user_2)
    assert (state["arena_id"], state["berserk_allowed"]) == (str(item.id), "1")
    users = {test_user_1.id: test_user_1, test_user_2.id: test_user_2}
    white, black = users[state["white_id"]], users[state["black_id"]]

    socket = await _ws(white, [{"action": "berserk", "game_id": game_id},
                               {"action": "berserk", "game_id": game_id}])       # повтор ничего не меняет
    # При подключении игрок получает снимок идущей партии — в нём берсерк ещё не сыгран, но доступен.
    snapshot = socket.events("match_found")[0]
    assert (snapshot["arena_id"], snapshot["berserk_allowed"], snapshot["white_berserk"]) == (item.id, True, False)
    events = socket.events("berserk")
    assert len(events) == 1 and not socket.events("error")
    assert (events[0]["color"], events[0]["white_berserk"], events[0]["black_berserk"]) == ("white", True, False)
    assert 89_000 < events[0]["white_time_ms"] <= 90_000 and events[0]["black_time_ms"] == 180_000

    state = await state_manager.get_game_state(game_id)
    assert (state["white_time_ms"], state["white_berserk"]) == (90_000, "1")
    record = (await db_session.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one()
    await db_session.refresh(record)
    assert (record.white_berserk, record.black_berserk) == (True, False)
    game = await db_session.get(Game, game_id)
    await db_session.refresh(game)
    assert game.white_time_ms == 90_000
    # Снимок партии по HTTP (клиент берёт её опросом, если пропустил событие): берсерк виден и там.
    tokens = {test_user_1.id: token_user_1, test_user_2.id: token_user_2}
    polled = client.get("/api/v1/profile/games/my-active", headers=auth(tokens[black.id])).json()
    assert (polled["berserk_allowed"], polled["white_berserk"], polled["black_berserk"]) == (True, True, False)

    # Берсерк играет без добавки, соперник — с добавкой.
    moved = await _ws(white, [{"action": "make_move", "game_id": game_id, "move": "e2e4", "state_version": 0}])
    assert moved.events("match_found")[0]["white_berserk"] is True               # снимок после переподключения
    assert moved.events("move_made")[0]["white_time_ms"] <= 90_000
    replied = await _ws(black, [{"action": "make_move", "game_id": game_id, "move": "e7e5", "state_version": 1},
                                {"action": "berserk", "game_id": game_id}])
    assert replied.events("move_made")[0]["black_time_ms"] > 181_000
    assert [e["code"] for e in replied.events("error")] == ["berserk_too_late"]  # свой первый ход уже сделан

    # Чёрные сдаются: победа берсерка — 2 очка и ещё одно.
    await _ws(black, [{"action": "resign", "game_id": game_id}])
    await db_session.refresh(record)
    assert (record.result, record.white_points, record.black_points) == ("1-0", 3, 0)
    table = client.get(f"{API}/{item.id}").json()["standings"]
    assert [(row["username"], row["score"]) for row in table] == [(white.username, 3), (black.username, 0)]


async def test_black_berserks_after_whites_first_move(client, db_session, test_user_1, test_user_2, token_user_1,
                                                      token_user_2):
    item = _arena(datetime.now(UTC))
    game_id, state = await _paired_game(client, db_session, item, token_user_1, token_user_2)
    await state_manager.process_atomic_move(game_id, state["white_id"], "c1", "e2e4")
    res = await arena.berserk(db_session, game_id, state["black_id"])
    assert res is not None and res["color"] == "black"
    fresh = await state_manager.get_game_state(game_id)
    assert (fresh["black_time_ms"], fresh["black_berserk"], fresh.get("white_berserk")) == (90_000, "1", None)
    assert await arena.berserk(db_session, game_id, state["black_id"]) is None   # второй раз — без изменений

    # Состояние пропало из Redis: из базы партия возвращается с берсерком и его часами.
    await state_manager.redis.delete(state_manager._get_key(game_id))
    restored = await state_manager.get_game_state(game_id)
    assert (restored["berserk_allowed"], restored["black_berserk"], restored["arena_id"]) == ("1", "1", str(item.id))
    assert restored["black_time_ms"] == 90_000


async def test_no_berserk_in_one_minute_bullet_or_outside_arenas(client, db_session, test_user_1, test_user_2,
                                                                 token_user_1, token_user_2):
    item = _arena(datetime.now(UTC), 60_000, 0)
    game_id, state = await _paired_game(client, db_session, item, token_user_1, token_user_2)
    assert state["berserk_allowed"] == "0"
    users = {test_user_1.id: test_user_1, test_user_2.id: test_user_2}
    socket = await _ws(users[state["white_id"]], [{"action": "berserk", "game_id": game_id}])
    assert [e["code"] for e in socket.events("error")] == ["berserk_unavailable"]
    assert not socket.events("berserk")
    assert (await state_manager.get_game_state(game_id))["white_time_ms"] == 60_000

    # Обычная партия (не арена): действие отклоняется, часы прежние.
    await state_manager.initialize_game(game_id=3310, white_id=test_user_1.id, black_id=test_user_2.id,
                                        base_time_ms=180_000, increment_ms=2_000)
    assert (await state_manager.apply_berserk(3310, test_user_1.id)) == {"status": "error",
                                                                          "code": "berserk_unavailable"}


async def _scored_game(db, item: Arena, white, black, *, white_berserk: bool = False,
                       black_berserk: bool = False) -> int:
    game = Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.IN_PROGRESS)
    db.add(game)
    await db.flush()
    db.add(ArenaGame(arena_id=item.id, game_id=game.id, white_id=white.id, black_id=black.id,
                     white_berserk=white_berserk, black_berserk=black_berserk))
    await db.flush()
    return game.id


async def test_berserk_bonus_only_for_a_played_win(db_session, test_user_1, test_user_2):
    item = _arena(datetime.now(UTC))
    db_session.add(item)
    await db_session.commit()
    for user in (test_user_1, test_user_2):
        await arena.join(db_session, item, user)

    async def points_of(game_id: int) -> tuple[int | None, int | None]:
        record = (await db_session.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one()
        return record.white_points, record.black_points

    drawn = await _scored_game(db_session, item, test_user_1, test_user_2, white_berserk=True, black_berserk=True)
    await arena.on_game_finished(db_session, drawn, "1/2-1/2", termination="stalemate", plies=80)
    assert await points_of(drawn) == (1, 1)                                     # ничья — без бонуса

    lost = await _scored_game(db_session, item, test_user_1, test_user_2, white_berserk=True)
    await arena.on_game_finished(db_session, lost, "0-1", termination="checkmate", plies=40)
    assert await points_of(lost) == (0, 2)                                      # бонус только берсерку, и только за победу

    no_show = await _scored_game(db_session, item, test_user_1, test_user_2, white_berserk=True)
    await arena.on_game_aborted(db_session, no_show, "black")
    assert await points_of(no_show) == (2, 0)                                   # победа по неявке — без бонуса

    # «Огонь»: очки удваиваются, бонус берсерка прибавляется после удвоения.
    player = (await db_session.execute(select(ArenaPlayer).where(
        ArenaPlayer.arena_id == item.id, ArenaPlayer.user_id == test_user_2.id))).scalar_one()
    player.streak = arena.FIRE_AFTER
    on_fire = await _scored_game(db_session, item, test_user_1, test_user_2, black_berserk=True)
    await arena.on_game_finished(db_session, on_fire, "0-1", termination="resignation", plies=50)
    assert await points_of(on_fire) == (0, 5)


async def test_swiss_game_gives_no_berserk_bonus(db_session, test_user_1, test_user_2):
    item = _arena(datetime.now(UTC), 600_000, 5_000, "swiss")
    item.rounds = 3
    db_session.add(item)
    await db_session.commit()
    db_session.add_all([ArenaPlayer(arena_id=item.id, user_id=u.id, rating=1500) for u in (test_user_1, test_user_2)])
    game_id = await _scored_game(db_session, item, test_user_1, test_user_2, white_berserk=True)
    await arena.on_game_finished(db_session, game_id, "1-0", termination="checkmate", plies=40)
    record = (await db_session.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one()
    assert (record.white_points, record.black_points) == (2, 0)
