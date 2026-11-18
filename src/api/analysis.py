# --- FILE: src/api/analysis.py ---
"""
Движок и наставник по запросу (/analysis): оценка позиции, эндшпильные таблицы, «найти мат», справочник дебютов,
совет, подсказка по ступеням, проверка хода в игре с наставником, полный разбор партии.

Всё, что работает с произвольной позицией, — помощь в партии, поэтому эти эндпоинты (/position, /tablebase,
/find-mate, /opening-explorer, /advice, /hint, /check-move) закрыты правилом честной игры
(src/api/fair_play.forbid_engine_help_during_game): во время своей партии с человеком игрок получает отказ, а
запрос во время партии лестницы или турнира отмечается в её сессии (note_ladder_analysis) — партия лестницы не
засчитывается, партия турнира считается проигранной. Разбор партии по id (/game/{id}) этой зависимостью не закрыт:
его защищает другое правило — разбирается только законченная партия, идущая даёт 409. «Не согласен» (/dispute)
движок не вызывает.

Нагрузка ограничена: у каждого эндпоинта свой лимит запросов в минуту (настройки RATE_LIMIT_*, гостям — меньше),
при занятом пуле движков — ответ 503 engine_busy, одну партию одновременно разбирает один запрос
(_game_analysis_lock — в пределах одного процесса API). При FREE_TIER_LIMITS действуют дневные квоты на разбор
партий и на наставника. Все эндпоинты доступны и без входа.

Расчёты — src/services/analysis_service.py, move_check.py, coach.py, tablebase.py, mate_finder.py,
opening_explorer.py; формат ответов — src/schemas/analysis.py. Готовый разбор хранится в games.analysis_json.
"""

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.fair_play import forbid_engine_help_during_game, optional_user_id
from src.api.ladder import note_ladder_analysis
from src.api.rate_limit import DailyQuota, rate_limit
from src.core.errors import ApiError, DomainError, DomainValueError
from src.db.session import get_db
from src.models.game import Game
from src.schemas.analysis import (
    AdviceRequest,
    AdviceResponse,
    DisputeRequest,
    FullGameAnalysisResponse,
    HintRequest,
    HintResponse,
    MoveCheckRequest,
    MoveCheckResponse,
    PositionAnalysisRequest,
)
from src.services import mate_finder, move_check, opening_explorer, tablebase
from src.services.analysis_service import (
    GameDataNotFoundError,
    GameNotFinishedError,
    analysis_service,
    ensure_game_finished,
    is_current_analysis,
)
from src.services.engine_pool import EngineBusyError, EngineUnavailableError, engine_work
from src.services.game_engine import InvalidStartPositionError, board_from_start_fen
from src.services.game_summary import summarize

router = APIRouter(prefix="/analysis", tags=["Game Analysis"])


class TablebaseRequest(BaseModel):
    fen: str = Field(..., max_length=120)


class FindMateRequest(BaseModel):
    fen: str = Field(..., max_length=120)
    moves: int = Field(3, ge=1, le=mate_finder.MAX_MOVES, description="Искать мат не длиннее стольких ходов")


class OpeningExplorerRequest(BaseModel):
    moves: list[str] = Field(default_factory=list, max_length=opening_explorer.MAX_MOVES,
                             description="Ходы из начальной позиции в UCI")

# game_id -> [lock, число запросов, ожидающих или держащих лок]. Запись удаляется, когда
# счётчик падает до нуля, поэтому словарь не растёт с каждой когда-либо анализированной партией.
_ANALYSIS_LOCKS: dict[int | str, list] = {}


@asynccontextmanager
async def _game_analysis_lock(game_id: int | str):
    """
    Замок на разбор одной партии: второй запрос на ту же партию ждёт первый и (без force) получает уже готовый
    разбор из базы, а не занимает второй движок. Замок живёт в памяти процесса — между процессами uvicorn он не
    действует.
    Ключ — id партии или строка «imported:<id>» для импортированной (src/api/game_import.py).
    """
    entry = _ANALYSIS_LOCKS.setdefault(game_id, [asyncio.Lock(), 0])
    entry[1] += 1
    try:
        async with entry[0]:
            yield
    finally:
        entry[1] -= 1
        if entry[1] == 0:
            _ANALYSIS_LOCKS.pop(game_id, None)


# Дневные квоты бесплатного тарифа (таск 23.3): выключены, пока не включён FREE_TIER_LIMITS.
GAME_ANALYSIS_QUOTA = DailyQuota("game_analysis", "FREE_GAME_ANALYSES_PER_DAY")
COACH_QUOTA = DailyQuota("coach", "FREE_COACH_REQUESTS_PER_DAY")


def _engine_busy() -> HTTPException:
    """503 engine_busy: все движки пула заняты; заголовок Retry-After советует повторить через 5 секунд."""
    return ApiError(status.HTTP_503_SERVICE_UNAVAILABLE, "engine_busy", headers={"Retry-After": "5"})


@router.post(
    "/position",
    dependencies=[
        Depends(rate_limit(
            "analysis_position", "RATE_LIMIT_POSITION_ANALYSIS", "RATE_LIMIT_POSITION_ANALYSIS_GUEST",
        )),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def analyze_game_position(
        request: PositionAnalysisRequest,
        db: AsyncSession = Depends(get_db),
):
    """
    Возвращает оценку позиции Stockfish для заданного массива ходов (от обычной расстановки или от start_fen).
    Недоступно, пока у запрашивающего идёт партия с человеком — рейтинговая или товарищеская
    (см. src/api/fair_play.py). Доступно и без входа — гостю с меньшим лимитом запросов.
    """
    try:
        with engine_work("analysis"):
            return await analysis_service.analyze_position(db, request.moves, request.start_fen)
    except InvalidStartPositionError as exc:
        raise exc.to_http(400) from exc
    except EngineBusyError:
        raise _engine_busy() from None


@router.post(
    "/tablebase",
    dependencies=[
        Depends(rate_limit(
            "tablebase", "RATE_LIMIT_POSITION_ANALYSIS", "RATE_LIMIT_POSITION_ANALYSIS_GUEST",
        )),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def probe_tablebase(request: TablebaseRequest):
    """
    Эндшпильный тренажёр (таск 14.4): результат позиции по таблицам и лучший ход стороны, которая ходит (им отвечает
    «идеальный защитник»). Это точная оценка — под правилом честной игры, как анализ.
    """
    try:
        board = board_from_start_fen(request.fen)
        return await tablebase.probe(board)
    except InvalidStartPositionError as exc:
        raise exc.to_http(400) from exc
    except DomainError as exc:
        raise exc.to_http(503 if exc.code == "tablebase_unavailable" else 400) from exc


@router.post(
    "/find-mate",
    dependencies=[
        Depends(rate_limit(
            "find_mate", "RATE_LIMIT_POSITION_ANALYSIS", "RATE_LIMIT_POSITION_ANALYSIS_GUEST",
        )),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def find_mate(request: FindMateRequest):
    """«Найти мат» (таск 16.4): мат не длиннее moves ходов и его линия; это движок — под правилом честной игры."""
    try:
        with engine_work("analysis"):
            return await mate_finder.find_mate(request.fen, request.moves)
    except InvalidStartPositionError as exc:
        raise exc.to_http(400) from exc
    except (EngineBusyError, EngineUnavailableError):
        raise _engine_busy() from None


@router.post(
    "/opening-explorer",
    dependencies=[
        Depends(rate_limit(
            "opening_explorer", "RATE_LIMIT_POSITION_ANALYSIS", "RATE_LIMIT_POSITION_ANALYSIS_GUEST",
        )),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def explore_opening(request: OpeningExplorerRequest, db: AsyncSession = Depends(get_db)):
    """
    Справочник дебютов (таск 16.2): ходы из позиции со статистикой партий, название дебюта и партии мастеров.
    Это помощь в партии — под правилом честной игры, как анализ.
    """
    try:
        return await opening_explorer.explore(db, request.moves)
    except DomainValueError as exc:
        raise exc.to_http(400) from exc


@router.post(
    "/advice",
    response_model=AdviceResponse,
    dependencies=[
        Depends(rate_limit("analysis_advice", "RATE_LIMIT_ADVICE", "RATE_LIMIT_ADVICE_GUEST")),
        Depends(COACH_QUOTA.check),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def get_position_advice(request: AdviceRequest, http: Request):
    """
    Совет наставника по позиции (таск 11.2): угроза соперника, своя возможность, идея лучшего хода и стрелки.
    Это подсказка движка: недоступна во время партии с человеком, в партии лестницы делает её незасчитанной.
    Текст собирает клиент по ключам каталога coach.
    """
    try:
        with engine_work("coach"):
            advice = await analysis_service.advise(request.fen)
    except DomainValueError as exc:
        raise exc.to_http(400) from exc
    except EngineBusyError:
        raise _engine_busy() from None
    await COACH_QUOTA.record(http)
    return advice


@router.post(
    "/hint",
    response_model=HintResponse,
    dependencies=[
        Depends(rate_limit("analysis_hint", "RATE_LIMIT_ADVICE", "RATE_LIMIT_ADVICE_GUEST")),
        Depends(COACH_QUOTA.check),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def graded_hint(request: HintRequest, http: Request):
    """
    Подсказка по ступеням (таск 11.4): 1 — намёк словами, 2 — какой фигурой ходить, 3 — ход со стрелкой и
    объяснением. Ход раскрывается только на последней ступени. Правила честной игры — как у совета.
    """
    try:
        with engine_work("coach"):
            hint = await analysis_service.hint(request.fen, request.step)
    except DomainValueError as exc:
        raise exc.to_http(400) from exc
    except EngineBusyError:
        raise _engine_busy() from None
    await COACH_QUOTA.record(http)
    return hint


@router.post(
    "/dispute",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(rate_limit("analysis_dispute", "RATE_LIMIT_ADVICE", "RATE_LIMIT_ADVICE_GUEST"))],
)
async def dispute_coach_warning(payload: DisputeRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """«Не согласен» с предупреждением наставника: позиция уходит в очередь спорных оценок для проверки."""
    try:
        await move_check.record_dispute(payload.fen, payload.move, payload.cp_loss, await optional_user_id(request, db))
    except DomainValueError as exc:
        raise exc.to_http(400) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/check-move",
    response_model=MoveCheckResponse,
    response_model_exclude_none=True,
    dependencies=[
        Depends(rate_limit("analysis_check_move", "RATE_LIMIT_MOVE_CHECK", "RATE_LIMIT_MOVE_CHECK_GUEST")),
        Depends(COACH_QUOTA.check),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def check_player_move(request: MoveCheckRequest, http: Request):
    """
    Игра с наставником (таск 11.3): оценка хода игрока — потеря, классификация, лучший ход, ответ соперника,
    пропущенный удар и объяснение наставника. Это подсказка движка: недоступна в партии с человеком, в партии
    лестницы делает её незасчитанной.
    """
    try:
        with engine_work("coach"):
            checked = await analysis_service.check_move(request.fen, request.move)
    except DomainValueError as exc:
        raise exc.to_http(400) from exc
    except EngineBusyError:
        raise _engine_busy() from None
    await COACH_QUOTA.record(http)
    return checked


@router.get("/game/{game_id}", response_model=FullGameAnalysisResponse | None)
async def get_cached_game_analysis(
        game_id: int,
        db: AsyncSession = Depends(get_db),
):
    """
    Возвращает уже сохранённый компьютерный анализ завершённой партии из БД (games.analysis_json), если он есть;
    движок не вызывается. null — разбора ещё нет или он устарел (другая версия формата либо не совпадает с записью
    партии). Идущая партия — 409. Доступно без входа; итог партии (summary) досчитывается при ответе.
    """
    game = await db.get(Game, game_id)
    if not game:
        raise ApiError(404, "game_not_found", game_id=game_id)
    try:
        ensure_game_finished(game)
    except GameNotFinishedError as exc:
        raise exc.to_http(status.HTTP_409_CONFLICT) from exc
    if not game.analysis_json:
        return None
    try:
        data = json.loads(game.analysis_json)
    except ValueError:
        return None
    # Разбор старого формата (без комментариев наставника) не отдаём: клиент предложит пересчитать.
    if not game.pgn or not is_current_analysis(data, game.pgn):
        return None
    data["game_id"] = game_id
    data["summary"] = summarize(data.get("moves", []), game.result)
    return data


@router.post(
    "/game/{game_id}",
    response_model=FullGameAnalysisResponse,
    dependencies=[Depends(rate_limit("analysis_game", "RATE_LIMIT_GAME_ANALYSIS")), Depends(GAME_ANALYSIS_QUOTA.check)],
)
async def analyze_full_game_endpoint(
        game_id: int,
        http: Request,
        force: bool = Query(default=False, description="Принудительно пересчитать анализ"),
        db: AsyncSession = Depends(get_db),
):
    """
    Выполняет полный разбор завершённой партии с расчётом точности и классификацией зевков.
    Идущие партии не анализируются (409). Параллельные запросы на одну партию сериализуются,
    чтобы не занимать несколько движков пула одной и той же работой.
    Готовый разбор берётся из games.analysis_json, пересчёт — при force=true или устаревшем формате; результат
    сохраняется туда же. Лимит — RATE_LIMIT_GAME_ANALYSIS в минуту (общий для игроков и гостей), при
    FREE_TIER_LIMITS — ещё и дневная квота, в которую засчитывается только выполненный запрос.
    """
    async with _game_analysis_lock(game_id):
        try:
            with engine_work("analysis"):
                report = await analysis_service.analyze_full_game(db, game_id, force=force)
        except GameDataNotFoundError as exc:
            raise exc.to_http(404) from exc
        except GameNotFinishedError as exc:
            raise exc.to_http(status.HTTP_409_CONFLICT) from exc
        except EngineBusyError:
            raise _engine_busy() from None
        except DomainValueError as exc:
            raise exc.to_http(400) from exc
    await GAME_ANALYSIS_QUOTA.record(http)
    game = await db.get(Game, game_id)
    return {**report, "summary": summarize(report.get("moves", []), game.result if game else None)}
