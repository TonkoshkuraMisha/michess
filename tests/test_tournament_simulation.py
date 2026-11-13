# --- FILE: tests/test_tournament_simulation.py ---
"""Симуляция партий ботов между собой в турнире (таск 15.2)."""

import chess
import pytest
from sqlalchemy import func, select

from src.models.game import Game
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.models.user import User
from src.services import tournament_simulation as sim
from src.services import tournaments as service

API = "/api/v1/tournaments"
FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create(client, token, fmt="round_robin", size=4):
    bots = [{"kind": "bot", "id": b} for b in ("morphy", "philidor", "staunton")]
    return client.post(API, headers=auth(token), json={"format": fmt, "size": size, "participants": bots}).json()


def fools_mate(white, black):
    return FOOLS_MATE, "0-1", "checkmate"


class FirstMoveBot:
    """Детерминированный «бот»: первый легальный ход по алфавиту."""

    def choose_move(self, fen):
        board = chess.Board(fen)
        return {"uci": min(m.uci() for m in board.legal_moves)}


def test_bot_games_of_the_first_round_are_queued(client, token_user_1, published_simulations):
    t = create(client, token_user_1)
    bot_games = [g for g in t["games"] if g["round"] == 1 and t["my_seat"] not in (g["white_seat"], g["black_seat"])]
    assert published_simulations == [g["id"] for g in bot_games]
    assert len(bot_games) == 1  # в туре на четверых одна партия ботов, вторая — игрока


@pytest.mark.asyncio
async def test_simulated_game_is_saved_marked_and_recorded(client, db_session, token_user_1):
    t = create(client, token_user_1)
    tgame_id = next(g["id"] for g in t["games"] if g["round"] == 1 and t["my_seat"] not in (g["white_seat"], g["black_seat"]))

    follow_up = await sim.simulate(db_session, tgame_id, play=fools_mate)
    assert follow_up == []  # тур не закрыт: партия игрока не сыграна

    tgame = await db_session.get(TournamentGame, tgame_id)
    await db_session.refresh(tgame)
    game = await db_session.get(Game, tgame.game_id)
    assert tgame.result == "0-1" and game.is_simulation and not game.is_rated
    players = {p.seat: p for p in (await db_session.execute(
        select(TournamentPlayer).where(TournamentPlayer.tournament_id == t["id"]))).scalars()}
    assert f'[White "{sim._pgn_name(players[tgame.white_seat])}"]' in game.pgn
    assert "Qh4#" in game.pgn and game.termination == "checkmate"

    # Повторная постановка той же партии не играет её второй раз.
    assert await sim.simulate(db_session, tgame_id, play=fools_mate) == []
    assert (await db_session.execute(select(func.count(Game.id)))).scalar_one() == 1


@pytest.mark.asyncio
async def test_next_round_bot_games_open_after_the_players_game(
        client, db_session, token_user_1, published_simulations,
):
    t = create(client, token_user_1)
    me = t["my_seat"]
    round1 = [g for g in t["games"] if g["round"] == 1]
    bot_game = next(g for g in round1 if me not in (g["white_seat"], g["black_seat"]))
    my_game = next(g for g in round1 if me in (g["white_seat"], g["black_seat"]))

    await sim.simulate(db_session, bot_game["id"], play=fools_mate)
    tournament = await db_session.get(Tournament, t["id"])
    await service.record_result(db_session, tournament, await db_session.get(TournamentGame, my_game["id"]), "1-0")
    await db_session.refresh(tournament)
    assert tournament.current_round == 2

    published_simulations.clear()
    state = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    round2_bots = [g["id"] for g in state["games"] if g["round"] == 2 and me not in (g["white_seat"], g["black_seat"])]
    assert published_simulations == round2_bots


@pytest.mark.asyncio
async def test_bots_only_round_continues_by_itself(client, db_session, token_user_1):
    # На выбывание из 8: игрок (слабейший) играет с первым номером, три матча — боты между собой.
    bots = ["morphy", "philidor", "staunton", "anderssen", "paulsen", "zukertort"]
    participants = [{"kind": "bot", "id": b} for b in bots] + [{"kind": "archetype", "id": "combinator"}]
    t = client.post(API, headers=auth(token_user_1),
                    json={"format": "knockout", "size": 8, "participants": participants}).json()
    tournament = await db_session.get(Tournament, t["id"])
    queue = [g.id for g in await service.simulatable_games(db_session, tournament)]
    assert len(queue) == 3
    while queue:  # как воркер: каждая сыгранная партия возвращает следующие
        queue = queue[1:] + await sim.simulate(db_session, queue[0], play=fools_mate)
    await db_session.refresh(tournament)
    assert tournament.current_round == 1  # ждём партию игрока


@pytest.mark.asyncio
async def test_simulated_game_hidden_from_bot_archive(client, db_session, token_user_1):
    t = create(client, token_user_1)
    bot_game = next(g for g in t["games"] if g["round"] == 1 and t["my_seat"] not in (g["white_seat"], g["black_seat"]))
    await sim.simulate(db_session, bot_game["id"], play=fools_mate)
    tgame = await db_session.get(TournamentGame, bot_game["id"])
    await db_session.refresh(tgame)
    game = await db_session.get(Game, tgame.game_id)
    white = (await db_session.get(User, game.white_player_id)).username
    archive = client.get(f"/api/v1/profile/{white}/games").json()
    assert archive["total"] == 0 and archive["items"] == []
    # А сама партия открывается по ссылке из турнира.
    assert "Qh4#" in client.get(f"/api/v1/profile/games/{game.id}/pgn").text


def test_play_game_limits_length_and_adjudicates():
    judged = []

    def judge(board):
        judged.append(board.ply())
        return "1/2-1/2"

    moves, result, termination = sim.play_game(FirstMoveBot(), FirstMoveBot(), max_plies=6, judge=judge)
    assert len(moves) == 6 and result == "1/2-1/2" and termination == "adjudication" and judged == [6]


def test_adjudication_without_engine_uses_material(monkeypatch):
    monkeypatch.setattr(sim, "analyse_with_stockfish", lambda **kwargs: {})
    assert sim.adjudicate(chess.Board("4k3/8/8/8/8/8/8/3QK3 w - - 0 1")) == "1-0"
    assert sim.adjudicate(chess.Board("3qk3/8/8/8/8/8/8/4K3 w - - 0 1")) == "0-1"
    assert sim.adjudicate(chess.Board("4k3/8/8/8/8/8/8/4K3 w - - 0 1")) == "1/2-1/2"


def test_simulation_bots_search_shallower():
    from src.services.bots import BOT_INSTANCES

    morphy = TournamentPlayer(seat=1, kind="bot", bot_key="morphy", rating=1900)
    bot = sim.bot_for(morphy)
    assert bot is not BOT_INSTANCES["morphy"]  # общий экземпляр бота не трогаем
    assert bot.search_depth <= sim.SIM_MAX_DEPTH and bot.time_limit <= sim.SIM_TIME_LIMIT_S
    archetype = sim.bot_for(TournamentPlayer(seat=2, kind="archetype", bot_key="archetype:rusher", rating=700))
    assert archetype.search_depth <= sim.SIM_MAX_DEPTH
    with pytest.raises(ValueError):
        sim.bot_for(TournamentPlayer(seat=3, kind="user", rating=1200))

