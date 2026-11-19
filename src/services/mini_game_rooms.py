# --- FILE: src/services/mini_game_rooms.py ---
"""
Игры тренеров с человеком по сети (таск 19.8, остаток; выбор владельца 18.11): товарищеская партия двух игроков в
одну из учебных игр (пешечный бой и др.) — без рейтинга, без часов и без записи в архив.

Почему отдельно от PvP-партий: обычная партия (game_state, клиентская доска на chess.js) понимает только шахматы —
позицию без королей она не примет, а конец мини-игры (провёл пешку, съел все пешки, довёл короля) другой. Поэтому
здесь своя «комната»: правила хода и итога — те же, что в игре с ботом (src/services/mini_games.py), состояние —
короткая запись в Redis.

* Комната — ключ minigame:room:{code} (JSON, живёт ROOM_TTL_S с последнего действия). Код — как у ссылки-вызова
  (matchmaker.INVITE_CODE_*). Создатель выбирает цвет (белые, чёрные, случайно), второй игрок входит по ссылке.
* Ход проверяет сервер по правилам игры; ходит только сторона, чья очередь, и только по текущей версии (version):
  повторно отправленный ход не применится дважды. Одновременные запросы к одной комнате разводит короткий замок
  (ключ …:lock, LOCK_TTL_S) — второй получает mini_room_busy и повторяет.
* Итог — по правилам игры или сдачей. «Ещё раз» — новая комната с теми же игроками и сменой цветов; у старой
  записывается next — страница соперника переходит туда сама.
* Клиент узнаёт о ходе соперника, опрашивая комнату (GET раз в секунду): для учебной игры без часов этого
  достаточно, а WebSocket партий остаётся только за шахматами.
"""

import json
import random
import secrets
import time

from src.core.errors import DomainError
from src.db import redis as redis_module
from src.models.user import User
from src.services import mini_games as mg
from src.services.matchmaker import INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH

# Сколько живёт комната после последнего действия (секунды): забытая игра исчезает сама.
ROOM_TTL_S = 2 * 3600
# Сколько держится замок комнаты на время одного действия (секунды).
LOCK_TTL_S = 5
COLORS = ("white", "black")


def _key(code: str) -> str:
    return f"minigame:room:{code}"


async def _load(code: str) -> dict:
    raw = await redis_module.redis_client.get(_key(code))
    if raw is None:
        raise DomainError("mini_room_not_found")
    return json.loads(raw)


async def _save(room: dict) -> None:
    await redis_module.redis_client.set(_key(room["code"]), json.dumps(room), ex=ROOM_TTL_S)


class _Locked:
    """Замок комнаты на время действия: второй одновременный запрос получает mini_room_busy."""

    def __init__(self, code: str):
        self.key = f"{_key(code)}:lock"

    async def __aenter__(self):
        if not await redis_module.redis_client.set(self.key, "1", ex=LOCK_TTL_S, nx=True):
            raise DomainError("mini_room_busy")

    async def __aexit__(self, *_):
        await redis_module.redis_client.delete(self.key)


def view(room: dict, user_id: int | None) -> dict:
    """Комната для клиента: игра, позиция, ходы, игроки, итог и цвет запросившего (you: None — зритель или гость)."""
    you = next((color for color in COLORS if user_id is not None and room[f"{color}_id"] == user_id), None)
    keys = ("code", "game_id", "fen", "moves", "result", "reason", "version", "next")
    return {**{k: room.get(k) for k in keys},
            "white": room["white_name"], "black": room["black_name"], "you": you,
            "waiting": room["white_id"] is None or room["black_id"] is None}


def _seat(room: dict, color: str, user: User) -> None:
    room[f"{color}_id"], room[f"{color}_name"] = user.id, user.username


def _new_room(game: mg.MiniGame) -> dict:
    code = "".join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(INVITE_CODE_LENGTH))
    return {"code": code, "game_id": game.id, "fen": game.fen, "moves": [], "result": None, "reason": None,
            "version": 0, "next": None, "created": time.time(),
            "white_id": None, "white_name": None, "black_id": None, "black_name": None}


async def create(user: User, game_id: str, color: str) -> dict:
    """Новая комната: создатель садится за выбранный цвет (random — случайно); второй цвет ждёт гостя по ссылке."""
    game = mg.get_game(game_id)
    room = _new_room(game)
    _seat(room, random.choice(COLORS) if color not in COLORS else color, user)
    await _save(room)
    return view(room, user.id)


async def get(code: str, user_id: int | None) -> dict:
    return view(await _load(code), user_id)


async def join(user: User, code: str) -> dict:
    """Войти в комнату свободным цветом. Уже игрок — просто комната; оба места заняты — mini_room_full."""
    async with _Locked(code):
        room = await _load(code)
        if user.id in (room["white_id"], room["black_id"]):
            return view(room, user.id)
        free = next((color for color in COLORS if room[f"{color}_id"] is None), None)
        if free is None:
            raise DomainError("mini_room_full")
        _seat(room, free, user)
        await _save(room)
        return view(room, user.id)


def _color_of(room: dict, user: User) -> str:
    color = next((c for c in COLORS if room[f"{c}_id"] == user.id), None)
    if color is None:
        raise DomainError("mini_room_not_player")
    return color


async def move(user: User, code: str, uci: str, version: int) -> dict:
    """
    Ход игрока по правилам игры. Отказы: игра окончена (mini_game_over), соперника ещё нет (mini_room_waiting), не
    его очередь (mini_room_not_your_turn), версия устарела — ход уже сделан (mini_room_stale), ход не по правилам
    (mini_game_illegal_move).
    """
    async with _Locked(code):
        room = await _load(code)
        color = _color_of(room, user)
        if room["result"]:
            raise DomainError("mini_game_over")
        if room["white_id"] is None or room["black_id"] is None:
            raise DomainError("mini_room_waiting")
        if version != room["version"]:
            raise DomainError("mini_room_stale")
        game = mg.get_game(room["game_id"])
        board = mg.board_of(game, room["fen"])
        if ("white" if board.turn else "black") != color:
            raise DomainError("mini_room_not_your_turn")
        outcome = mg.play(game, board, uci)
        room["fen"], room["version"] = board.fen(), room["version"] + 1
        room["moves"].append(board.peek().uci())
        if outcome:
            room["result"], room["reason"] = outcome, "rules"
        await _save(room)
        return view(room, user.id)


async def resign(user: User, code: str) -> dict:
    """Сдача: победа сопернику. Окончена — mini_game_over."""
    async with _Locked(code):
        room = await _load(code)
        color = _color_of(room, user)
        if room["result"]:
            raise DomainError("mini_game_over")
        room["result"], room["reason"] = ("0-1" if color == "white" else "1-0"), "resign"
        room["version"] += 1
        await _save(room)
        return view(room, user.id)


async def rematch(user: User, code: str) -> dict:
    """
    «Ещё раз» после окончания: новая комната той же игры с теми же игроками, цвета меняются; у старой — next, по нему
    соперник переходит сам. Повторное нажатие (своё или соперника) ведёт в уже созданную.
    """
    async with _Locked(code):
        room = await _load(code)
        _color_of(room, user)
        if room["next"]:
            return view(await _load(room["next"]), user.id)
        if not room["result"]:
            raise DomainError("mini_room_in_progress")
        game = mg.get_game(room["game_id"])
        fresh = _new_room(game)
        for color, other in (("white", "black"), ("black", "white")):
            fresh[f"{color}_id"], fresh[f"{color}_name"] = room[f"{other}_id"], room[f"{other}_name"]
        await _save(fresh)
        room["next"] = fresh["code"]
        await _save(room)
        return view(fresh, user.id)
