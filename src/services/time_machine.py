# --- FILE: src/services/time_machine.py ---
"""
«Машина времени» (таски 28.2–28.3): игрок становится участником знаменитого турнира прошлого.

Турнир идёт в полном историческом составе плюс игрок: в круговом он играет со всеми, в турнире на выбывание может
вылететь. Партии мастеров между собой разыгрывают боты (симуляция 15.2) — получается альтернативная история; как
турнир закончился на самом деле, хранит реестр (место и очки каждого), клиент показывает это рядом с итогом игрока.

Составы и итоги сверены с открытыми источниками (crosstable каждого турнира). Тексты о турнирах, названия и имена
— на клиенте (timeMachine.events.<key>, bots.guests.<id>): сервер отдаёт только ключи и числа. Участник — либо
исторический мастер с книгой и портретом (bots/masters.py и боты первой волны), либо мастер прошлого из
bots/guests.py.

У «Машины времени» своё место рядом с обычным турниром игрока: один идущий исторический турнир не мешает карьере
и своим турнирам.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.tournament import Tournament, TournamentPlayer
from src.models.user import User
from src.services import tournament_rules as rules
from src.services import tournaments as tournaments_service
from src.services.bots.calibration import strength_of
from src.services.bots.guests import GUESTS_BY_ID


@dataclass(frozen=True)
class Entry:
    """Участник и его настоящий итог: место (None — вылетел без места) и очки (None — у турнира на выбывание)."""

    id: str
    place: int | None
    score: float | None = None


@dataclass(frozen=True)
class Event:
    key: str
    year: int
    format: tournaments_service.Format
    field: tuple[Entry, ...]
    cycles: int = 1

    @property
    def size(self) -> int:
        """Участников вместе с игроком."""
        return len(self.field) + 1

    @property
    def player_games(self) -> int | None:
        """Сколько партий сыграет игрок в круговом турнире; в турнире на выбывание это зависит от него самого."""
        return (self.size - 1) * self.cycles if self.format == "round_robin" else None

    @property
    def rounds(self) -> int:
        if self.format == "round_robin":
            return len(rules.round_robin_schedule(self.size, self.cycles))
        return rules.bracket_size(self.size).bit_length() - 1


def _table(*rows: tuple[str, float]) -> tuple[Entry, ...]:
    """Итоговая таблица кругового турнира: участники по местам, делёж — одно место на всех набравших поровну."""
    entries, place = [], 0
    for index, (player, score) in enumerate(rows):
        if index == 0 or score != rows[index - 1][1]:
            place = index + 1
        entries.append(Entry(player, place, score))
    return tuple(entries)


_EVENTS: tuple[Event, ...] = (
    # Первый международный турнир: шестнадцать участников, матчи на выбывание. Победил Андерсен.
    Event("london_1851", 1851, "knockout", (
        Entry("anderssen", 1), Entry("wyvill", 2), Entry("williams", 3), Entry("staunton", 4),
        Entry("szen", 5), Entry("kennedy_h", 6), Entry("horwitz", 7), Entry("mucklow", 8),
        # Выбыли в первом круге.
        Entry("kieseritzky", None), Entry("newham", None), Entry("bird", None), Entry("brodie", None),
        Entry("lowe", None), Entry("mayet", None), Entry("lowenthal", None), Entry("kennedy_e", None),
    )),
    # Сильнейший турнир XIX века: двадцать два участника в один круг. Победил 22-летний Пильсбери.
    Event("hastings_1895", 1895, "round_robin", _table(
        ("pillsbury", 16.5), ("chigorin", 16), ("lasker", 15.5), ("tarrasch", 14), ("steinitz", 13),
        ("schiffers", 12), ("bardeleben", 11.5), ("teichmann", 11.5), ("schlechter", 11), ("blackburne", 10.5),
        ("walbrodt", 10), ("janowski", 9.5), ("mason", 9.5), ("burn", 9.5), ("gunsberg", 9), ("bird", 9),
        ("albin", 8.5), ("marco", 8.5), ("pollock", 8), ("mieses", 7.5), ("tinsley", 7.5), ("vergani", 3),
    )),
    # Предварительный турнир одиннадцати в один круг; пятеро лучших затем разыграли финал, его выиграл Ласкер.
    Event("st_petersburg_1914", 1914, "round_robin", _table(
        ("capablanca", 8), ("lasker", 6.5), ("tarrasch", 6.5), ("alekhine", 6), ("marshall", 6),
        ("bernstein", 5), ("rubinstein", 5), ("nimzowitsch", 4), ("blackburne", 3.5), ("janowski", 3.5),
        ("gunsberg", 1),
    )),
    # Одиннадцать участников в два круга. Победил Ласкер, опередив Капабланку и Алехина.
    Event("new_york_1924", 1924, "round_robin", _table(
        ("lasker", 16), ("capablanca", 14.5), ("alekhine", 12), ("marshall", 11), ("reti", 10.5), ("maroczy", 10),
        ("bogoljubow", 9.5), ("tartakower", 8), ("yates", 7), ("lasker_edward", 6.5), ("janowski", 5),
    ), cycles=2),
    # Восемь сильнейших мира в два круга. Первое место разделили Керес и Файн.
    Event("avro_1938", 1938, "round_robin", _table(
        ("keres", 8.5), ("fine", 8.5), ("botvinnik", 7.5), ("euwe", 7), ("reshevsky", 7), ("alekhine", 7),
        ("capablanca", 6), ("flohr", 4.5),
    ), cycles=2),
    # Девять участников в два круга (десятый, Штерн, выбыл после четырёх туров, его партии не засчитаны). Победил Андерсен.
    Event("baden_baden_1870", 1870, "round_robin", _table(
        ("anderssen", 11), ("steinitz", 10.5), ("neumann", 10), ("blackburne", 10), ("paulsen", 7.5),
        ("de_vere", 6.5), ("winawer", 6.5), ("rosenthal", 5), ("minckwitz", 5),
    ), cycles=2),
    # Четырнадцать участников в два круга (в истории ничьи переигрывались). Победил Цукерторт, на три очка опередив Стейница.
    Event("london_1883", 1883, "round_robin", _table(
        ("zukertort", 22), ("steinitz", 19), ("blackburne", 16.5), ("chigorin", 16), ("mackenzie", 15.5),
        ("englisch", 15.5), ("mason", 15.5), ("rosenthal", 14), ("winawer", 13), ("bird", 12), ("noa", 9.5),
        ("sellman", 6.5), ("mortimer", 3), ("skipworth", 3),
    ), cycles=2),
    # Четверо сильнейших в шесть кругов. Победил Ласкер.
    Event("st_petersburg_1895", 1895, "round_robin", _table(
        ("lasker", 11.5), ("steinitz", 9.5), ("pillsbury", 8), ("chigorin", 7),
    ), cycles=6),
    # Пятнадцать участников в один круг. Победил Капабланка — в первом своём большом европейском турнире.
    Event("san_sebastian_1911", 1911, "round_robin", _table(
        ("capablanca", 9.5), ("rubinstein", 9), ("vidmar", 9), ("marshall", 8.5), ("tarrasch", 7.5),
        ("schlechter", 7.5), ("nimzowitsch", 7.5), ("bernstein", 7), ("spielmann", 7), ("teichmann", 6.5),
        ("maroczy", 6), ("janowski", 6), ("burn", 5), ("duras", 5), ("leonhardt", 4),
    )),
    # Шестеро в четыре круга. Победил Капабланка, не проиграв ни одной партии.
    Event("new_york_1927", 1927, "round_robin", _table(
        ("capablanca", 14), ("alekhine", 11.5), ("nimzowitsch", 10.5), ("vidmar", 10), ("spielmann", 8),
        ("marshall", 6),
    ), cycles=4),
    # Пятнадцать участников в один круг. Первое место разделили Ботвинник и Капабланка.
    Event("nottingham_1936", 1936, "round_robin", _table(
        ("botvinnik", 10), ("capablanca", 10), ("euwe", 9.5), ("fine", 9.5), ("reshevsky", 9.5), ("alekhine", 9),
        ("flohr", 8.5), ("lasker", 8.5), ("vidmar", 6), ("bogoljubow", 5.5), ("tartakower", 5.5), ("tylor", 4.5),
        ("alexander", 3.5), ("thomas", 3), ("winter", 2.5),
    )),
)
# Лента — по годам; турниры одного года — по ключу.
EVENTS: tuple[Event, ...] = tuple(sorted(_EVENTS, key=lambda event: (event.year, event.key)))
EVENTS_BY_KEY = {event.key: event for event in EVENTS}


def participant(player_id: str) -> tuple[tournaments_service.ParticipantSpec, int]:
    """Участник турнира по id реестра: (кем он будет в турнире, сила)."""
    from src.api.bots import BOT_METADATA

    guest = GUESTS_BY_ID.get(player_id)
    if guest is not None:
        return tournaments_service.ParticipantSpec("guest", guest.id), guest.rating
    meta = BOT_METADATA.get(player_id)
    if meta is None:
        raise KeyError(player_id)
    return tournaments_service.ParticipantSpec("bot", player_id), strength_of(player_id, int(str(meta["rating"]))).rating


async def _history(db: AsyncSession, user: User) -> dict[str, dict]:
    """По каждому турниру: идущий (id) и лучшее место игрока в законченных."""
    rows = (await db.execute(
        select(Tournament.id, Tournament.event_key, Tournament.status, Tournament.withdrawn_at, TournamentPlayer.place)
        .join(TournamentPlayer, (TournamentPlayer.tournament_id == Tournament.id) & (TournamentPlayer.user_id == user.id))
        .where(Tournament.owner_id == user.id, Tournament.event_key.is_not(None))
        .order_by(Tournament.id)
    )).all()
    history: dict[str, dict] = {}
    for tournament_id, key, status, withdrawn_at, place in rows:
        item = history.setdefault(key, {"active_id": None, "best_place": None, "played": 0})
        if status == "active" and withdrawn_at is None:
            item["active_id"] = tournament_id
        elif status == "finished" and place is not None:
            item["played"] += 1
            item["best_place"] = place if item["best_place"] is None else min(item["best_place"], place)
    return history


async def overview(db: AsyncSession, user: User) -> list[dict]:
    """Лента турниров по годам: состав с силой и настоящим итогом, что уже сыграл игрок."""
    history = await _history(db, user)
    result = []
    for event in EVENTS:
        field = []
        for entry in event.field:
            spec, rating = participant(entry.id)
            field.append({"id": entry.id, "kind": spec.kind, "rating": rating, "place": entry.place, "score": entry.score})
        mine = history.get(event.key, {})
        result.append({
            "key": event.key, "year": event.year, "format": event.format, "cycles": event.cycles, "size": event.size,
            "rounds": event.rounds, "player_games": event.player_games, "field": field,
            "active_id": mine.get("active_id"), "best_place": mine.get("best_place"), "played": mine.get("played", 0),
        })
    return result


async def start(db: AsyncSession, user: User, key: str, base_time_ms: int, increment_ms: int) -> Tournament:
    event = EVENTS_BY_KEY.get(key)
    if event is None:
        raise DomainError("time_machine_event_unknown", event=key)
    participants = [participant(entry.id)[0] for entry in event.field]
    return await tournaments_service.create_tournament(
        db, user, event.format, event.size, participants, base_time_ms, increment_ms,
        cycles=event.cycles, open_size=True, event_key=event.key,
    )
