# --- FILE: src/api/bots.py ---
"""
Боты (/bots): каталог соперников, ход бота, ответ на предложение ничьей, сохранение сыгранной партии.

* Кто есть: AVAILABLE_BOTS — исторические боты и мастера с годами жизни и заявленной силой; /catalog добавляет
  архетипы мастерской и измеренную силу (calibration.json), /guests — мастеров прошлого из «Машины времени».
  Имена и описания на языке игрока — в каталогах клиента по id.
* Ход: /move — исторический бот (src/services/bots/base.py), /custom-move — соперник из настроек характера
  (src/services/bots/personality.py). Оба — под лимитом RATE_LIMIT_BOT_MOVE и правилом честной игры: во время
  своей партии с человеком ход движка получить нельзя. Время «раздумья» бота считает сервер
  (calculate_authentic_thinking_time_ms), клиент выдерживает паузу.
* Партия с ботом идёт на клиенте и сохраняется целиком после окончания (/save-game). Итог определяет сервер, а
  не клиент: ходы переигрываются, результат берётся с доски; сдача даёт только поражение игрока; при упавшем
  флаге побеждает сторона, у которой осталось время, а если ей нечем ставить мат — ничья. Часы партии с ботом идут
  на клиенте, поэтому сторону с упавшим флагом сервер берёт из присланного результата
  (resolve_bot_game_outcome). Сохранение обновляет лестницу
  (src/services/ladder.py), турнир (src/services/tournaments.py) и память бота (src/services/bots/memory.py).
* В таблице users у каждого бота своя запись с меткой вместо пароля — войти под ботом нельзя; соперники
  мастерской играют под общей записью CUSTOM_BOT_USERNAME, а имя персоналии хранится в games.personality_name.
"""

import asyncio
import logging
import random
from datetime import UTC, datetime
from typing import Literal

import chess
import chess.pgn
from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api import deps
from src.api.fair_play import forbid_engine_help_during_game, optional_user_id
from src.api.personalities import get_owned_personality, personality_config, validate_personality_name
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError, DomainError, DomainValueError, validation_error
from src.db import session as db_session
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services import engine_info, move_check, openings, product_metrics
from src.services import ladder as ladder_service
from src.services import tournaments as tournament_service
from src.services.bots import BOT_INSTANCES  # единственный реестр ботов (src/services/bots/__init__.py)
from src.services.bots import calibration as bot_calibration
from src.services.bots import memory as bot_memory
from src.services.bots import selfplay as bot_selfplay
from src.services.bots.archetypes import ARCHETYPES, ARCHETYPES_BY_ID, ARCHETYPES_BY_KEY
from src.services.bots.guests import GUESTS, GUESTS_BY_ID, GUESTS_BY_PGN_NAME, SIGNATURE_OPENINGS
from src.services.bots.masters import MASTERS
from src.services.bots.personality import DRAW_OFFER_MIN_MOVE, BotPersonalityConfig, PersonalityBot, draw_answer
from src.services.bots.philidor import resolve_stockfish_path
from src.services.engine_pool import engine_work
from src.services.game_engine import board_from_start_fen, flag_outcome, is_standard_start, terminal_outcome
from src.services.rating import classify_time_control
from src.services.task_dispatch import schedule_game_analysis_in_background, schedule_tournament_simulations_in_background

router = APIRouter()

# Те же зависимости, что и в остальных разделах: get_db — сессия базы на запрос (src/db/session.py),
# get_current_user — вошедший игрок (src/api/deps.py).
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
    # Мастера второй волны (таск 21.5): портреты — из раздела чемпионов; с 18.11 — ступени лестницы, как все боты.
    *({"id": m.id, "pgn_name": m.pgn_name, "era": m.era, "rating": m.rating,
       "avatar": f"/assets/champions/{m.id.capitalize()}.jpg"} for m in MASTERS),
]

logger = logging.getLogger(__name__)

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


# Темп «раздумья» исторических ботов первой волны: множитель к времени на ход (меньше 1 — играет быстрее).
# Числа заданы вручную; у остальных ботов и соперников мастерской множитель 1.
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
    """Запрос хода исторического бота (POST /bots/move): кто ходит и в какой позиции."""
    bot_id: str = Field(default="philidor", description="ID исторического бота")
    fen: str = Field(..., max_length=100, description="Текущая позиция на доске в формате FEN")


class BotComment(BaseModel):
    """Реплика бота: ключ каталога botComments на клиенте и параметры (текст на языке игрока — там)."""
    key: str
    params: dict[str, int | str] = Field(default_factory=dict)


class BotMoveResponse(BaseModel):
    """
    Ход бота: запись хода, позиция после него, источник хода (source: дебютная книга или движок), реплика бота и
    время «раздумья», которое клиент выдерживает перед показом хода.
    """
    bot_id: str
    uci: str
    san: str
    fen_after: str
    source: str
    comment: BotComment
    thinking_time_ms: int = Field(default=650, description="Рекомендуемое время размышления бота в мс")


class CustomBotMoveRequest(BaseModel):
    """
    Запрос хода соперника мастерской: позиция и либо настройки характера, либо id сохранённой персоналии (не оба
    сразу).
    """
    config: BotPersonalityConfig | None = Field(
        default=None, description="Характер соперника (ползунки, веса фигур, сила); по умолчанию — сбалансированный",
    )
    personality_id: int | None = Field(
        default=None, description="Сохранённая персоналия игрока (нужен вход) — вместо config",
    )
    fen: str = Field(..., max_length=100, description="Текущая позиция на доске в формате FEN")

    @model_validator(mode="after")
    def _config_or_saved(self) -> CustomBotMoveRequest:
        if self.config is not None and self.personality_id is not None:
            raise validation_error("config_or_personality")
        return self


class BotGameSaveRequest(BaseModel):
    """
    Сыгранная партия с ботом для сохранения: соперник, цвет игрока, ходы, заявленный итог, контроль времени и признаки
    особой партии (лестница, турнир, наставник, вслепую, своя начальная позиция). Итог сервер определяет сам.
    """
    bot_id: str = Field(..., description="ID исторического бота или 'custom' — персоналия из мастерской")
    personality_id: int | None = Field(default=None, description="Для bot_id='custom': сохранённая персоналия")
    personality_name: str | None = Field(
        default=None, min_length=3, max_length=30,
        description="Для bot_id='custom' без сохранения: имя соперника из конструктора",
    )
    ladder: bool = Field(default=False, description="Партия клубной лестницы (открыта POST /bots/ladder/start)")
    tournament_game_id: int | None = Field(default=None, description="Партия турнира игрока (таск 15.3)")
    assisted: bool = Field(default=False, description="Игрок пользовался наставником: партия учебная")
    blindfold: int | None = Field(default=None, ge=1, le=4, description="Игра вслепую (таск 19.5): ступень 1–4")
    peeks: int = Field(default=0, ge=0, le=10_000, description="Сколько раз игрок подсмотрел позицию")
    player_color: str = Field(..., description="Цвет игрока ('white' или 'black')")
    result: str = Field(..., description="Результат партии ('1-0', '0-1', '1/2-1/2')")
    termination: str | None = Field(
        default=None,
        description="Для незавершённой на доске позиции: 'resignation' (игрок сдался), 'timeout' (упал флаг) или "
                    "'agreement' (бот принял ничью, таск 21.4; не для лестницы и турнира)",
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
    """
    Ответ на сохранение: id партии и её итог, исход для лестницы, турнир и причина технического поражения в нём,
    изменение рейтинга.
    """
    game_id: int
    status: str
    result: str
    ladder: ladder_service.LadderOutcome | None = None
    tournament_id: int | None = None
    # Причина поражения в турнире вместо результата на доске (код, как у лестницы: engine_hint, takeback, coach...).
    tournament_forfeit: str | None = None
    # Все турниры рейтинговые (15.4): изменение рейтинга игрока в категории контроля турнира.
    rating_before: int | None = None
    rating_after: int | None = None
    rating_delta: int | None = None


def calculate_authentic_thinking_time_ms(
        bot_id: str,
        board: chess.Board,
        uci_move: str,
        source: str,
) -> int:
    """
    Вычисляет реалистичное человеческое время на ход (в мс) для исторического мастера
    с учётом его темпа, дебютной книги, единственного ответа или тактической сложности позиции.

    Это имитация для клиента, а не время работы движка: единственный ход — около 0,3 с, ход по книге — 0,4–0,7 с
    плюс немного с каждым ходом партии, остальные — от 0,32 до 2,9 с (больше ходов и взятий на доске, шах или
    взятие — дольше; в позиции с десятью и менее фигурами — быстрее). В значении есть случайная составляющая.
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


def resolve_bot_game_outcome(board: chess.Board, payload: BotGameSaveRequest) -> tuple[str, str]:
    """
    Итог партии с ботом определяет сервер, а не клиент:
    - позиция на доске финальная (мат, пат, повторение, ...) — результат с доски;
    - игрок сдался — только поражение игрока;
    - упал флаг — победа стороны с неупавшим флагом, но ничья, если у неё нет материала
      для мата (правило ФИДЕ 6.9). Часы партии с ботом живут на клиенте, поэтому сторону
      с упавшим флагом сервер берёт из присланного результата;
    - бот согласился на ничью (termination='agreement') — ничья. Согласие сервер не запоминает и проверить не
      может, поэтому в партиях лестницы и турнира такой итог не принимается (проверка — в save_bot_game).
    Иначе партия не завершена, и «победу» сохранить нельзя.
    Возвращает (результат, причина окончания).
    """
    outcome = terminal_outcome(board)
    if outcome is not None:
        return outcome

    if payload.termination == "resignation":
        return ("0-1" if payload.player_color == "white" else "1-0"), "resignation"

    if payload.termination == "agreement":
        return "1/2-1/2", "agreement"

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
    pgn_game.headers["Site"] = "Regence Bot Arena"
    pgn_game.headers["Date"] = datetime.now(UTC).strftime("%Y.%m.%d")
    pgn_game.headers["Round"] = "-"
    pgn_game.headers["White"] = white_name
    pgn_game.headers["Black"] = black_name
    pgn_game.headers["Result"] = result
    pgn_game.headers["WhiteElo"] = str(white_elo)
    pgn_game.headers["BlackElo"] = str(black_elo)
    if not custom_start:
        pgn_game.headers["ECO"] = openings.eco_code(moves_uci)

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
        # Фиксированная «историческая сила» бота — одинаковая во всех категориях: это чисто отображаемое
        # значение, рейтинг самого бота партии не меняют. Партии с ботом не рейтинговые (is_rated=False), кроме
        # турнирных — там меняется только рейтинг игрока.
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
        "site": "Regence Bot Arena",
        # У партии с произвольной позиции дебюта нет.
        "eco": None if payload.start_fen else openings.eco_code(payload.moves_uci),
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


@router.get("/engine")
async def get_engine_info():
    """
    Движок этой установки для «О проекте» (таск 23.1): версия, лицензия GPL-3.0 и исходники именно этой версии.
    Сведения без опасности для честной игры — ни оценок, ни ходов.
    """
    return await asyncio.to_thread(engine_info.describe, resolve_stockfish_path())


PUBLIC_LIMIT = Depends(rate_limit("public_api", "RATE_LIMIT_PUBLIC_API", code="public_api_rate_limited"))


@router.get("/calibration/runs", dependencies=[PUBLIC_LIMIT])
async def get_calibration_runs():
    """Журналы прогонов калибровки (таск 24.3): протоколы матчей и партии — как записаны при прогоне."""
    return {"calibration": bot_calibration.load_calibration().get("meta"), "runs": bot_calibration.runs()}


@router.get("/calibration/runs/{name}", response_class=PlainTextResponse, dependencies=[PUBLIC_LIMIT])
async def get_calibration_run(name: str = Path(..., max_length=80)):
    """
    Один журнал прогона калибровки текстом (PGN партий или протокол матчей) — файл, записанный
    scripts/calibrate_bots.py; 404, если такого журнала нет. Открыт всем, под лимитом открытого API.
    """
    text = await asyncio.to_thread(bot_calibration.read_run, name)
    if text is None:
        raise ApiError(404, "calibration_run_not_found")
    return PlainTextResponse(text, media_type="application/x-chess-pgn" if name.endswith(".pgn") else "text/plain")


@router.get("/catalog")
async def get_bot_catalog(db: AsyncSession = Depends(get_db)):
    """
    Сила ботов и архетипы мастерской: заявленный рейтинг и измеренный матчами с якорями Stockfish
    (scripts/calibrate_bots.py), если калибровка уже была. У исторических ботов — ещё live: рейтинг по партиям с
    людьми, их число и поправка силы движка (таск 32.1).
    """
    def strength(key: str, declared: int) -> dict:
        s = bot_calibration.strength_of(key, declared)
        return {"declared_rating": declared, "rating": s.rating, "measured": s.measured,
                "games": s.games, "ci95": s.ci95}

    live = await bot_memory.live_strength(db)
    # Архетипы — с ползунками силы, подстроенными самоигрой (таск 32.3).
    await bot_selfplay.refresh(db)

    def live_of(key: str) -> dict | None:
        row = live.get(key)
        return {"rating": round(row.rating), "games": row.games, "offset": row.offset} if row else None

    return {
        "calibration": bot_calibration.load_calibration().get("meta"),
        "historical": [{"id": b["id"], **strength(str(b["id"]), int(str(b["rating"]))), "live": live_of(str(b["id"]))}
                       for b in AVAILABLE_BOTS],
        "archetypes": [
            {"id": a.id, "config": bot_selfplay.tuned_config(a).model_dump(), **strength(a.key, a.config.target_elo)}
            for a in ARCHETYPES
        ],
    }


@router.get("/tuning-log", dependencies=[PUBLIC_LIMIT])
async def get_tuning_log(db: AsyncSession = Depends(get_db)):
    """Открытый журнал подстройки характера самоигрой (таск 32.3): что измерено и как сдвинуты ползунки силы."""
    rows = await bot_selfplay.journal(db)
    return {"entries": [{
        "key": r.key, "created_at": r.created_at.isoformat() if r.created_at else None, "games": r.games,
        "measured": r.measured, "target": r.target, "randomness": [r.randomness_before, r.randomness_after],
        "blunder_guard_cp": [r.guard_before, r.guard_after],
    } for r in rows], "rules": {"games": bot_selfplay.TUNE_GAMES, "drift": bot_selfplay.DRIFT}}


@router.get("/rivalry")
async def get_rivalry(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Какие исторические боты помнят игрока (таск 32.2): сколько партий и сколько очков в них набрал бот."""
    rivals = await bot_memory.rivals_of(db, current_user.id)
    return {"rivals": [{"bot_id": r.bot_id, "games": r.games, "bot_points": r.points,
                        "remembers": r.games >= bot_memory.RIVAL_MIN_GAMES} for r in rivals]}


@router.get("/guests", dependencies=[PUBLIC_LIMIT])
async def get_guests():
    """
    Мастера прошлого — каталог соперников (таск 28.5): участники турниров «Машины времени», с каждым можно сыграть
    отдельную партию. Сервер отдаёт ключи и числа: имя и строку о мастере клиент берёт из каталога по id, названия
    турниров — по ключам; фирменные дебюты — названия из открытой таблицы дебютов.
    """
    from src.services import time_machine

    events_of: dict[str, list[str]] = {}
    for event in time_machine.EVENTS:
        for entry in event.field:
            events_of.setdefault(entry.id, []).append(event.key)
    guests = []
    for guest in GUESTS:
        white, black = SIGNATURE_OPENINGS.get(guest.id, ((), ()))
        guests.append({
            "id": guest.id, "pgn_name": guest.pgn_name, "era": guest.era, "rating": guest.rating,
            "events": events_of.get(guest.id, []), "openings": {"white": list(white), "black": list(black)},
        })
    return {"guests": guests}


@router.get("/guests/{guest_id}", dependencies=[PUBLIC_LIMIT])
async def get_guest(guest_id: str = Path(..., max_length=40)):
    """Характер мастера прошлого — чтобы начать с ним партию: тот же, с которым он играет в историческом турнире."""
    guest = GUESTS_BY_ID.get(guest_id)
    if guest is None:
        raise ApiError(404, "guest_not_found")
    return {"id": guest.id, "pgn_name": guest.pgn_name, "rating": guest.rating, "config": guest.config.model_dump()}


class DrawOfferRequest(BaseModel):
    """
    Предложение ничьей боту: позиция, кто соперник и каким цветом он играет; для соперника мастерской — его
    характер (config) или id сохранённой персоналии.
    """
    fen: str = Field(..., max_length=100)
    bot_id: str = Field(..., max_length=40)
    bot_color: Literal["white", "black"]
    config: BotPersonalityConfig | None = None
    personality_id: int | None = None


# Отношение исторических мастеров к ничьей (таск 21.4): атакующие романтики соглашаются неохотно.
HISTORICAL_DRAW_ATTITUDE = {"labourdonnais": -40, "anderssen": -60, "morphy": -40, "zukertort": -20}


@router.post("/draw-offer", dependencies=[
    Depends(rate_limit("bot_move", "RATE_LIMIT_BOT_MOVE")),
    Depends(forbid_engine_help_during_game),
])
async def draw_offer(payload: DrawOfferRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Ответ бота на предложение ничьей (таск 21.4): по оценке позиции за бота и его отношению к ничьей. В дебюте
    (до 10-го хода, personality.DRAW_OFFER_MIN_MOVE) бот не соглашается — партия ещё не началась — и движок не
    вызывается. Оценка берётся из кэша оценок или считается движком (move_check.evaluate_cached); это оценка
    позиции, поэтому эндпоинт закрыт правилом честной игры и лимитом ходов бота. Сервер согласие не запоминает.
    """
    board = _playable_board(payload.fen)
    if payload.bot_id == CUSTOM_BOT_ID:
        config = payload.config or BotPersonalityConfig()
        if payload.personality_id is not None:
            owner = await _bearer_user(request, db)
            config = personality_config(await get_owned_personality(db, owner.id, payload.personality_id))
    elif payload.bot_id in BOT_INSTANCES:
        config = BotPersonalityConfig(draw_attitude=HISTORICAL_DRAW_ATTITUDE.get(payload.bot_id, 0))
    else:
        raise ApiError(404, "bot_not_found", bot_id=payload.bot_id)
    score = None
    if board.fullmove_number >= DRAW_OFFER_MIN_MOVE:
        evaluation = await move_check.evaluate_cached(board)
        if evaluation is None:
            raise ApiError(503, "engine_busy", headers={"Retry-After": "5"})
        score = evaluation.cp_white if payload.bot_color == "white" else -evaluation.cp_white
    accepted, comment = draw_answer(config, score, board.fullmove_number)
    return {"accepted": accepted, "comment": comment}


@router.get("/openings")
async def search_openings(q: str = Query("", max_length=60), epd: list[str] = Query(default_factory=list, max_length=120)):
    """
    Дебюты для мастерской (таск 21.2): поиск по названию или коду ECO, либо записи по позициям (EPD) — чтобы
    показать названия уже выбранных. Названия — английские имена собственные из открытой таблицы.
    """
    table = openings.lines()
    found = [table[key] for key in epd if key in table] if epd else openings.search(q)
    return {"openings": [{"eco": o.eco, "name": o.name, "epd": o.epd, "moves": list(o.moves)} for o in found]}


@router.get("/list")
async def get_available_bots():
    """
    Возвращает список доступных исторических ботов (AVAILABLE_BOTS) и статус движка Stockfish: найден ли его
    бинарник на этом сервере. Открыт всем.
    """
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
    """
    Принимает FEN позиции и возвращает ответный ход выбранного исторического бота. Доступно и гостю. Перед ходом:
    запрос отмечается в сессии лестницы или турнира игрока (подсказка, возврат хода или подмена соперника —
    src/services/ladder.py), бот подгружает свою память (итоги дебютов, а в дебюте — и память об этом сопернике,
    src/services/bots/memory.py). Сам выбор хода — синхронный расчёт в отдельном потоке.
    """
    bot = BOT_INSTANCES.get(payload.bot_id)
    if bot is None:
        raise ApiError(404, "bot_not_found", bot_id=payload.bot_id)

    board = _playable_board(payload.fen)
    user_id = await optional_user_id(request, db)
    await ladder_service.note_bot_move_request(user_id, board, payload.bot_id)
    await bot_memory.refresh(db, payload.bot_id)
    # Память о сопернике (таск 32.2) нужна только в дебюте — пока бот играет по книге.
    in_opening = (board.fullmove_number - 1) * 2 + (board.turn == chess.BLACK) < bot_memory.BOOK_PLIES
    bot_memory.use_rival(await bot_memory.load_rival(db, payload.bot_id, user_id) if in_opening else None)
    with engine_work("bot_move"):
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
    """
    Ход соперника, собранного из ползунков характера (src/services/bots/personality.py): характер прислан в
    запросе (доступно гостю) или берётся из сохранённой персоналии игрока (нужен вход, чужая — 404). Запрос так же
    отмечается в сессии лестницы или турнира.
    """
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
    with engine_work("bot_move"):
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


async def _tournament_game_for_save(
        db: AsyncSession, user: User, payload: BotGameSaveRequest,
) -> tournament_service.PlayerGame:
    """Партия турнира игрока, которой соответствует сохраняемая партия: соперник, цвет и контроль — как в турнире."""
    assert payload.tournament_game_id is not None
    try:
        played = await tournament_service.player_game(db, user, payload.tournament_game_id)
    except DomainError as exc:
        raise exc.to_http(404 if exc.code == "tournament_not_found" else 409) from None
    matches = (
        payload.player_color == played.color
        and tournament_service.opponent_matches(played.opponent, payload.bot_id, payload.personality_name)
        and (payload.base_time_ms, payload.increment_ms) == (played.game.base_time_ms, played.game.increment_ms)
        and not payload.start_fen
        and not payload.ladder
    )
    if not matches:
        raise ApiError(409, "tournament_game_mismatch")
    session = await ladder_service.get_session(user.id, "tournament")
    if session is None or session.tournament_game_id != played.game.id:
        # Партию турнира начинают через POST /tournaments/{id}/games/{game_id}/start (таск A.2).
        raise ApiError(409, "tournament_game_not_started")
    return played


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
    # Мастер прошлого («Машина времени») — под именем из PGN («Фамилия, Имя»): правила имён игроков к нему не
    # применяются (запятая и пробел в них запрещены — занять такое имя персоналией нельзя), сила — из реестра.
    guest = GUESTS_BY_PGN_NAME.get(payload.personality_name)
    if guest is not None:
        return guest.pgn_name, guest.rating
    try:
        return validate_personality_name(payload.personality_name), None
    except PydanticCustomError as exc:
        raise ApiError(400, exc.type, **(exc.context or {})) from None


async def _remember_bot_game(db: AsyncSession, payload: BotGameSaveRequest, result: str, player_rating: int,
                             player_id: int) -> None:
    """
    Память исторического бота после партии (src/services/bots/memory.py): итог сыгранных ходов дебютной книги —
    всегда; память об этом сопернике — если игрок не пользовался наставником; рейтинг бота по партиям с людьми —
    если к тому же партия не вслепую. Сбой здесь только записывается в журнал.
    """
    bot_color = chess.BLACK if payload.player_color == "white" else chess.WHITE
    book = BOT_INSTANCES[payload.bot_id].opening_book
    try:
        await bot_memory.record_book(db, payload.bot_id, book, payload.moves_uci, bot_color, result)
        # Память о сопернике (32.2): по завершённой партии без помощи — как игрок играет на самом деле.
        if not payload.assisted and payload.moves_uci:
            await bot_memory.record_rival(db, payload.bot_id, player_id, book, payload.moves_uci, bot_color, result)
        if not payload.assisted and not payload.blindfold and payload.moves_uci:
            await bot_memory.record_rating(
                db, payload.bot_id, int(str(BOT_METADATA[payload.bot_id]["rating"])), player_rating,
                bot_memory.bot_points(result, bot_color))
    except Exception as exc:  # память — не главное: партия уже в архиве
        await db.rollback()
        logger.warning("Bot memory update failed for %s: %s", payload.bot_id, exc)


@router.post("/save-game", response_model=BotGameSaveResponse)
async def save_bot_game(
        payload: BotGameSaveRequest,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """
    Сохраняет завершённую партию против исторического бота или персоналии из мастерской. Только для вошедших.

    Что делает: переигрывает присланные ходы и сам определяет итог (resolve_bot_game_outcome), пишет партию в
    games (без рейтинга, кроме турнирной), для партии лестницы обновляет рейтинг и ступень лестницы, для партии
    турнира — записывает результат в турнир, меняет рейтинг игрока и ставит в очередь открывшиеся партии ботов, обновляет
    память исторического бота и ставит фоновый разбор. Партия лестницы или турнира должна совпадать с открытой
    на сервере (соперник, цвет, контроль) — иначе 409; подсказка или возврат хода в турнирной партии дают
    поражение, а не результат с доски.
    """
    if payload.blindfold and (payload.ladder or payload.tournament_game_id):
        # Игра вслепую — тренировка: в лестнице и турнире её нет (таск 19.5).
        raise ApiError(400, "blindfold_not_allowed")
    if payload.bot_id != CUSTOM_BOT_ID and payload.bot_id not in BOT_METADATA:
        raise ApiError(404, "bot_not_found", bot_id=payload.bot_id)
    personality_name, personality_elo = await _resolve_personality_for_save(db, current_user, payload)
    ladder_game = await _ladder_game_for_save(current_user, payload) if payload.ladder else None
    tournament_game = await _tournament_game_for_save(db, current_user, payload) if payload.tournament_game_id else None

    if payload.player_color not in ("white", "black"):
        raise ApiError(400, "invalid_player_color")

    if payload.result not in ("1-0", "0-1", "1/2-1/2"):
        raise ApiError(400, "invalid_result")

    # Партию без ходов в архив не пишем — кроме засчитываемых (лестница, турнир), сданных или проигранных по
    # времени до первого хода: иначе турнирная партия осталась бы открытой, а тур — незакрытым.
    counted = ladder_game is not None or tournament_game is not None
    if counted and payload.termination == "agreement":
        # Согласие бота на ничью сервер не запоминает — в засчитываемой партии его не подделать.
        raise ApiError(400, "termination_required")
    if not payload.moves_uci and not (counted and payload.termination in ("resignation", "timeout")):
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

    new_game = Game(**game_kwargs, personality_name=personality_name, assisted=payload.assisted,
                    blindfold_level=payload.blindfold, blindfold_peeks=payload.peeks if payload.blindfold else None)
    db.add(new_game)
    ladder_outcome = None
    if ladder_game is not None:
        session, rung_index, rung = ladder_game
        player_score = {"1-0": 1.0, "0-1": 0.0}.get(result, 0.5)
        if payload.player_color == "black" and result != "1/2-1/2":
            player_score = 1.0 - player_score
        ladder_outcome = await ladder_service.apply_result(db, current_user, rung, player_score, session.assisted)
    await product_metrics.record_event(db, current_user.id, product_metrics.GAME_FINISHED)
    await db.commit()
    await db.refresh(new_game)
    if ladder_game is not None:
        await ladder_service.clear_session(current_user.id)
    tournament_forfeit = None
    rating_change = None
    if tournament_game is not None:
        # Подсказка движка, анализ, возврат хода или наставник во время партии турнира — поражение (таск A.2):
        # «незасчитанной» партии в турнире быть не может.
        tournament_session = await ladder_service.get_session(current_user.id, "tournament")
        tournament_forfeit = (
            (tournament_session.assisted if tournament_session else None) or ("coach" if payload.assisted else None)
        )
        tournament_result = tournament_service.loss_for(payload.player_color) if tournament_forfeit else result
        await ladder_service.clear_session(current_user.id, "tournament")
        # Результат — в турнир; партии ботов, которые от него открылись, считает воркер.
        # Все турниры рейтинговые (решение владельца): рейтинг игрока — по итогу партии в турнире.
        rating_change = tournament_service.apply_rating(current_user, tournament_game, tournament_result)
        new_game.is_rated = True
        if tournament_game.color == "white":
            new_game.white_initial_rating, new_game.white_rating_delta = rating_change.before, rating_change.delta
        else:
            new_game.black_initial_rating, new_game.black_rating_delta = rating_change.before, rating_change.delta
        await tournament_service.record_result(
            db, tournament_game.tournament, tournament_game.game, tournament_result, new_game.id,
        )
        await db.refresh(tournament_game.tournament)
        schedule_tournament_simulations_in_background(
            await tournament_service.mark_for_queue(db, tournament_game.tournament)
        )
    # Опыт бота (таск 32.1): дебютные варианты — по любой партии из начальной позиции; рейтинг — без помощи,
    # игры вслепую и своей позиции. Сбой памяти партию не ломает: она уже сохранена.
    if payload.bot_id in BOT_INSTANCES and not personality_name and start_fen is None:
        await _remember_bot_game(db, payload, result,
                                 rating_change.before if rating_change else current_user.rating_for(category),
                                 current_user.id)
    # Фоновый разбор: итог партии готов заранее, а из ошибок игрока делаются личные задачи (таск 13.5).
    schedule_game_analysis_in_background(new_game.id)

    return BotGameSaveResponse(
        game_id=new_game.id,
        status="finished",
        result=result,
        ladder=ladder_outcome,
        tournament_id=tournament_game.tournament.id if tournament_game else None,
        tournament_forfeit=tournament_forfeit,
        rating_before=rating_change.before if rating_change else None,
        rating_after=rating_change.after if rating_change else None,
        rating_delta=rating_change.delta if rating_change else None,
    )
