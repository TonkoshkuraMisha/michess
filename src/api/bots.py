# --- FILE: src/api/bots.py ---

import asyncio
import random
from datetime import UTC, datetime

import chess
import chess.pgn
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api import deps
from src.api.fair_play import forbid_engine_help_during_game, optional_user_id
from src.api.personalities import get_owned_personality, personality_config, validate_personality_name
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError, DomainValueError, validation_error
from src.db import session as db_session
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services import ladder as ladder_service
from src.services.bots import calibration as bot_calibration
from src.services.bots.anderssen import anderssen_bot
from src.services.bots.archetypes import ARCHETYPES, ARCHETYPES_BY_ID, ARCHETYPES_BY_KEY
from src.services.bots.labourdonnais import labourdonnais_bot
from src.services.bots.morphy import morphy_bot
from src.services.bots.paulsen import paulsen_bot
from src.services.bots.personality import BotPersonalityConfig, PersonalityBot
from src.services.bots.philidor import philidor_bot, resolve_stockfish_path
from src.services.bots.staunton import staunton_bot
from src.services.bots.zukertort import zukertort_bot
from src.services.game_engine import board_from_start_fen, flag_outcome, is_standard_start, terminal_outcome
from src.services.rating import classify_time_control

router = APIRouter()

get_db = getattr(deps, "get_db", None) or getattr(db_session, "get_db", None)
get_current_user = getattr(deps, "get_current_user", None)

# Исторические боты. Имя, титул и девиз на языке игрока — в каталогах клиента (bots.profiles.<id>);
# здесь — данные: id (он же имя бота-пользователя в базе), имя для PGN (латиница, как в архивах партий),
# годы, заявленная сила, портрет.
AVAILABLE_BOTS = [
    {
        "id": "philidor",
        "pgn_name": "Philidor, François-André",
        "era": "1749–1795",
        "rating": 1850,
        "avatar": "/assets/champions/philidor.jpg",
    },
    {
        "id": "labourdonnais",
        "pgn_name": "La Bourdonnais, Louis-Charles",
        "era": "1795–1840",
        "rating": 1950,
        "avatar": "/assets/champions/labourdonnais.jpg",
    },
    {
        "id": "staunton",
        "pgn_name": "Staunton, Howard",
        "era": "1810–1874",
        "rating": 2000,
        "avatar": "/assets/champions/staunton.jpg",
    },
    {
        "id": "anderssen",
        "pgn_name": "Anderssen, Adolf",
        "era": "1818–1879",
        "rating": 2100,
        "avatar": "/assets/champions/anderssen.jpg",
    },
    {
        "id": "morphy",
        "pgn_name": "Morphy, Paul",
        "era": "1837–1884",
        "rating": 2150,
        "avatar": "/assets/champions/morphy.jpg",
    },
    {
        "id": "paulsen",
        "pgn_name": "Paulsen, Louis",
        "era": "1833–1891",
        "rating": 2080,
        "avatar": "/assets/champions/paulsen.jpg",
    },
    {
        "id": "zukertort",
        "pgn_name": "Zukertort, Johannes",
        "era": "1842–1888",
        "rating": 2120,
        "avatar": "/assets/champions/zukertort.jpg",
    },
]

BOT_INSTANCES = {
    "philidor": philidor_bot,
    "labourdonnais": labourdonnais_bot,
    "staunton": staunton_bot,
    "anderssen": anderssen_bot,
    "morphy": morphy_bot,
    "paulsen": paulsen_bot,
    "zukertort": zukertort_bot,
}

BOT_METADATA = {b["id"]: b for b in AVAILABLE_BOTS}

# Служебный «хэш» в hashed_password, по которому учётная запись опознаётся как бот.
# Это не валидный bcrypt-хэш, поэтому войти под ботом невозможно.
BOT_PASSWORD_MARKER = "!historical_bot_no_login!"


# Общий бот-пользователь для партий с персоналиями из мастерской: в базе соперник — он,
# а в PGN и архиве показывается имя персоналии (games.personality_name).
CUSTOM_BOT_ID = "custom"
CUSTOM_BOT_USERNAME = "workshop_opponent"
CUSTOM_BOT_RATING = 1500


def reserved_bot_usernames() -> set[str]:
    """Имена (и id) ботов, которые нельзя занять при регистрации (сравнение без регистра)."""
    names: set[str] = {CUSTOM_BOT_USERNAME.casefold()}
    for bot in AVAILABLE_BOTS:
        names.add(str(bot["id"]).casefold())
    # Имена-ключи архетипов в архиве («archetype:rusher») правила имён и так не пропускают (двоеточие),
    # а сами id архетипов занимать нельзя, чтобы игрок не выдавал себя за соперника из лестницы.
    names.update(archetype_id.casefold() for archetype_id in ARCHETYPES_BY_ID)
    return names


BOT_TEMPO_MULTIPLIER = {
    "morphy": 0.72,
    "labourdonnais": 0.78,
    "anderssen": 0.90,
    "philidor": 0.95,
    "zukertort": 1.00,
    "paulsen": 1.22,
    "staunton": 1.28,
}


class BotMoveRequest(BaseModel):
    bot_id: str = Field(default="philidor", description="ID исторического бота")
    fen: str = Field(..., max_length=100, description="Текущая позиция на доске в формате FEN")


class BotComment(BaseModel):
    """Реплика бота: ключ каталога botComments на клиенте и параметры (текст на языке игрока — там)."""
    key: str
    params: dict[str, int | str] = Field(default_factory=dict)


class BotMoveResponse(BaseModel):
    bot_id: str
    uci: str
    san: str
    fen_after: str
    source: str
    comment: BotComment
    thinking_time_ms: int = Field(default=650, description="Рекомендуемое время размышления бота в мс")


class CustomBotMoveRequest(BaseModel):
    config: BotPersonalityConfig | None = Field(
        default=None, description="Характер соперника (ползунки, веса фигур, сила); по умолчанию — сбалансированный",
    )
    personality_id: int | None = Field(
        default=None, description="Сохранённая персоналия игрока (нужен вход) — вместо config",
    )
    fen: str = Field(..., max_length=100, description="Текущая позиция на доске в формате FEN")

    @model_validator(mode="after")
    def _config_or_saved(self) -> "CustomBotMoveRequest":
        if self.config is not None and self.personality_id is not None:
            raise validation_error("config_or_personality")
        return self


class BotGameSaveRequest(BaseModel):
    bot_id: str = Field(..., description="ID исторического бота или 'custom' — персоналия из мастерской")
    personality_id: int | None = Field(default=None, description="Для bot_id='custom': сохранённая персоналия")
    personality_name: str | None = Field(
        default=None, min_length=3, max_length=30,
        description="Для bot_id='custom' без сохранения: имя соперника из конструктора",
    )
    ladder: bool = Field(default=False, description="Партия клубной лестницы (открыта POST /bots/ladder/start)")
    assisted: bool = Field(default=False, description="Игрок пользовался наставником: партия учебная")
    player_color: str = Field(..., description="Цвет игрока ('white' или 'black')")
    result: str = Field(..., description="Результат партии ('1-0', '0-1', '1/2-1/2')")
    termination: str | None = Field(
        default=None,
        description="Для незавершённой на доске позиции: 'resignation' (игрок сдался) или 'timeout' (упал флаг)",
    )
    moves_uci: list[str] = Field(default_factory=list, max_length=1000, description="Список сделанных ходов в формате UCI")
    start_fen: str | None = Field(
        default=None, max_length=120,
        description="Начальная позиция партии (FEN), если она начата не с обычной расстановки",
    )
    # Границы — чтобы значение из запроса поместилось в INTEGER-колонку и не давало 500.
    base_time_ms: int = Field(default=180000, ge=1000, le=86_400_000, description="Базовый контроль времени в мс")
    increment_ms: int = Field(default=0, ge=0, le=3_600_000, description="Добавление времени на ход в мс")


class BotGameSaveResponse(BaseModel):
    game_id: int
    status: str
    result: str
    ladder: ladder_service.LadderOutcome | None = None


def calculate_authentic_thinking_time_ms(
        bot_id: str,
        board: chess.Board,
        uci_move: str,
        source: str,
) -> int:
    """
    Вычисляет реалистичное человеческое время на ход (в мс) для исторического мастера
    с учётом его темпа, дебютной книги, единственного ответа или тактической сложности позиции.
    """
    legal_moves = list(board.legal_moves)
    num_legal = len(legal_moves)
    tempo = BOT_TEMPO_MULTIPLIER.get(bot_id, 1.0)

    if num_legal <= 1:
        return int(random.randint(240, 380) * tempo)

    if source in ("book", "opening_book"):
        base_ms = random.randint(360, 680) + board.fullmove_number * 22
        return int(base_ms * tempo)

    move_obj = chess.Move.from_uci(uci_move)
    is_capture = board.is_capture(move_obj)
    gives_check = board.gives_check(move_obj)

    captures_available = sum(1 for m in legal_moves if board.is_capture(m))
    complexity_ms = min(num_legal * 26, 950) + min(captures_available * 95, 550)

    if board.is_check():
        complexity_ms += 250
    if is_capture or gives_check:
        complexity_ms += 280

    piece_count = len(board.piece_map())
    if piece_count <= 10:
        complexity_ms = int(complexity_ms * 0.65)

    raw_ms = (520 + complexity_ms + random.randint(-110, 180)) * tempo
    return max(320, min(int(raw_ms), 2900))


def _detect_eco_code(moves_uci: list[str]) -> str:
    """Определяет базовый код дебюта ECO по первым ходам партии."""
    prefix = " ".join(moves_uci[:6])
    if prefix.startswith("e2e4 e7e5 g1f3 d7d6"):
        return "C41"
    if prefix.startswith("e2e4 e7e5 f2f4"):
        return "C30"
    if prefix.startswith("e2e4 e7e5 f1c4"):
        return "C23"
    if prefix.startswith("e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4"):
        return "C51"
    if prefix.startswith("e2e4 e7e5 g1f3 b8c6 f1c4"):
        return "C50"
    if prefix.startswith("e2e4 e7e5 g1f3 b8c6 f1b5"):
        return "C60"
    if prefix.startswith("e2e4 c7c5"):
        return "B20"
    if prefix.startswith("e2e4 e7e6"):
        return "C00"
    if prefix.startswith("c2c4"):
        return "A10"
    if prefix.startswith("g1f3"):
        return "A04"
    if prefix.startswith("d2d4 d7d5 c2c4"):
        return "D06"
    if prefix.startswith("d2d4"):
        return "D00"
    if prefix.startswith("e2e4"):
        return "B00"
    return "A00"


def _replay_moves(moves_uci: list[str], start_fen: str | None = None) -> chess.Board:
    """
    Переигрывает ходы с историей (нужна для правил повторения) от обычной расстановки или
    от start_fen; ValueError при нелегальном ходе или невозможной начальной позиции.
    """
    board = board_from_start_fen(start_fen)
    for uci_str in moves_uci:
        try:
            move = chess.Move.from_uci(uci_str)
        except ValueError:
            raise DomainValueError("invalid_history_move", move=uci_str) from None
        if move not in board.legal_moves:
            raise DomainValueError("illegal_history_move", move=uci_str)
        board.push(move)
    return board


def resolve_bot_game_outcome(board: chess.Board, payload: "BotGameSaveRequest") -> tuple[str, str]:
    """
    Итог партии с ботом определяет сервер, а не клиент:
    - позиция на доске финальная (мат, пат, повторение, ...) — результат с доски;
    - игрок сдался — только поражение игрока;
    - упал флаг — победа стороны с неупавшим флагом, но ничья, если у неё нет материала
      для мата (правило ФИДЕ 6.9). Часы партии с ботом живут на клиенте, поэтому сторону
      с упавшим флагом сервер берёт из присланного результата.
    Иначе партия не завершена, и «победу» сохранить нельзя.
    """
    outcome = terminal_outcome(board)
    if outcome is not None:
        return outcome

    if payload.termination == "resignation":
        return ("0-1" if payload.player_color == "white" else "1-0"), "resignation"

    if payload.termination == "timeout":
        if payload.result == "1-0":
            return flag_outcome(board.fen(), "black")
        if payload.result == "0-1":
            return flag_outcome(board.fen(), "white")
        raise DomainValueError("flag_winner_required")

    raise DomainValueError("termination_required")


def _build_pgn_string(
        moves_uci: list[str],
        white_name: str,
        white_elo: int,
        black_name: str,
        black_elo: int,
        result: str,
        start_fen: str | None = None,
) -> tuple[str, str]:
    """Строит валидный PGN-документ с заголовками и возвращает (pgn_text, final_fen)."""
    board = board_from_start_fen(start_fen)
    custom_start = not is_standard_start(board)
    pgn_game = chess.pgn.Game()
    if custom_start:
        # Заголовки SetUp/FEN — стандартный способ записать партию не с начальной расстановки.
        pgn_game.setup(board)
    pgn_game.headers["Event"] = "Historical Bot Match"
    pgn_game.headers["Site"] = "Michess Bot Arena"
    pgn_game.headers["Date"] = datetime.now(UTC).strftime("%Y.%m.%d")
    pgn_game.headers["Round"] = "-"
    pgn_game.headers["White"] = white_name
    pgn_game.headers["Black"] = black_name
    pgn_game.headers["Result"] = result
    pgn_game.headers["WhiteElo"] = str(white_elo)
    pgn_game.headers["BlackElo"] = str(black_elo)
    if not custom_start:
        pgn_game.headers["ECO"] = _detect_eco_code(moves_uci)

    node: chess.pgn.GameNode = pgn_game
    for uci_str in moves_uci:
        move = chess.Move.from_uci(uci_str)
        if move not in board.legal_moves:
            raise DomainValueError("illegal_history_move", move=uci_str)
        board.push(move)
        node = node.add_variation(move)

    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    return pgn_game.accept(exporter).strip(), board.fen()


async def _get_or_create_bot_user(db: AsyncSession, bot_id: str) -> User:
    """Находит или создаёт запись бота в таблице пользователей (исторического или общего для персоналий)."""
    if bot_id == CUSTOM_BOT_ID:
        bot_username, bot_rating = CUSTOM_BOT_USERNAME, CUSTOM_BOT_RATING
    else:
        bot_username, bot_rating = bot_id, int(str(BOT_METADATA[bot_id]["rating"]))

    stmt = select(User).where(User.username == bot_username)
    res = await db.execute(stmt)
    bot_user = res.scalar_one_or_none()
    if bot_user is not None:
        if bot_user.is_bot:
            return bot_user
        # Имя занято человеком (до запрета регистрации имён ботов) — не приписываем ему
        # партии бота, а заводим бота под служебным именем.
        bot_username = f"{bot_username}_bot"
        res = await db.execute(select(User).where(User.username == bot_username))
        bot_user = res.scalar_one_or_none()
        if bot_user is not None:
            return bot_user

    bot_user = User(
        username=bot_username,
        hashed_password=BOT_PASSWORD_MARKER,
        # Фиксированная «историческая сила» бота — одинаковая во всех категориях: партии
        # с ботом не рейтинговые (is_rated=False), это чисто отображаемое значение.
        bullet_rating=bot_rating,
        blitz_rating=bot_rating,
        rapid_rating=bot_rating,
        classical_rating=bot_rating,
        is_bot=True,
    )
    db.add(bot_user)
    await db.flush()
    return bot_user


def _prepare_game_kwargs(
        white_id: int,
        black_id: int,
        pgn_text: str,
        final_fen: str,
        payload: BotGameSaveRequest,
) -> dict:
    """Формирует словарь полей модели Game для завершённой партии с ботом."""
    now_utc = datetime.now(UTC)
    return {
        "white_player_id": white_id,
        "black_player_id": black_id,
        "pgn": pgn_text,
        "board_fen": final_fen,
        "result": payload.result,
        "termination": payload.termination or "normal",
        "is_rated": False,
        "base_time_ms": payload.base_time_ms,
        "increment_ms": payload.increment_ms,
        "status": GameStatus.COMPLETED,
        "finished_at": now_utc,
        "pgn_date": now_utc.strftime("%Y.%m.%d"),
        "site": "Michess Bot Arena",
        # У партии с произвольной позиции дебюта нет.
        "eco": None if payload.start_fen else _detect_eco_code(payload.moves_uci),
    }


def _playable_board(fen: str) -> chess.Board:
    """Позиция, в которой боту есть что ходить; иначе 400."""
    try:
        board = chess.Board(fen)
    except ValueError:
        raise ApiError(400, "invalid_fen") from None

    # chess.Board принимает и невозможные позиции (без короля, короли рядом, под шахом сторона,
    # которая только что ходила) — движок на них может упасть и выбыть из пула.
    if not board.is_valid():
        raise ApiError(400, "invalid_position")

    if board.is_game_over():
        raise ApiError(400, "game_already_over")
    return board


@router.get("/catalog")
async def get_bot_catalog():
    """
    Сила ботов и архетипы мастерской: заявленный рейтинг и измеренный матчами с якорями Stockfish
    (scripts/calibrate_bots.py), если калибровка уже была.
    """
    def strength(key: str, declared: int) -> dict:
        s = bot_calibration.strength_of(key, declared)
        return {"declared_rating": declared, "rating": s.rating, "measured": s.measured,
                "games": s.games, "ci95": s.ci95}

    return {
        "calibration": bot_calibration.load_calibration().get("meta"),
        "historical": [{"id": b["id"], **strength(str(b["id"]), int(str(b["rating"])))} for b in AVAILABLE_BOTS],
        "archetypes": [
            {"id": a.id, "config": a.config.model_dump(), **strength(a.key, a.config.target_elo)}
            for a in ARCHETYPES
        ],
    }


@router.get("/list")
async def get_available_bots():
    """Возвращает список доступных исторических ботов и статус движка Stockfish."""
    return {
        "bots": AVAILABLE_BOTS,
        "stockfish_active": bool(resolve_stockfish_path()),
    }


@router.post(
    "/move",
    response_model=BotMoveResponse,
    # Ход бота на произвольной позиции — та же подсказка движка, что и анализ.
    dependencies=[
        Depends(rate_limit("bot_move", "RATE_LIMIT_BOT_MOVE")),
        Depends(forbid_engine_help_during_game),
    ],
)
async def get_bot_move(payload: BotMoveRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Принимает FEN позиции и возвращает ответный ход выбранного исторического бота."""
    bot = BOT_INSTANCES.get(payload.bot_id)
    if bot is None:
        raise ApiError(404, "bot_not_found", bot_id=payload.bot_id)

    board = _playable_board(payload.fen)
    await ladder_service.note_bot_move_request(await optional_user_id(request, db), board, payload.bot_id)
    result = await asyncio.to_thread(bot.choose_move, payload.fen)
    thinking_time_ms = calculate_authentic_thinking_time_ms(
        bot_id=payload.bot_id,
        board=board,
        uci_move=result["uci"],
        source=result["source"],
    )

    return BotMoveResponse(
        bot_id=payload.bot_id,
        uci=result["uci"],
        san=result["san"],
        fen_after=result["fen_after"],
        source=result["source"],
        comment=result["comment"],
        thinking_time_ms=thinking_time_ms,
    )


@router.post(
    "/custom-move",
    response_model=BotMoveResponse,
    # Общий с /move лимит: та же нагрузка на Stockfish и та же подсказка движка.
    dependencies=[
        Depends(rate_limit("bot_move", "RATE_LIMIT_BOT_MOVE")),
        Depends(forbid_engine_help_during_game),
    ],
)
async def get_custom_bot_move(
        payload: CustomBotMoveRequest, request: Request, db: AsyncSession = Depends(get_db),
):
    """Ход соперника, собранного из ползунков характера (src/services/bots/personality.py)."""
    board = _playable_board(payload.fen)
    config = payload.config
    if payload.personality_id is not None:
        owner = await _bearer_user(request, db)
        config = personality_config(await get_owned_personality(db, owner.id, payload.personality_id))
    bot = PersonalityBot(config or BotPersonalityConfig())
    await ladder_service.note_bot_move_request(
        await optional_user_id(request, db), board,
        ladder_service.opponent_key("custom", None if payload.personality_id is not None else bot.config),
    )
    result = await asyncio.to_thread(bot.choose_move, payload.fen)
    return BotMoveResponse(
        bot_id=bot.bot_id,
        uci=result["uci"],
        san=result["san"],
        fen_after=result["fen_after"],
        source=result["source"],
        comment=result["comment"],
        thinking_time_ms=calculate_authentic_thinking_time_ms(
            bot_id=bot.bot_id, board=board, uci_move=result["uci"], source=result["source"],
        ),
    )


async def _bearer_user(request: Request, db: AsyncSession) -> User:
    """Пользователь по заголовку Authorization или 401 — для сохранённых персоналий."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    user = await deps.user_from_token(db, token) if scheme.lower() == "bearer" and token else None
    if user is None:
        raise ApiError(401, "login_required_for_personality")
    return user


async def _ladder_game_for_save(
        user: User, payload: BotGameSaveRequest,
) -> tuple[ladder_service.LadderSession, int, ladder_service.Rung]:
    """Открытая партия лестницы, которой соответствует сохраняемая партия, или 409."""
    session = await ladder_service.get_session(user.id)
    found = ladder_service.find_rung(session.rung_key) if session else None
    if session is None or found is None:
        raise ApiError(409, "ladder_game_missing")
    _, rung = found
    expected = (rung.key, None) if rung.kind == "historical" else (CUSTOM_BOT_ID, rung.key)
    actual = (payload.bot_id, payload.personality_name if payload.bot_id == CUSTOM_BOT_ID else None)
    if actual != expected or payload.player_color != session.color:
        raise ApiError(409, "ladder_game_mismatch")
    return session, *found


async def _resolve_personality_for_save(
        db: AsyncSession, user: User, payload: BotGameSaveRequest,
) -> tuple[str | None, int | None]:
    """(имя персоналии, её целевой рейтинг) для партии с ботом 'custom'; для исторических — (None, None)."""
    if payload.bot_id != CUSTOM_BOT_ID:
        return None, None
    if payload.personality_id is not None:
        personality = await get_owned_personality(db, user.id, payload.personality_id)
        return personality.name, personality_config(personality).target_elo
    if payload.personality_name is None:
        raise ApiError(400, "custom_opponent_missing")
    # Архетип мастерской (в том числе соперник лестницы) — по ключу «archetype:<id>»: в архиве его имя
    # покажется на языке игрока.
    archetype = ARCHETYPES_BY_KEY.get(payload.personality_name)
    if archetype is not None:
        return archetype.key, archetype.config.target_elo
    try:
        return validate_personality_name(payload.personality_name), None
    except PydanticCustomError as exc:
        raise ApiError(400, exc.type, **(exc.context or {})) from None


@router.post("/save-game", response_model=BotGameSaveResponse)
async def save_bot_game(
        payload: BotGameSaveRequest,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """Сохраняет завершённую партию против исторического бота или персоналии из мастерской."""
    if payload.bot_id != CUSTOM_BOT_ID and payload.bot_id not in BOT_METADATA:
        raise ApiError(404, "bot_not_found", bot_id=payload.bot_id)
    personality_name, personality_elo = await _resolve_personality_for_save(db, current_user, payload)
    ladder_game = await _ladder_game_for_save(current_user, payload) if payload.ladder else None

    if payload.player_color not in ("white", "black"):
        raise ApiError(400, "invalid_player_color")

    if payload.result not in ("1-0", "0-1", "1/2-1/2"):
        raise ApiError(400, "invalid_result")

    if not payload.moves_uci:
        raise ApiError(400, "empty_moves")

    try:
        final_board = _replay_moves(payload.moves_uci, payload.start_fen)
        result, termination = resolve_bot_game_outcome(final_board, payload)
    except DomainValueError as exc:
        raise exc.to_http(400) from exc
    # Обычная расстановка, присланная как FEN, — это не «своя позиция».
    start_fen = None if is_standard_start(final_board) else final_board.root().fen()
    payload = payload.model_copy(update={"result": result, "termination": termination, "start_fen": start_fen})

    bot_user = await _get_or_create_bot_user(db, payload.bot_id)

    if payload.player_color == "white":
        white_user, black_user = current_user, bot_user
    else:
        white_user, black_user = bot_user, current_user

    category = classify_time_control(payload.base_time_ms, payload.increment_ms)

    def _pgn_player(user: User) -> tuple[str, int]:
        if user.id == bot_user.id:
            # Соперник-персоналия — под своим именем (архетип — под английским именем) и с целевой силой.
            if personality_name:
                archetype = ARCHETYPES_BY_KEY.get(personality_name)
                name = archetype.pgn_name if archetype else personality_name
                return name, personality_elo or user.rating_for(category)
            # Исторический бот — под именем для PGN, как партии мастеров в архиве.
            return str(BOT_METADATA[payload.bot_id]["pgn_name"]), user.rating_for(category)
        return user.username, user.rating_for(category)

    (white_name, white_elo), (black_name, black_elo) = _pgn_player(white_user), _pgn_player(black_user)
    try:
        pgn_text, final_fen = _build_pgn_string(
            moves_uci=payload.moves_uci,
            white_name=white_name,
            white_elo=white_elo,
            black_name=black_name,
            black_elo=black_elo,
            result=payload.result,
            start_fen=payload.start_fen,
        )
    except DomainValueError as exc:
        raise exc.to_http(400) from exc

    game_kwargs = _prepare_game_kwargs(
        white_id=white_user.id,
        black_id=black_user.id,
        pgn_text=pgn_text,
        final_fen=final_fen,
        payload=payload,
    )

    new_game = Game(**game_kwargs, personality_name=personality_name, assisted=payload.assisted)
    db.add(new_game)
    ladder_outcome = None
    if ladder_game is not None:
        session, rung_index, rung = ladder_game
        player_score = {"1-0": 1.0, "0-1": 0.0}.get(result, 0.5)
        if payload.player_color == "black" and result != "1/2-1/2":
            player_score = 1.0 - player_score
        ladder_outcome = ladder_service.apply_result(current_user, rung_index, rung, player_score, session.assisted)
    await db.commit()
    await db.refresh(new_game)
    if ladder_game is not None:
        await ladder_service.clear_session(current_user.id)

    return BotGameSaveResponse(
        game_id=new_game.id,
        status="finished",
        result=result,
        ladder=ladder_outcome,
    )
