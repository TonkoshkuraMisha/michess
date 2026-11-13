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

Тот же механизм сторожит партию турнира (таск A.2): у сессии своя область (SCOPES) — «ladder» или
«tournament», — проверки ходов и анализа действуют на обе.
"""

import json
import time
from dataclasses import asdict, dataclass

import chess

from src.db import redis as redis_module
from src.models.user import User
from src.services.bots.archetypes import ARCHETYPES, ARCHETYPES_BY_ID
from src.services.bots.calibration import strength_of
from src.services.bots.personality import BotPersonalityConfig

LADDER_SESSION_TTL_S = 4 * 3600
K_NEW = 40  # первые K_NEW_GAMES партий рейтинг подвижнее
K_ESTABLISHED = 24
K_NEW_GAMES = 10


@dataclass(frozen=True)
class Rung:
    key: str  # "morphy" или "archetype:rusher"
    kind: str  # "historical" | "archetype"
    id: str  # id бота или архетипа: имя на языке игрока клиент берёт из каталога
    rating: int
    measured: bool


@dataclass
class LadderSession:
    rung_key: str  # ключ соперника: id бота, «archetype:<id>» или «custom:other»
    color: str  # цвет игрока
    started_at: float
    max_ply: int = -1
    last_fen: str | None = None
    assisted: str | None = None
    tournament_game_id: int | None = None


Scope = str  # "ladder" | "tournament"
SCOPES: tuple[Scope, ...] = ("ladder", "tournament")


def rungs() -> list[Rung]:
    from src.api.bots import AVAILABLE_BOTS

    items = [
        Rung(str(b["id"]), "historical", str(b["id"]), *_strength(str(b["id"]), int(str(b["rating"]))))
        for b in AVAILABLE_BOTS
    ]
    items += [
        Rung(a.key, "archetype", a.id, *_strength(a.key, a.config.target_elo)) for a in ARCHETYPES
    ]
    return sorted(items, key=lambda r: (r.rating, r.key))


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


def _key(user_id: int, scope: Scope = "ladder") -> str:
    return f"{scope}:session:{user_id}"


async def get_session(user_id: int, scope: Scope = "ladder") -> LadderSession | None:
    raw = await redis_module.redis_client.get(_key(user_id, scope))
    if not raw:
        return None
    return LadderSession(**json.loads(raw))


async def _store(user_id: int, session: LadderSession, scope: Scope = "ladder") -> None:
    await redis_module.redis_client.set(_key(user_id, scope), json.dumps(asdict(session)), ex=LADDER_SESSION_TTL_S)


async def clear_session(user_id: int, scope: Scope = "ladder") -> None:
    await redis_module.redis_client.delete(_key(user_id, scope))


async def open_session(
        user_id: int, rung: Rung | str, color: str, scope: Scope = "ladder", tournament_game_id: int | None = None,
) -> LadderSession:
    key = rung if isinstance(rung, str) else rung.key
    session = LadderSession(rung_key=key, color=color, started_at=time.time(), tournament_game_id=tournament_game_id)
    await _store(user_id, session, scope)
    return session


async def _mark(user_id: int, session: LadderSession, reason: str, scope: Scope) -> None:
    if session.assisted is None:
        session.assisted = reason
    await _store(user_id, session, scope)


async def note_analysis(user_id: int | None) -> None:
    """Анализ позиции движком во время партии лестницы или турнира — подсказка."""
    if user_id is None:
        return
    for scope in SCOPES:
        session = await get_session(user_id, scope)
        if session is not None:
            await _mark(user_id, session, "engine_analysis", scope)


async def note_bot_move_request(user_id: int | None, board: chess.Board, requested_key: str) -> None:
    """Запрос хода бота во время партии лестницы или турнира: подсказка, возврат хода или подмена соперника."""
    if user_id is None:
        return
    for scope in SCOPES:
        session = await get_session(user_id, scope)
        if session is not None:
            await _note_move(user_id, session, board, requested_key, scope)


async def _note_move(user_id: int, session: LadderSession, board: chess.Board, requested_key: str, scope: Scope) -> None:
    player_to_move = (board.turn == chess.WHITE) == (session.color == "white")
    if player_to_move:
        await _mark(user_id, session, "engine_hint", scope)
    elif requested_key != session.rung_key:
        await _mark(user_id, session, "opponent_swapped", scope)
    elif board.ply() == session.max_ply and board.fen() == session.last_fen:
        return  # повтор того же запроса (ретрай после сбоя связи, двойной эффект React) — не возврат
    elif board.ply() <= session.max_ply:
        await _mark(user_id, session, "takeback", scope)
    else:
        session.max_ply = board.ply()
        session.last_fen = board.fen()
        await _store(user_id, session, scope)


def expected_score(rating: int, opponent: int) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent - rating) / 400.0))


# Почему партия не засчитана в лестницу: коды, текст на языке игрока — в каталоге клиента (ladder.reasons).
LADDER_REASONS = ("engine_analysis", "engine_hint", "opponent_swapped", "takeback")


@dataclass
class LadderOutcome:
    counted: bool
    reason: str | None  # один из LADDER_REASONS
    delta: int
    rating: int
    step: int
    promoted: bool
    opponent: str  # ключ ступени: «morphy» или «archetype:rusher»


def apply_result(user: User, rung_index: int, rung: Rung, score: float, assisted: str | None) -> LadderOutcome:
    """Меняет рейтинг и ступень игрока (без commit). score — очки игрока: 1, ½ или 0."""
    if assisted:
        return LadderOutcome(False, assisted, 0, user.ladder_rating, user.ladder_step, False, rung.key)
    k = K_NEW if user.ladder_games < K_NEW_GAMES else K_ESTABLISHED
    delta = round(k * (score - expected_score(user.ladder_rating, rung.rating)))
    user.ladder_rating = max(100, user.ladder_rating + delta)
    user.ladder_games += 1
    promoted = score == 1.0 and rung_index == user.ladder_step and rung_index < len(rungs()) - 1
    if promoted:
        user.ladder_step += 1
    return LadderOutcome(True, None, delta, user.ladder_rating, user.ladder_step, promoted, rung.key)


def find_rung(key: str) -> tuple[int, Rung] | None:
    for index, rung in enumerate(rungs()):
        if rung.key == key:
            return index, rung
    return None


def archetype_for(rung: Rung):
    return ARCHETYPES_BY_ID[rung.id] if rung.kind == "archetype" else None
