"""Продвинутые стартовые наборы (таск 27.10) создаются через API целиком и укладываются в лимиты репертуара."""

import pytest

from src.services import repertoire
from src.services.repertoire_starters import BY_ID

API = "/api/v1/repertoires"


@pytest.mark.parametrize("starter", ["e4_advanced", "e5_slav_advanced"])
def test_advanced_starter_is_created_whole(client, token_user_1, starter):
    response = client.post(API, headers={"Authorization": f"Bearer {token_user_1}"}, json={"starter": starter})
    assert response.status_code == 200, response.text
    rep = response.json()
    assert rep["color"] == BY_ID[starter].color
    lines = {tuple(repertoire.san_line_to_uci(line)) for line in BY_ID[starter].lines}
    plies = {line[:n] for line in lines for n in range(1, len(line) + 1)}
    # Узлы — позиции: перестановки сливаются, поэтому ходов не больше, чем разных начал линий.
    assert 300 < len(rep["moves"]) <= len(plies) <= repertoire.MAX_MOVES
