# --- FILE: tests/test_blindfold.py ---
"""Игра вслепую (таск 19.5): партия с ботом сохраняется с пометкой и числом подсмотров; не бывает засчитываемой;
товарищеская партия с человеком отмечается участником после окончания."""

from src.models.game import Game, GameStatus

FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_bot_game_saved_blindfold(client, token_user_1, test_user_1):
    saved = client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
        "bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": FOOLS_MATE, "blindfold": 3, "peeks": 2,
    })
    assert saved.status_code == 200, saved.text
    plain = client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
        "bot_id": "philidor", "player_color": "white", "result": "0-1", "moves_uci": FOOLS_MATE,
    })
    games = {g["game_id"]: g for g in client.get(f"/api/v1/profile/{test_user_1.username}/games").json()["items"]}
    assert (games[saved.json()["game_id"]]["blindfold"], games[saved.json()["game_id"]]["peeks"]) == (3, 2)
    assert (games[plain.json()["game_id"]]["blindfold"], games[plain.json()["game_id"]]["peeks"]) == (None, None)


def test_blindfold_not_in_ladder_or_tournament(client, token_user_1):
    for extra in ({"ladder": True}, {"tournament_game_id": 1}):
        response = client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
            "bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": FOOLS_MATE, "blindfold": 1, **extra,
        })
        assert response.status_code == 400 and response.json()["detail"]["code"] == "blindfold_not_allowed"
    bad = client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
        "bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": FOOLS_MATE, "blindfold": 7,
    })
    assert bad.status_code == 422


async def test_mark_friendly_pvp_game(client, db_session, token_user_1, token_user_2, test_user_1, test_user_2):
    players = {"white_player_id": test_user_1.id, "black_player_id": test_user_2.id}
    friendly = Game(**players, status=GameStatus.COMPLETED, is_rated=False)
    rated = Game(**players, status=GameStatus.COMPLETED, is_rated=True)
    running = Game(**players, status=GameStatus.IN_PROGRESS, is_rated=False)
    db_session.add_all([friendly, rated, running])
    await db_session.commit()
    url = "/api/v1/profile/games/{}/blindfold"
    assert client.post(url.format(friendly.id), json={"level": 2, "peeks": 1}, headers=auth(token_user_1)).json() == {
        "blindfold": 2, "peeks": 1}
    # Второй игрок тоже играл вслепую: ступень — наибольшая, подсмотры складываются.
    assert client.post(url.format(friendly.id), json={"level": 4, "peeks": 0}, headers=auth(token_user_2)).json() == {
        "blindfold": 4, "peeks": 1}
    for game in (rated, running):
        response = client.post(url.format(game.id), json={"level": 1}, headers=auth(token_user_1))
        assert response.status_code == 400 and response.json()["detail"]["code"] == "blindfold_not_allowed"
    from src.models.user import User
    outsider = User(username="outsider", hashed_password="x")
    db_session.add(outsider)
    await db_session.commit()
    from src.core.security import create_user_token
    stranger = client.post(url.format(friendly.id), json={"level": 1}, headers=auth(create_user_token(outsider)))
    assert stranger.status_code == 404
