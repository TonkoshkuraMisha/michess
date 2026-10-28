# --- FILE: src/api/bots.py ---

from datetime import datetime, timezone
import chess
import chess.pgn
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api import deps
from src.db import session as db_session
from src.models.game import Game
from src.models.user import User
from src.services.bots.labourdonnais import labourdonnais_bot
from src.services.bots.philidor import philidor_bot

router = APIRouter()

get_db = getattr(deps, "get_db", None) or getattr(db_session, "get_db", None)
get_current_user = getattr(deps, "get_current_user", None)

AVAILABLE_BOTS = [
    {
        "id": "philidor",
        "name": "Ф.-А. Филидор",
        "full_name": "Франсуа-Андре Филидор",
        "era": "1749–1795",
        "title": "Мастер Просвещения",
        "rating": 1850,
        "motto": "Пешки — душа шахмат: именно они определяют атаку и защиту.",
        "avatar": "/champions/philidor.jpg",
    },
    {
        "id": "labourdonnais",
        "name": "Л.-Ш. Лабурдонне",
        "full_name": "Луи-Шарль Лабурдонне",
        "era": "1795–1840",
        "title": "Король Комбинаций",
        "rating": 1950,
        "motto": "Инициатива, гамбит и стремительная атака на короля!",
        "avatar": "/champions/labourdonnais.jpg",
    },
]

BOT_INSTANCES = {
    "philidor": philidor_bot,
    "labourdonnais": labourdonnais_bot,
}

BOT_METADATA = {b["id"]: b for b in AVAILABLE_BOTS}


class BotMoveRequest(BaseModel):
    bot_id: str = Field(default="philidor", description="ID исторического бота")
    fen: str = Field(..., description="Текущая позиция на доске в формате FEN")


class BotMoveResponse(BaseModel):
    bot_id: str
    uci: str
    san: str
    fen_after: str
    source: str
    comment: str


class BotGameSaveRequest(BaseModel):
    bot_id: str = Field(..., description="ID исторического бота ('philidor' или 'labourdonnais')")
    player_color: str = Field(..., description="Цвет игрока ('white' или 'black')")
    result: str = Field(..., description="Результат партии ('1-0', '0-1', '1/2-1/2')")
    moves_uci: list[str] = Field(default_factory=list, description="Список сделанных ходов в формате UCI")
    base_time_ms: int = Field(default=180000, description="Базовый контроль времени в мс")
    increment_ms: int = Field(default=0, description="Добавление времени на ход в мс")


class BotGameSaveResponse(BaseModel):
    game_id: int
    status: str
    result: str


def _detect_eco_code(moves_uci: list[str]) -> str:
    """Определяет базовый код дебюта ECO по первым ходам партии."""
    prefix = " ".join(moves_uci[:6])
    if prefix.startswith("e2e4 e7e5 g1f3 d7d6"):
        return "C41"
    if prefix.startswith("e2e4 e7e5 f2f4"):
        return "C30"
    if prefix.startswith("e2e4 e7e5 f1c4"):
        return "C23"
    if prefix.startswith("e2e4 e7e5 g1f3 b8c6 f1c4"):
        return "C50"
    if prefix.startswith("e2e4 c7c5"):
        return "B20"
    if prefix.startswith("e2e4 e7e6"):
        return "C00"
    if prefix.startswith("d2d4 d7d5 c2c4"):
        return "D06"
    if prefix.startswith("d2d4"):
        return "D00"
    if prefix.startswith("e2e4"):
        return "B00"
    return "A00"


def _build_pgn_string(
        moves_uci: list[str],
        white_name: str,
        white_elo: int,
        black_name: str,
        black_elo: int,
        result: str,
) -> tuple[str, str]:
    """Строит валидный PGN-документ с заголовками и возвращает (pgn_text, final_fen)."""
    board = chess.Board()
    pgn_game = chess.pgn.Game()
    pgn_game.headers["Event"] = "Historical Bot Match"
    pgn_game.headers["Site"] = "Michess Bot Arena"
    pgn_game.headers["Date"] = datetime.now(timezone.utc).strftime("%Y.%m.%d")
    pgn_game.headers["Round"] = "-"
    pgn_game.headers["White"] = white_name
    pgn_game.headers["Black"] = black_name
    pgn_game.headers["Result"] = result
    pgn_game.headers["WhiteElo"] = str(white_elo)
    pgn_game.headers["BlackElo"] = str(black_elo)
    pgn_game.headers["ECO"] = _detect_eco_code(moves_uci)

    node = pgn_game
    for uci_str in moves_uci:
        move = chess.Move.from_uci(uci_str)
        if move not in board.legal_moves:
            raise ValueError(f"Нелегальный ход в истории: {uci_str}")
        board.push(move)
        node = node.add_variation(move)

    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    return pgn_game.accept(exporter).strip(), board.fen()


async def _get_or_create_bot_user(db: AsyncSession, bot_id: str) -> User:
    """Находит или создаёт запись исторического бота в таблице пользователей."""
    meta = BOT_METADATA[bot_id]
    bot_username = meta["name"]

    stmt = select(User).where(User.username == bot_username)
    res = await db.execute(stmt)
    bot_user = res.scalar_one_or_none()
    if bot_user is not None:
        return bot_user

    user_cols = {c.name for c in User.__table__.columns}
    user_kwargs: dict = {
        "username": bot_username,
        "rating": meta["rating"],
    }
    if "hashed_password" in user_cols:
        user_kwargs["hashed_password"] = "!historical_bot_no_login!"
    elif "password_hash" in user_cols:
        user_kwargs["password_hash"] = "!historical_bot_no_login!"
    if "email" in user_cols:
        user_kwargs["email"] = f"{bot_id}@michess.local"
    if "is_cheater" in user_cols:
        user_kwargs["is_cheater"] = False
    if "trust_factor" in user_cols:
        user_kwargs["trust_factor"] = 100

    bot_user = User(**user_kwargs)
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
    """Формирует словарь полей модели Game в соответствии со схемой БД."""
    game_cols = {c.name: c for c in Game.__table__.columns}
    kwargs: dict = {
        "white_id": white_id,
        "black_id": black_id,
    }

    if "pgn" in game_cols:
        kwargs["pgn"] = pgn_text
    if "fen" in game_cols:
        kwargs["fen"] = final_fen
    if "current_fen" in game_cols:
        kwargs["current_fen"] = final_fen
    if "result" in game_cols:
        kwargs["result"] = payload.result
    if "is_rated" in game_cols:
        kwargs["is_rated"] = False
    if "base_time_ms" in game_cols:
        kwargs["base_time_ms"] = payload.base_time_ms
    if "increment_ms" in game_cols:
        kwargs["increment_ms"] = payload.increment_ms

    if "status" in game_cols:
        col_type = game_cols["status"].type
        enums = getattr(col_type, "enums", None)
        if enums and "FINISHED" in enums:
            kwargs["status"] = "FINISHED"
        else:
            kwargs["status"] = "finished"

    if "finished_at" in game_cols:
        is_tz = getattr(game_cols["finished_at"].type, "timezone", False)
        now_utc = datetime.now(timezone.utc)
        kwargs["finished_at"] = now_utc if is_tz else now_utc.replace(tzinfo=None)

    return kwargs


@router.get("/list")
async def get_available_bots():
    """Возвращает список доступных исторических ботов."""
    return {"bots": AVAILABLE_BOTS}


@router.post("/move", response_model=BotMoveResponse)
async def get_bot_move(payload: BotMoveRequest):
    """Принимает FEN позиции и возвращает ответный ход выбранного исторического бота."""
    bot = BOT_INSTANCES.get(payload.bot_id)
    if bot is None:
        raise HTTPException(status_code=404, detail=f"Бот '{payload.bot_id}' не найден")

    try:
        board = chess.Board(payload.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректный формат FEN")

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="Партия уже завершена")

    result = bot.choose_move(payload.fen)
    return BotMoveResponse(
        bot_id=payload.bot_id,
        uci=result["uci"],
        san=result["san"],
        fen_after=result["fen_after"],
        source=result["source"],
        comment=result["comment"],
    )


@router.post("/save-game", response_model=BotGameSaveResponse)
async def save_bot_game(
        payload: BotGameSaveRequest,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """Сохраняет завершённую партию против исторического бота в базу данных."""
    if payload.bot_id not in BOT_METADATA:
        raise HTTPException(status_code=404, detail=f"Бот '{payload.bot_id}' не найден")

    if payload.player_color not in ("white", "black"):
        raise HTTPException(status_code=400, detail="Некорректный цвет игрока")

    if payload.result not in ("1-0", "0-1", "1/2-1/2"):
        raise HTTPException(status_code=400, detail="Некорректный результат партии")

    if not payload.moves_uci:
        raise HTTPException(status_code=400, detail="Список ходов пуст")

    bot_user = await _get_or_create_bot_user(db, payload.bot_id)

    if payload.player_color == "white":
        white_user, black_user = current_user, bot_user
    else:
        white_user, black_user = bot_user, current_user

    try:
        pgn_text, final_fen = _build_pgn_string(
            moves_uci=payload.moves_uci,
            white_name=white_user.username,
            white_elo=white_user.rating,
            black_name=black_user.username,
            black_elo=black_user.rating,
            result=payload.result,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    game_kwargs = _prepare_game_kwargs(
        white_id=white_user.id,
        black_id=black_user.id,
        pgn_text=pgn_text,
        final_fen=final_fen,
        payload=payload,
    )

    new_game = Game(**game_kwargs)
    db.add(new_game)
    await db.commit()
    await db.refresh(new_game)

    return BotGameSaveResponse(
        game_id=new_game.id,
        status="finished",
        result=payload.result,
    )
