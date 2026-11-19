# --- FILE: src/services/guess.py ---
"""
«Угадай ход мастера» (таск 14.3): выдача отобранных позиций и оценка ответа.

Баллы: ход мастера — 100; другой ход не хуже лучшего на NEAR_CP — 80; хуже — по потере: 80 − (потеря − NEAR_CP) / 5,
не меньше нуля. Оценка — по сохранённым строкам движка (до трёх лучших ходов), без запуска движка: ход вне этих строк
не лучше второй строки (отбор гарантирует её отставание), поэтому его потеря — отрыв лучшего хода плюс запас.

Режим «выбор из кандидатов» (для начинающих): игрок выбирает ход из CANDIDATES вариантов — ход мастера и другие ходы
из сохранённых строк движка. По правилу отбора каждый из них заметно хуже хода мастера (отрыв gap_cp), так что
задание остаётся решаемым расчётом; порядок вариантов перемешан, но у одной позиции всегда один и тот же.

Сложность позиции — её рейтинг: ответ вошедшего игрока меняет его, как партия задачи с решающим (Эло против рейтинга
задач игрока): нашёл ход мастера — позиция «проиграла», нет — «выиграла». Рейтинг игрока при этом не меняется.

Откуда данные: позиции — таблица guess_positions (ход мастера, строки движка lines, отрыв gap_cp, темы, серия,
счётчики plays и solved); её заполняет офлайн scripts/build_guess_positions.py по партиям архива (таблица games) по
правилам src/services/guess_selection.py. Сервер движок для этого раздела не запускает. Объяснение к ходу мастера —
src/services/coach.py. Легальность хода игрока проверяет маршрут (src/api/guess.py).
"""

import io
import random

import chess
import chess.pgn
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game
from src.models.guess import GuessPosition
from src.models.user import User
from src.services.coach import advice_for_position
from src.services.guess_selection import book_plies, in_opening, is_technical_endgame, position_themes

# Баллы за ход мастера и за другой ход, который хуже лучшего не больше чем на NEAR_CP сантипешек.
MASTER_SCORE = 100
NEAR_SCORE = 80
NEAR_CP = 30
# Запас к потере хода, которого нет в сохранённых строках движка: потеря = отрыв лучшего хода + этот запас.
UNKNOWN_EXTRA_CP = 50
# Сколько последних полуходов партии показывается перед позицией.
CONTEXT_MOVES = 8
# Сколько вариантов показывает режим «выбор из кандидатов»: ход мастера и до двух ходов из строк движка.
CANDIDATES = 3
# Позиция подбирается в пределах ±DIFFICULTY_BAND от запрошенной сложности.
DIFFICULTY_BAND = 300
# Рейтинг позиции: первые PROVISIONAL_PLAYS ответов он меняется с коэффициентом K_PROVISIONAL, дальше — K_STABLE;
# из границ MIN_DIFFICULTY…MAX_DIFFICULTY не выходит.
PROVISIONAL_PLAYS = 20
K_PROVISIONAL, K_STABLE = 32, 12
MIN_DIFFICULTY, MAX_DIFFICULTY = 600, 3000


def score_answer(position: GuessPosition, move_uci: str) -> tuple[int, int]:
    """
    (баллы, потеря в сп) за ответ игрока. Потеря хода из сохранённых строк движка — разница с лучшей оценкой; хода
    вне строк — gap_cp + UNKNOWN_EXTRA_CP. Баллы за потерю больше NEAR_CP: минус балл за каждые 5 сантипешек.
    """
    if move_uci == position.move_uci:
        return MASTER_SCORE, 0
    known = {uci: cp for uci, cp in position.lines}
    loss = position.best_cp - known[move_uci] if move_uci in known else position.gap_cp + UNKNOWN_EXTRA_CP
    loss = max(0, loss)
    if loss <= NEAR_CP:
        return NEAR_SCORE, loss
    return max(0, NEAR_SCORE - (loss - NEAR_CP) // 5), loss


def _game_context(game: Game, ply: int) -> dict:
    """Игроки, событие и ходы партии перед позицией (для подписи и ленты ходов)."""
    parsed = chess.pgn.read_game(io.StringIO(game.pgn or ""))
    if parsed is None:
        return {"white": "?", "black": "?", "event": None, "date": None, "previous": [], "last_move": None}
    board = parsed.board()
    sans: list[str] = []
    last_move = None
    for index, move in enumerate(parsed.mainline_moves()):
        if index >= ply:
            break
        sans.append(board.san(move))
        board.push(move)
        last_move = move.uci()
    headers = parsed.headers
    return {
        "white": headers.get("White", "?"), "black": headers.get("Black", "?"),
        "event": headers.get("Event") if headers.get("Event", "?") != "?" else None,
        "date": (headers.get("Date") or "")[:4] or None,
        "previous": sans[-CONTEXT_MOVES:], "first_previous_ply": max(0, len(sans) - CONTEXT_MOVES),
        "last_move": last_move,
    }


def candidate_moves(position: GuessPosition) -> list[dict]:
    """
    Варианты режима «выбор из кандидатов»: ход мастера и ходы из строк движка (без повторов), не больше CANDIDATES,
    в перемешанном порядке — одном и том же для позиции (зерно — её id). Ход — UCI и запись SAN.
    """
    moves = [position.move_uci] + [uci for uci, _cp in position.lines if uci != position.move_uci]
    chosen = list(dict.fromkeys(moves))[:CANDIDATES]
    random.Random(position.id).shuffle(chosen)
    board = chess.Board(position.fen)
    return [{"uci": uci, "san": board.san(chess.Move.from_uci(uci))} for uci in chosen]


async def payload(db: AsyncSession, position: GuessPosition, with_candidates: bool = False) -> dict:
    """
    Позиция «Угадай ход мастера» для клиента: доска, чей ход, сложность, место в серии и сведения о партии. Ход
    мастера не отдаётся; with_candidates — добавить варианты на выбор (candidate_moves), только по просьбе клиента.
    """
    game = await db.get(Game, position.game_id)
    series_length = 0
    if position.series_id is not None:
        series_length = (await db.execute(
            select(func.count()).select_from(GuessPosition).where(GuessPosition.series_id == position.series_id)
        )).scalar_one()
    return {
        "id": position.id, "game_id": position.game_id, "ply": position.ply, "fen": position.fen,
        "side": "white" if position.ply % 2 == 0 else "black", "move_number": position.ply // 2 + 1,
        "difficulty": position.difficulty,
        "series_id": position.series_id, "series_index": position.series_index, "series_length": series_length,
        **(_game_context(game, position.ply) if game else {}),
        **({"candidates": candidate_moves(position)} if with_candidates else {}),
    }


async def pick_position(db: AsyncSession, target: int, series: bool) -> GuessPosition | None:
    """Случайная позиция (или начало серии) около сложности target; если рядом нет — любая."""
    query = select(GuessPosition)
    if series:
        query = query.where(GuessPosition.series_id.is_not(None), GuessPosition.series_index == 0)
    near = query.where(GuessPosition.difficulty.between(target - DIFFICULTY_BAND, target + DIFFICULTY_BAND))
    for candidate_query in (near, query):
        ids = (await db.execute(candidate_query.with_only_columns(GuessPosition.id))).scalars().all()
        if ids:
            return await db.get(GuessPosition, random.choice(ids))
    return None


async def series_next(db: AsyncSession, position: GuessPosition) -> GuessPosition | None:
    """Следующая позиция той же серии (серия — несколько ходов мастера подряд в одной партии) или None."""
    if position.series_id is None:
        return None
    return (await db.execute(select(GuessPosition).where(
        GuessPosition.series_id == position.series_id, GuessPosition.series_index == position.series_index + 1,
    ))).scalar_one_or_none()


async def game_positions(db: AsyncSession, game_id: int) -> list[GuessPosition]:
    """Все отобранные позиции партии по порядку ходов."""
    return list((await db.execute(
        select(GuessPosition).where(GuessPosition.game_id == game_id).order_by(GuessPosition.ply)
    )).scalars())


def rating_after(position_rating: int, solver_rating: int, plays: int, solved: bool) -> int:
    """
    Новый рейтинг позиции после ответа игрока с рейтингом solver_rating (Эло, позиция — «соперник»). plays — сколько
    раз позицию уже решали (от этого зависит коэффициент), solved — найден ли ход мастера.
    """
    k = K_PROVISIONAL if plays < PROVISIONAL_PLAYS else K_STABLE
    expected = 1 / (1 + 10 ** ((solver_rating - position_rating) / 400))  # ожидание «победы» позиции
    value = position_rating + round(k * ((0 if solved else 1) - expected))
    return max(MIN_DIFFICULTY, min(MAX_DIFFICULTY, value))


async def first_positions(db: AsyncSession, game_ids: list[int]) -> dict[int, int]:
    """Партия → первая отобранная позиция (по полуходу): кнопки «Угадай ход» в списке партий мастера."""
    if not game_ids:
        return {}
    rows = await db.execute(
        select(GuessPosition.game_id, GuessPosition.id).where(GuessPosition.game_id.in_(game_ids))
        .order_by(GuessPosition.game_id, GuessPosition.ply)
    )
    result: dict[int, int] = {}
    for game_id, position_id in rows:
        result.setdefault(game_id, position_id)
    return result


async def answer(db: AsyncSession, position: GuessPosition, move_uci: str, user: User | None = None) -> dict:
    """
    Баллы, ход мастера, строки движка, темы и объяснение наставника к ходу мастера. Заодно обновляет счётчики
    позиции (plays, solved) и, если отвечает вошедший игрок, её рейтинг — по его рейтингу задач (с commit). Ответ
    гостя рейтинг позиции не меняет.
    """
    board = chess.Board(position.fen)
    score, loss = score_answer(position, move_uci)
    if user is not None:
        position.difficulty = rating_after(position.difficulty, user.puzzle_rating, position.plays,
                                           score == MASTER_SCORE)
    position.plays += 1
    if score == MASTER_SCORE:
        position.solved += 1
    await db.commit()
    master = chess.Move.from_uci(position.move_uci)
    advice = advice_for_position(board, position.move_uci)
    next_in_series = await series_next(db, position)
    return {
        "score": score, "loss_cp": loss, "master_move": position.move_uci, "master_san": board.san(master),
        "lines": [{"uci": uci, "san": board.san(chess.Move.from_uci(uci)), "cp": cp} for uci, cp in position.lines],
        "comment": advice["comment"], "arrows": advice["arrows"], "themes": position.themes or [],
        "next_id": next_in_series.id if next_in_series else None,
    }


def _boards(pgn: str) -> tuple[list[chess.Board], int]:
    """Позиции партии со стеком ходов (индекс — полуход) и длина книжного дебюта."""
    parsed = chess.pgn.read_game(io.StringIO(pgn))
    if parsed is None:
        return [], 0
    moves = list(parsed.mainline_moves())
    board = parsed.board()
    boards = [board.copy()]
    for move in moves:
        board.push(move)
        boards.append(board.copy())
    return boards, book_plies(moves)


def _renumber_series(positions: list[GuessPosition]) -> None:
    """После удаления части позиций: серии короче двух ходов распускаются, номера внутри серии — подряд."""
    groups: dict[int, list[GuessPosition]] = {}
    for position in positions:
        if position.series_id is not None:
            groups.setdefault(position.series_id, []).append(position)
    for members in groups.values():
        members.sort(key=lambda p: p.ply)
        for index, position in enumerate(members):
            position.series_id = position.series_id if len(members) > 1 else None
            position.series_index = index if len(members) > 1 else 0


async def refilter(db: AsyncSession) -> tuple[int, int]:
    """
    Отобранные по прежним правилам позиции → нынешние: убрать книжный дебют (таблица 16.1) и технический эндшпиль,
    проставить темы там, где их нет (по ходу мастера, без движка). Возвращает (удалено, получили темы).
    """
    removed = tagged = 0
    game_ids = (await db.execute(select(GuessPosition.game_id).distinct())).scalars().all()
    for game_id in game_ids:
        game = await db.get(Game, game_id)
        positions = await game_positions(db, game_id)
        boards, book = _boards(game.pgn or "") if game else ([], 0)
        kept = []
        for position in positions:
            board = boards[position.ply] if position.ply < len(boards) else None
            if board is None or in_opening(board, book) or is_technical_endgame(board):
                await db.delete(position)
                removed += 1
                continue
            if not position.themes:
                position.themes = position_themes(board, chess.Move.from_uci(position.move_uci), [])
                tagged += bool(position.themes)
            kept.append(position)
        _renumber_series(kept)
        await db.commit()
    return removed, tagged
