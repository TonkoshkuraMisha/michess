# --- FILE: tests/test_engine_info.py ---
"""Движок этой установки для «О проекте» (таск 23.1): исходники именно работающей версии — требование GPL."""

import pytest

from src.services import engine_info


@pytest.mark.parametrize("name, url", [
    ("Stockfish 17.1", "https://github.com/official-stockfish/Stockfish/tree/sf_17.1"),
    ("Stockfish 18 by the Stockfish developers", "https://github.com/official-stockfish/Stockfish/tree/sf_18"),
    ("Stockfish dev-20261101-abcdef", "https://github.com/official-stockfish/Stockfish/releases"),
    (None, "https://github.com/official-stockfish/Stockfish/releases"),
])
def test_source_link_points_at_the_running_version(name, url):
    assert engine_info.source_url(name) == url


def test_engine_endpoint(client, monkeypatch):
    monkeypatch.setattr(engine_info, "engine_name", lambda path: "Stockfish 17.1")
    monkeypatch.setattr("src.api.bots.resolve_stockfish_path", lambda: "/usr/games/stockfish")
    body = client.get("/api/v1/bots/engine").json()
    assert body["name"] == "Stockfish 17.1" and body["license"] == "GPL-3.0"
    assert body["source_url"].endswith("/tree/sf_17.1")


def test_engine_endpoint_without_engine(client, monkeypatch):
    monkeypatch.setattr("src.api.bots.resolve_stockfish_path", lambda: None)
    body = client.get("/api/v1/bots/engine").json()
    assert body["name"] is None and body["source_url"].endswith("/releases")
