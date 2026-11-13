# --- FILE: src/services/tournaments.py ---
"""
Ход турнира (таск 15.1): создание с посевом, расписание, запись результата и продвижение — следующие партии
матча на выбывание, следующий круг, итоговые места. Правила — tournament_rules.py.

Результаты сюда приносят: партия игрока (сохранение партии с ботом, таск 15.3) и симуляция партий ботов между
собой (Celery, таск 15.2). Игрок не может прислать результат сам — отдельного эндпоинта для этого нет.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.personality import BotPersonality
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.models.user import User
from src.services import tournament_rules as rules
from src.services.bots.archetypes import ARCHETYPE_PREFIX, ARCHETYPES_BY_KEY
from src.services.bots.calibration import strength_of
from src.services.rating import classify_time_control

Format = Literal["round_robin", "knockout"]
SIZES: dict[str, tuple[int, ...]] = {"round_robin": rules.ROUND_ROBIN_SIZES, "knockout": rules.KNOCKOUT_SIZES}


@dataclass(frozen=True)
class ParticipantSpec:
    """Соперник в турнире: исторический бот (id), архетип (id) или персоналия игрока (id в базе)."""

    kind: Literal["bot", "archetype", "personality"]
    id: str | int


@dataclass
class _Entrant:
    kind: str
    rating: int
    user_id: int | None = None
    bot_key: str | None = None
    personality_name: str | None = None
    config_json: str | None = None
    order: int = 0


def _bot_ratings() -> dict[str, int]:
    from src.api.bots import AVAILABLE_BOTS

    return {str(b["id"]): int(str(b["rating"])) for b in AVAILABLE_BOTS}


async def _entrant(db: AsyncSession, owner: User, spec: ParticipantSpec, order: int) -> _Entrant:
    label = f"{spec.kind}:{spec.id}"
    if spec.kind == "bot":
        declared = _bot_ratings().get(str(spec.id))
        if declared is None:
            raise DomainError("tournament_participant_unknown", participant=label)
        return _Entrant("bot", strength_of(str(spec.id), declared).rating, bot_key=str(spec.id), order=order)
    if spec.kind == "archetype":
        archetype = ARCHETYPES_BY_KEY.get(f"{ARCHETYPE_PREFIX}{spec.id}")
        if archetype is None:
            raise DomainError("tournament_participant_unknown", participant=label)
        rating = strength_of(archetype.key, archetype.config.target_elo).rating
        return _Entrant("archetype", rating, bot_key=archetype.key, order=order)
    personality = await db.get(BotPersonality, int(spec.id)) if str(spec.id).isdigit() else None
    if personality is None or personality.owner_id != owner.id:
        raise DomainError("tournament_participant_unknown", participant=label)
    config = json.loads(personality.config_json)
    return _Entrant(
        "personality", int(config.get("target_elo", 1500)), personality_name=personality.name,
        config_json=personality.config_json, order=order,
    )


async def active_tournament(db: AsyncSession, owner_id: int) -> Tournament | None:
    return (await db.execute(
        select(Tournament).where(Tournament.owner_id == owner_id, Tournament.status == "active").limit(1)
    )).scalar_one_or_none()


async def create_tournament(
        db: AsyncSession,
        owner: User,
        fmt: Format,
        size: int,
        participants: list[ParticipantSpec],
        base_time_ms: int,
        increment_ms: int,
) -> Tournament:
    if size not in SIZES[fmt]:
        raise DomainError("tournament_size_invalid", sizes=", ".join(map(str, SIZES[fmt])))
    if len(participants) != size - 1:
        raise DomainError("tournament_participants_count", expected=size - 1)
    keys = [f"{p.kind}:{p.id}" for p in participants]
    for key in keys:
        if keys.count(key) > 1:
            raise DomainError("tournament_participant_duplicate", participant=key)
    if await active_tournament(db, owner.id) is not None:
        raise DomainError("tournament_active_exists")

    category = classify_time_control(base_time_ms, increment_ms)
    entrants = [_Entrant("user", owner.rating_for(category), user_id=owner.id, order=0)]
    entrants += [await _entrant(db, owner, spec, i + 1) for i, spec in enumerate(participants)]
    # Посев: по рейтингу на старте; при равенстве — в порядке перечисления (игрок первым).
    entrants.sort(key=lambda e: (-e.rating, e.order))

    tournament = Tournament(
        owner_id=owner.id, format=fmt, size=size, status="active",
        base_time_ms=base_time_ms, increment_ms=increment_ms, current_round=1,
    )
    db.add(tournament)
    await db.flush()
    for seat, e in enumerate(entrants, 1):
        db.add(TournamentPlayer(
            tournament_id=tournament.id, seat=seat, kind=e.kind, user_id=e.user_id, bot_key=e.bot_key,
            personality_name=e.personality_name, config_json=e.config_json, rating=e.rating,
        ))

    if fmt == "round_robin":
        for rnd, pairs in enumerate(rules.berger_rounds(size), 1):
            for board, (white, black) in enumerate(pairs, 1):
                _add_game(db, tournament, rnd, board, rules.MatchGame("main", white, black, False))
    else:
        for board, (high, low) in enumerate(rules.knockout_first_round(size), 1):
            _add_game(db, tournament, 1, board, rules.match_game(high, low, "main"))
    await db.commit()
    await db.refresh(tournament)
    return tournament


def _add_game(db: AsyncSession, tournament: Tournament, rnd: int, board: int, game: rules.MatchGame) -> None:
    base, inc = tournament.base_time_ms, tournament.increment_ms
    if game.shortened:
        base, inc = rules.shortened_control(base, inc)
    db.add(TournamentGame(
        tournament_id=tournament.id, round=rnd, board=board, stage=game.stage,
        white_seat=game.white, black_seat=game.black, base_time_ms=base, increment_ms=inc,
    ))


async def players_of(db: AsyncSession, tournament_id: int) -> list[TournamentPlayer]:
    return list((await db.execute(
        select(TournamentPlayer).where(TournamentPlayer.tournament_id == tournament_id).order_by(TournamentPlayer.seat)
    )).scalars().all())


async def games_of(db: AsyncSession, tournament_id: int) -> list[TournamentGame]:
    return list((await db.execute(
        select(TournamentGame).where(TournamentGame.tournament_id == tournament_id)
        .order_by(TournamentGame.round, TournamentGame.board, TournamentGame.id)
    )).scalars().all())


def _record(game: TournamentGame) -> rules.GameRecord:
    return rules.GameRecord(game.white_seat, game.black_seat, game.result)  # type: ignore[arg-type]


async def record_result(
        db: AsyncSession, tournament: Tournament, game: TournamentGame, result: str, game_id: int | None = None,
) -> None:
    """Записывает результат партии турнира и продвигает турнир. Сам commit."""
    if result not in ("1-0", "0-1", "1/2-1/2"):
        raise ValueError(f"bad result {result}")
    if game.tournament_id != tournament.id or tournament.status != "active" or game.result is not None:
        raise DomainError("tournament_game_closed")
    game.result = result
    game.game_id = game_id
    await db.flush()
    if tournament.format == "round_robin":
        await _advance_round_robin(db, tournament)
    else:
        await _advance_knockout(db, tournament)
    await db.commit()


async def _finish(tournament: Tournament) -> None:
    tournament.status = "finished"
    tournament.finished_at = datetime.now(UTC)


async def _advance_round_robin(db: AsyncSession, tournament: Tournament) -> None:
    games = await games_of(db, tournament.id)
    if any(g.result is None for g in games if g.round == tournament.current_round):
        return
    if any(g.result is None for g in games):
        # Тур закрыт — открывается следующий (его партии ботов между собой можно считать).
        tournament.current_round += 1
        return
    players = await players_of(db, tournament.id)
    table = rules.round_robin_standings([p.seat for p in players], [_record(g) for g in games])
    place = {s.seat: s.place for s in table}
    for p in players:
        p.place = place[p.seat]
    await _finish(tournament)


async def _advance_knockout(db: AsyncSession, tournament: Tournament) -> None:
    games = [g for g in await games_of(db, tournament.id) if g.round == tournament.current_round]
    boards = sorted({g.board for g in games})
    winners: list[int] = []
    pending = False
    for board in boards:
        match = [g for g in games if g.board == board]
        if any(g.result is None for g in match):
            pending = True
            continue
        main = next(g for g in match if g.stage == "main")
        high, low = sorted((main.white_seat, main.black_seat))
        state = rules.match_state(high, low, [(g.stage, _record(g)) for g in match])  # type: ignore[misc]
        if state.winner is None:
            assert state.next_game is not None
            _add_game(db, tournament, tournament.current_round, board, state.next_game)
            pending = True
        else:
            winners.append(state.winner)
    if pending:
        return

    players = {p.seat: p for p in await players_of(db, tournament.id)}
    for board in boards:
        main = next(g for g in games if g.board == board and g.stage == "main")
        for seat in (main.white_seat, main.black_seat):
            if seat not in winners:
                players[seat].eliminated_round = tournament.current_round

    if len(winners) == 1:
        eliminated = {s: p.eliminated_round for s, p in players.items() if p.eliminated_round is not None}
        for seat, place in rules.knockout_places(tournament.size, eliminated, winners[0]).items():
            players[seat].place = place
        await _finish(tournament)
        return

    tournament.current_round += 1
    for board, (high, low) in enumerate(rules.knockout_next_round(winners), 1):
        _add_game(db, tournament, tournament.current_round, board, rules.match_game(high, low, "main"))


async def simulatable_games(db: AsyncSession, tournament: Tournament) -> list[TournamentGame]:
    """Партии текущего круга без результата, где оба участника — боты: их играет сервер (таск 15.2)."""
    if tournament.status != "active":
        return []
    humans = {p.seat for p in await players_of(db, tournament.id) if p.kind == "user"}
    return [
        g for g in await games_of(db, tournament.id)
        if g.round == tournament.current_round and g.result is None
        and g.white_seat not in humans and g.black_seat not in humans
    ]
