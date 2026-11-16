# --- FILE: tests/test_time_machine.py ---
"""«Машина времени» (таск 28.2): мастера прошлого, реестр знаменитых турниров, вход игрока в исторический состав."""

import json

import chess
import pytest
from sqlalchemy import select

from src.api.bots import BOT_METADATA
from src.models.tournament import Tournament
from src.services import time_machine, tournament_simulation
from src.services import tournaments as service
from src.services.bots.guests import GUESTS, GUESTS_BY_ID
from src.services.bots.masters import MASTERS_BY_ID
from src.services.bots.personality import BotPersonalityConfig, PersonalityBot
from src.services.time_machine import EVENTS, EVENTS_BY_KEY

API = "/api/v1/tournaments"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def play(db, tournament_id: int, outcome) -> None:
    while True:
        tournament = await db.get(Tournament, tournament_id)
        await db.refresh(tournament)
        pending = [g for g in await service.games_of(db, tournament_id) if g.result is None]
        if not pending or tournament.status != "active":
            return
        await service.record_result(db, tournament, pending[0], outcome(pending[0]))


# --- мастера прошлого ---------------------------------------------------------------------------------------------

def test_guests_are_well_formed():
    assert len(GUESTS) == len(GUESTS_BY_ID) >= 40
    for guest in GUESTS:
        assert guest.id.isascii() and guest.id == guest.id.lower()
        assert guest.key == f"guest:{guest.id}"
        # Имя в турнире — в колонке на 30 знаков; в PGN — «Фамилия, Имя» латиницей.
        assert len(guest.pgn_name) <= 30 and ", " in guest.pgn_name and guest.pgn_name.isascii(), guest.pgn_name
        assert guest.config.target_elo == guest.rating and 1500 <= guest.rating <= 2500
        if guest.era is None:
            # Годы жизни неизвестны — допустимо только для участника турнира не позже 1900 года: правило 1
            # («давно умершие») для него соблюдено и так.
            assert min(event.year for event in EVENTS if guest.id in {entry.id for entry in event.field}) <= 1900, guest.id
        else:
            born, died = (int(part) for part in guest.era.split("–"))
            assert 1750 < born < died <= 1995 and 15 <= died - born <= 100, guest.id  # правило 1: только умершие мастера
        # Характер проходит ту же проверку, что и соперник мастерской.
        assert BotPersonalityConfig.model_validate_json(guest.config.model_dump_json()) == guest.config
    # Мастер прошлого не дублирует бота с книгой и портретом.
    assert not set(GUESTS_BY_ID) & set(BOT_METADATA)
    assert not set(GUESTS_BY_ID) & set(MASTERS_BY_ID)


def test_guests_differ_in_strength_as_history_suggests():
    rating = {guest.id: guest.rating for guest in GUESTS}
    assert rating["keres"] > rating["schlechter"] > rating["blackburne"] > rating["kieseritzky"] > rating["mucklow"]
    assert rating["vergani"] == min(rating[p] for p in ("vergani", "tinsley", "pollock", "albin"))


def test_guest_plays_a_legal_move():
    bot = PersonalityBot(GUESTS_BY_ID["janowski"].config)
    board = chess.Board()
    assert chess.Move.from_uci(bot.choose_move(board.fen())["uci"]) in board.legal_moves


# --- реестр турниров ----------------------------------------------------------------------------------------------

def test_events_are_in_order_and_complete():
    keys = [event.key for event in EVENTS]
    assert len(keys) == len(set(keys)) >= 5 and all(len(key) <= 32 and key.isascii() for key in keys)
    assert {"london_1851", "hastings_1895", "st_petersburg_1914", "new_york_1924", "avro_1938"} <= set(keys)
    assert [event.year for event in EVENTS] == sorted(event.year for event in EVENTS)
    assert all(event.year <= 1948 for event in EVENTS)  # решение спринта: турниры до 1948 года
    sizes = {event.key: (len(event.field), event.format, event.cycles, event.player_games) for event in EVENTS}
    for key, expected in {
        "london_1851": (16, "knockout", 1, None),
        "hastings_1895": (22, "round_robin", 1, 22),
        "st_petersburg_1914": (11, "round_robin", 1, 11),
        "new_york_1924": (11, "round_robin", 2, 22),
        "avro_1938": (8, "round_robin", 2, 16),
        # Четверо в шесть кругов и шестеро в четыре: у игрока по 24 партии.
        "st_petersburg_1895": (4, "round_robin", 6, 24),
        "new_york_1927": (6, "round_robin", 4, 24),
    }.items():
        assert sizes[key] == expected, key
    rounds = {event.key: event.rounds for event in EVENTS}
    assert (rounds["london_1851"], rounds["hastings_1895"], rounds["new_york_1924"], rounds["avro_1938"]) == (5, 23, 22, 18)
    # Пятеро (четверо мастеров и игрок) в шесть кругов: 30 туров, в каждом один свободен.
    assert rounds["st_petersburg_1895"] == 30
    for event in EVENTS:
        ids = [entry.id for entry in event.field]
        assert len(ids) == len(set(ids)), event.key
        for entry in event.field:
            spec, rating = time_machine.participant(entry.id)  # каждый участник существует как соперник
            assert spec.kind in ("bot", "guest") and rating > 0
    # Каждый мастер прошлого играет хотя бы в одном турнире.
    assert {entry.id for event in EVENTS for entry in event.field} >= set(GUESTS_BY_ID)


def test_real_results_match_the_sources():
    hastings = {entry.id: (entry.place, entry.score) for entry in EVENTS_BY_KEY["hastings_1895"].field}
    assert hastings["pillsbury"] == (1, 16.5) and hastings["chigorin"] == (2, 16) and hastings["lasker"] == (3, 15.5)
    assert hastings["bardeleben"] == hastings["teichmann"] == (7, 11.5)  # делёж — одно место
    assert hastings["vergani"] == (22, 3)
    # Круговой в один круг: сумма очков — число партий.
    assert sum(score for _, score in hastings.values()) == 22 * 21 / 2
    assert sum(e.score for e in EVENTS_BY_KEY["st_petersburg_1914"].field) == 11 * 10 / 2
    assert sum(e.score for e in EVENTS_BY_KEY["new_york_1924"].field) == 11 * 10
    assert sum(e.score for e in EVENTS_BY_KEY["avro_1938"].field) == 8 * 7

    avro = {entry.id: entry.place for entry in EVENTS_BY_KEY["avro_1938"].field}
    assert avro["keres"] == avro["fine"] == 1 and avro["botvinnik"] == 3
    assert avro["euwe"] == avro["reshevsky"] == avro["alekhine"] == 4 and avro["flohr"] == 8

    london = EVENTS_BY_KEY["london_1851"].field
    assert [e.id for e in london[:4]] == ["anderssen", "wyvill", "williams", "staunton"]
    assert [e.place for e in london[:8]] == list(range(1, 9)) and all(e.place is None for e in london[8:])


@pytest.mark.parametrize("event", EVENTS, ids=lambda event: event.key)
def test_every_event_has_a_consistent_real_table(event):
    field = event.field
    if event.format == "knockout":
        placed = [entry.place for entry in field if entry.place is not None]
        assert placed == list(range(1, len(placed) + 1)) and placed[0] == 1
        assert all(entry.score is None for entry in field)
        return
    scores = [entry.score for entry in field]
    assert all(score is not None and score >= 0 for score in scores)
    assert scores == sorted(scores, reverse=True)  # таблица — по убыванию очков
    for index, entry in enumerate(field):
        # Место — номер первой строки с такими же очками: делёж даёт одно место на всех.
        assert entry.place == 1 + next(i for i, other in enumerate(field) if other.score == entry.score), entry.id
        assert index == 0 or entry.place >= field[index - 1].place
    games = len(field) * (len(field) - 1) // 2 * event.cycles
    # Сумма очков — число партий; в старых турнирах бывала несыгранная партия без очков обоим.
    assert games - 2 <= sum(scores) <= games, (event.key, sum(scores), games)
    assert max(scores) <= (len(field) - 1) * event.cycles


@pytest.mark.parametrize("event", EVENTS, ids=lambda event: event.key)
async def test_every_event_can_be_entered(event, db_session, test_user_1):
    tournament = await time_machine.start(db_session, test_user_1, event.key, 600_000, 0)
    players = await service.players_of(db_session, tournament.id)
    games = await service.games_of(db_session, tournament.id)
    assert (tournament.event_key, tournament.size, len(players)) == (event.key, event.size, len(event.field) + 1)
    assert sorted(p.seat for p in players) == list(range(1, event.size + 1))
    assert sum(1 for p in players if p.kind == "user") == 1
    # Каждый участник реестра сидит за доской: бот — по id, мастер прошлого — персоналией с ключом и характером.
    keys = {p.bot_key for p in players if p.kind != "user"}
    assert keys == {entry.id if entry.id in BOT_METADATA else f"guest:{entry.id}" for entry in event.field}
    assert all(p.config_json and p.personality_name for p in players if (p.bot_key or "").startswith("guest:"))
    if event.format == "round_robin":
        assert len(games) == event.size * (event.size - 1) // 2 * event.cycles
        mine = next(p.seat for p in players if p.kind == "user")
        assert sum(1 for g in games if mine in (g.white_seat, g.black_seat)) == event.player_games
        assert max(g.round for g in games) == event.rounds
    else:
        assert len(games) == event.size - (2 ** (event.rounds - 1))  # матчи первого круга, остальные проходят без игры


def test_client_catalogs_have_names_and_texts_for_everything():
    """Имена мастеров и тексты о турнирах — на клиенте, на трёх языках: без них на странице были бы голые ключи."""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "i18n" / "messages"
    for language in ("en", "uk", "ru"):
        text = (root / f"{language}.ts").read_text(encoding="utf-8")
        guests = text[text.index("        guests: {\n"):]
        guests = guests[:guests.index("\n        },\n")]
        found = set(re.findall(r"^            (\w+): \{name: '.+', shortName: '.+', about: '.+'\},$", guests, flags=re.M))
        assert found == set(GUESTS_BY_ID), (language, found ^ set(GUESTS_BY_ID))
        events = text[text.index("        events: {\n", text.index("    timeMachine: {\n")):]
        events = events[:events.index("\n        },\n    },\n")]
        keys = re.findall(r"^            (\w+): \{$", events, flags=re.M)
        assert sorted(keys) == sorted(EVENTS_BY_KEY), (language, set(keys) ^ set(EVENTS_BY_KEY))
        for part in ("title", "place", "story", "real"):
            assert len(re.findall(rf"^                {part}: '.+',$", events, flags=re.M)) == len(EVENTS), (language, part)


# --- API ----------------------------------------------------------------------------------------------------------

def test_overview_lists_events_with_field_and_history(client, token_user_1):
    assert client.get(f"{API}/time-machine").status_code == 401
    events = client.get(f"{API}/time-machine", headers=auth(token_user_1)).json()["events"]
    assert [e["key"] for e in events] == [event.key for event in EVENTS]
    by_key = {e["key"]: e for e in events}
    hastings = by_key["hastings_1895"]
    assert (hastings["year"], hastings["format"], hastings["size"], hastings["rounds"], hastings["player_games"]) == (
        1895, "round_robin", 23, 23, 22)
    assert (hastings["active_id"], hastings["best_place"], hastings["played"]) == (None, None, 0)
    first = hastings["field"][0]
    assert first == {"id": "pillsbury", "kind": "bot", "rating": first["rating"], "place": 1, "score": 16.5}
    kinds = {p["id"]: p["kind"] for p in hastings["field"]}
    assert kinds["schlechter"] == "guest" and kinds["lasker"] == "bot"
    assert by_key["london_1851"]["player_games"] is None and by_key["london_1851"]["field"][8]["place"] is None


def test_unknown_event_and_time_control_limits(client, token_user_1):
    missing = client.post(f"{API}/time-machine/moscow_2099", json={}, headers=auth(token_user_1))
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "time_machine_event_unknown"
    too_fast = client.post(f"{API}/time-machine/avro_1938", json={"base_time_ms": 1000}, headers=auth(token_user_1))
    assert too_fast.status_code == 422


def test_player_joins_avro_as_the_ninth(client, token_user_1):
    created = client.post(f"{API}/time-machine/avro_1938", json={"base_time_ms": 900_000, "increment_ms": 10_000},
                          headers=auth(token_user_1))
    assert created.status_code == 201
    t = created.json()
    assert (t["event_key"], t["format"], t["size"], t["base_time_ms"]) == ("avro_1938", "round_robin", 9, 900_000)
    # 9 участников в два круга: 72 партии, 18 туров, у игрока 16 партий — по две с каждым.
    assert len(t["games"]) == 72 and max(g["round"] for g in t["games"]) == 18
    mine = [g for g in t["games"] if t["my_seat"] in (g["white_seat"], g["black_seat"])]
    assert len(mine) == 16
    players = {p["seat"]: p for p in t["players"]}
    keres = next(p for p in t["players"] if p["bot_key"] == "guest:keres")
    # Мастер прошлого — персоналия с характером: клиент играет с ним как с соперником мастерской.
    assert keres["kind"] == "personality" and keres["personality_name"] == "Keres, Paul"
    assert keres["config"]["target_elo"] == keres["rating"] == 2400
    botvinnik = next(p for p in t["players"] if p["bot_key"] == "botvinnik")
    assert botvinnik["kind"] == "bot" and botvinnik["config"] is None
    assert sorted(p["kind"] for p in players.values()) == ["bot"] * 3 + ["personality"] * 5 + ["user"]

    summary = client.get(API, headers=auth(token_user_1)).json()
    assert summary[0]["event_key"] == "avro_1938"
    events = client.get(f"{API}/time-machine", headers=auth(token_user_1)).json()["events"]
    assert {e["key"]: e["active_id"] for e in events if e["active_id"]} == {"avro_1938": t["id"]}


def test_time_machine_has_its_own_slot_next_to_a_regular_tournament(client, token_user_1):
    regular = {"format": "round_robin", "size": 4, "base_time_ms": 300_000,
               "participants": [{"kind": "bot", "id": b} for b in ("morphy", "philidor", "staunton")]}
    assert client.post(API, headers=auth(token_user_1), json=regular).status_code == 201
    # Обычный турнир идёт — исторический всё равно можно начать, и наоборот; второй того же вида — нельзя.
    assert client.post(f"{API}/time-machine/london_1851", json={}, headers=auth(token_user_1)).status_code == 201
    second = client.post(f"{API}/time-machine/avro_1938", json={}, headers=auth(token_user_1))
    assert second.status_code == 409 and second.json()["detail"]["code"] == "tournament_active_exists"
    again = client.post(API, headers=auth(token_user_1), json=regular)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "tournament_active_exists"


def test_regular_tournaments_cannot_invite_guests_directly(client, token_user_1):
    # Мастера прошлого приходят только с историческим турниром: в своём турнире такого вида соперника нет.
    body = {"format": "round_robin", "size": 4, "base_time_ms": 300_000,
            "participants": [{"kind": "guest", "id": "keres"}, {"kind": "bot", "id": "morphy"}, {"kind": "bot", "id": "tal"}]}
    assert client.post(API, headers=auth(token_user_1), json=body).status_code == 422


async def test_london_1851_knockout_to_the_end(client, db_session, token_user_1, test_user_1):
    t = client.post(f"{API}/time-machine/london_1851", json={}, headers=auth(token_user_1)).json()
    assert (t["size"], t["format"]) == (17, "knockout")
    # Шестнадцать мастеров и игрок: один стыковой матч двух младших по посеву, остальные начинают со второго круга.
    assert len(t["games"]) == 1
    seeds = {p["seat"]: p for p in t["players"]}
    assert seeds[1]["bot_key"] == "anderssen"  # сильнейший по силе на старте
    assert seeds[t["my_seat"]]["kind"] == "user"

    await play(db_session, t["id"], lambda g: "1-0" if g.white_seat < g.black_seat else "0-1")
    done = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    assert done["status"] == "finished"
    places = {p["seat"]: p["place"] for p in done["players"]}
    assert places[1] == 1 and places[2] == 2 and sorted(places.values()).count(9) == 8
    events = client.get(f"{API}/time-machine", headers=auth(token_user_1)).json()["events"]
    london = next(e for e in events if e["key"] == "london_1851")
    assert london["active_id"] is None and london["played"] == 1 and london["best_place"] == places[t["my_seat"]]
    # Закончив, можно войти в тот же турнир снова.
    assert client.post(f"{API}/time-machine/london_1851", json={}, headers=auth(token_user_1)).status_code == 201


async def test_guest_games_are_simulated_with_their_names(client, db_session, token_user_1, monkeypatch):
    t = client.post(f"{API}/time-machine/avro_1938", json={}, headers=auth(token_user_1)).json()
    tournament = (await db_session.execute(select(Tournament).where(Tournament.id == t["id"]))).scalar_one()
    players = {p.seat: p for p in await service.players_of(db_session, tournament.id)}
    # Партии мастеров между собой играет сервер: в первом туре игрок занят в одной партии, остальные — ботов.
    assert len(await service.simulatable_games(db_session, tournament)) == 3
    white = next(p for p in players.values() if p.bot_key == "guest:keres")
    # Бот мастера прошлого собирается из его характера; в PGN — латинское имя.
    bot = tournament_simulation.bot_for(white)
    assert bot.config == BotPersonalityConfig.model_validate(json.loads(white.config_json))
    assert tournament_simulation._pgn_name(white) == white.personality_name
    assert white.personality_name == GUESTS_BY_ID["keres"].pgn_name
