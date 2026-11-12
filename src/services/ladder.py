# --- FILE: src/services/ladder.py ---
"""
Клубная лестница (таск 10.4): соперники от слабого к сильному — архетипы мастерской и исторические
боты, упорядоченные по измеренной силе (src/services/bots/calibration.py), и отдельный рейтинг
игрока в партиях с ними.

Честность партии проверяет сервер, а не клиент. Партию лестницы открывает POST /bots/ladder/start
— сессия в Redis на LADDER_SESSION_TTL_S. Пока она открыта:
* запрос хода движка за сторону игрока (/bots/move, /bots/custom-move) или анализ позиции — подсказка;
* запрос позиции, которая уже была (полуход не растёт), — возврат хода;
* ходы за соперника не тем ботом или изменённым конфигом — подмена соперника.
Такая партия сохраняется в архив, но рейтинг и ступень лестницы не меняет — причину видно игроку.
Новая партия при незавершённой предыдущей засчитывает предыдущую как поражение (иначе неудачные
партии можно было бы просто бросать).
"""

import json
import time
from dataclasses import asdict, dataclass

import chess

from src.db import redis as redis_module
from src.models.user import User
from src.services.bots.archetypes import ARCHETYPES, ARCHETYPES_BY_NAME
from src.services.bots.calibration import strength_of
from src.services.bots.personality import BotPersonalityConfig

LADDER_SESSION_TTL_S = 4 * 3600
K_NEW = 40  # первые K_NEW_GAMES партий рейтинг подвижнее
K_ESTABLISHED = 24
K_NEW_GAMES = 10


@dataclass(frozen=True)
class Rung:
    key: str  # "morphy" или "archetype:Торопыга"
    kind: str  # "historical" | "archetype"
    name: str
    rating: int
    measured: bool


@dataclass
class LadderSession:
    rung_key: str
    color: str  # цвет игрока
    started_at: float
    max_ply: int = -1
    last_fen: str | None = None
    assisted: str | None = None


def rungs() -> list[Rung]:
    from src.api.bots import AVAILABLE_BOTS

    items = [
        Rung(str(b["id"]), "historical", str(b["name"]), *_strength(str(b["id"]), int(str(b["rating"]))))
        for b in AVAILABLE_BOTS
    ]
    items += [
        Rung(a.key, "archetype", a.name, *_strength(a.key, a.config.target_elo)) for a in ARCHETYPES
    ]
    return sorted(items, key=lambda r: (r.rating, r.name))


def _strength(key: str, declared: int) -> tuple[int, bool]:
    s = strength_of(key, declared)
    return s.rating, s.measured


def current_rung(user: User) -> tuple[int, Rung]:
    ladder = rungs()
    index = min(user.ladder_step, len(ladder) - 1)
    return index, ladder[index]


def opponent_key(bot_id: str, config: BotPersonalityConfig | None) -> str:
    """Ключ соперника, за которого запрошен ход: исторический id, архетип (по совпадению конфига) или «свой»."""
    if bot_id != "custom":
        return bot_id
    for archetype in ARCHETYPES:
        if config is not None and config == archetype.config:
            return archetype.key
    return "custom:other"


def _key(user_id: int) -> str:
    return f"ladder:session:{user_id}"


async def get_session(user_id: int) -> LadderSession | None:
    raw = await redis_module.redis_client.get(_key(user_id))
    if not raw:
        return None
    return LadderSession(**json.loads(raw))


async def _store(user_id: int, session: LadderSession) -> None:
    await redis_module.redis_client.set(_key(user_id), json.dumps(asdict(session)), ex=LADDER_SESSION_TTL_S)


async def clear_session(user_id: int) -> None:
    await redis_module.redis_client.delete(_key(user_id))


async def open_session(user_id: int, rung: Rung, color: str) -> LadderSession:
    session = LadderSession(rung_key=rung.key, color=color, started_at=time.time())
    await _store(user_id, session)
    return session


async def _mark(user_id: int, session: LadderSession, reason: str) -> None:
    if session.assisted is None:
        session.assisted = reason
    await _store(user_id, session)


async def note_analysis(user_id: int | None) -> None:
    """Анализ позиции движком во время партии лестницы — подсказка."""
    if user_id is None:
        return
    session = await get_session(user_id)
    if session is not None:
        await _mark(user_id, session, "во время партии запрашивался анализ позиции")


async def note_bot_move_request(user_id: int | None, board: chess.Board, requested_key: str) -> None:
    """Запрос хода бота во время партии лестницы: подсказка, возврат хода или подмена соперника."""
    if user_id is None:
        return
    session = await get_session(user_id)
    if session is None:
        return
    player_to_move = (board.turn == chess.WHITE) == (session.color == "white")
    if player_to_move:
        await _mark(user_id, session, "движок подсказал ход за вашу сторону")
    elif requested_key != session.rung_key:
        await _mark(user_id, session, "ходы соперника делал другой бот")
    elif board.ply() == session.max_ply and board.fen() == session.last_fen:
        return  # повтор того же запроса (ретрай после сбоя связи, двойной эффект React) — не возврат
    elif board.ply() <= session.max_ply:
        await _mark(user_id, session, "в партии был возврат хода")
    else:
        session.max_ply = board.ply()
        session.last_fen = board.fen()
        await _store(user_id, session)


def expected_score(rating: int, opponent: int) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent - rating) / 400.0))


@dataclass
class LadderOutcome:
    counted: bool
    reason: str | None
    delta: int
    rating: int
    step: int
    promoted: bool
    opponent: str


def apply_result(user: User, rung_index: int, rung: Rung, score: float, assisted: str | None) -> LadderOutcome:
    """Меняет рейтинг и ступень игрока (без commit). score — очки игрока: 1, ½ или 0."""
    if assisted:
        return LadderOutcome(False, assisted, 0, user.ladder_rating, user.ladder_step, False, rung.name)
    k = K_NEW if user.ladder_games < K_NEW_GAMES else K_ESTABLISHED
    delta = round(k * (score - expected_score(user.ladder_rating, rung.rating)))
    user.ladder_rating = max(100, user.ladder_rating + delta)
    user.ladder_games += 1
    promoted = score == 1.0 and rung_index == user.ladder_step and rung_index < len(rungs()) - 1
    if promoted:
        user.ladder_step += 1
    return LadderOutcome(True, None, delta, user.ladder_rating, user.ladder_step, promoted, rung.name)


def find_rung(key: str) -> tuple[int, Rung] | None:
    for index, rung in enumerate(rungs()):
        if rung.key == key:
            return index, rung
    return None


def archetype_for(rung: Rung):
    return ARCHETYPES_BY_NAME[rung.name] if rung.kind == "archetype" else None
