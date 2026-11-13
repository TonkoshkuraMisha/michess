# --- FILE: src/api/analysis.py ---

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.fair_play import forbid_engine_help_during_game, optional_user_id
from src.api.ladder import note_ladder_analysis
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError, DomainValueError
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
from src.services import move_check
from src.services.analysis_service import (
    GameDataNotFoundError,
    GameNotFinishedError,
    analysis_service,
    ensure_game_finished,
    is_current_analysis,
)
from src.services.engine_pool import EngineBusyError
from src.services.game_engine import InvalidStartPositionError

router = APIRouter(prefix="/analysis", tags=["Game Analysis"])

# game_id -> [lock, число запросов, ожидающих или держащих лок]. Запись удаляется, когда
# счётчик падает до нуля, поэтому словарь не растёт с каждой когда-либо анализированной партией.
_ANALYSIS_LOCKS: dict[int, list] = {}


@asynccontextmanager
async def _game_analysis_lock(game_id: int):
    entry = _ANALYSIS_LOCKS.setdefault(game_id, [asyncio.Lock(), 0])
    entry[1] += 1
    try:
        async with entry[0]:
            yield
    finally:
        entry[1] -= 1
        if entry[1] == 0:
            _ANALYSIS_LOCKS.pop(game_id, None)


def _engine_busy() -> HTTPException:
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
    Возвращает оценку позиции Stockfish для заданного массива ходов.
    Недоступно, пока у запрашивающего идёт рейтинговая партия (см. src/api/fair_play.py).
    """
    try:
        return await analysis_service.analyze_position(db, request.moves, request.start_fen)
    except InvalidStartPositionError as exc:
        raise exc.to_http(400) from exc
    except EngineBusyError:
        raise _engine_busy() from None


@router.post(
    "/advice",
    response_model=AdviceResponse,
    dependencies=[
        Depends(rate_limit("analysis_advice", "RATE_LIMIT_ADVICE", "RATE_LIMIT_ADVICE_GUEST")),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def get_position_advice(request: AdviceRequest):
    """
    Совет наставника по позиции (таск 11.2): угроза соперника, своя возможность, идея лучшего хода и стрелки.
    Это подсказка движка: недоступна во время партии с человеком, в партии лестницы делает её незасчитанной.
    Текст собирает клиент по ключам каталога coach.
    """
    try:
        return await analysis_service.advise(request.fen)
    except DomainValueError as exc:
        raise exc.to_http(400) from exc
    except EngineBusyError:
        raise _engine_busy() from None


@router.post(
    "/hint",
    response_model=HintResponse,
    dependencies=[
        Depends(rate_limit("analysis_hint", "RATE_LIMIT_ADVICE", "RATE_LIMIT_ADVICE_GUEST")),
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def graded_hint(request: HintRequest):
    """
    Подсказка по ступеням (таск 11.4): 1 — намёк словами, 2 — какой фигурой ходить, 3 — ход со стрелкой и
    объяснением. Ход раскрывается только на последней ступени. Правила честной игры — как у совета.
    """
    try:
        return await analysis_service.hint(request.fen, request.step)
    except DomainValueError as exc:
        raise exc.to_http(400) from exc
    except EngineBusyError:
        raise _engine_busy() from None


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
        Depends(forbid_engine_help_during_game),
        Depends(note_ladder_analysis),
    ],
)
async def check_player_move(request: MoveCheckRequest):
    """
    Игра с наставником (таск 11.3): оценка хода игрока — потеря, классификация, лучший ход, ответ соперника,
    пропущенный удар и объяснение наставника. Это подсказка движка: недоступна в партии с человеком, в партии
    лестницы делает её незасчитанной.
    """
    try:
        return await analysis_service.check_move(request.fen, request.move)
    except DomainValueError as exc:
        raise exc.to_http(400) from exc
    except EngineBusyError:
        raise _engine_busy() from None


@router.get("/game/{game_id}", response_model=FullGameAnalysisResponse | None)
async def get_cached_game_analysis(
        game_id: int,
        db: AsyncSession = Depends(get_db),
):
    """Возвращает уже сохранённый компьютерный анализ завершённой партии из БД, если он есть."""
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
    return data


@router.post(
    "/game/{game_id}",
    response_model=FullGameAnalysisResponse,
    dependencies=[Depends(rate_limit("analysis_game", "RATE_LIMIT_GAME_ANALYSIS"))],
)
async def analyze_full_game_endpoint(
        game_id: int,
        force: bool = Query(default=False, description="Принудительно пересчитать анализ"),
        db: AsyncSession = Depends(get_db),
):
    """
    Выполняет полный разбор завершённой партии с расчётом точности и классификацией зевков.
    Идущие партии не анализируются (409). Параллельные запросы на одну партию сериализуются,
    чтобы не занимать несколько движков пула одной и той же работой.
    """
    async with _game_analysis_lock(game_id):
        try:
            return await analysis_service.analyze_full_game(db, game_id, force=force)
        except GameDataNotFoundError as exc:
            raise exc.to_http(404) from exc
        except GameNotFinishedError as exc:
            raise exc.to_http(status.HTTP_409_CONFLICT) from exc
        except EngineBusyError:
            raise _engine_busy() from None
        except DomainValueError as exc:
            raise exc.to_http(400) from exc
