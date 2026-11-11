# --- FILE: tests/test_assets_licensing.py ---
"""
Ассеты в репозитории совпадают с записями о лицензиях: набор фигур, портрет или звук нельзя
добавить, не вписав автора и лицензию (ATTRIBUTION.md, конфиг интерфейса, манифест портретов).
"""

import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "frontend" / "public" / "assets"
ATTRIBUTION = (ROOT / "ATTRIBUTION.md").read_text(encoding="utf-8")
PIECE_CODES = {f"{color}{piece}.svg" for color in "wb" for piece in "PNBRQK"}


def _load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


piece_script = _load_script("setup_piece_sets")
portrait_script = _load_script("download_champions")
LICENSED_SETS = {**piece_script.PIECE_SETS, **piece_script.DERIVED_SETS}


def test_only_licensed_piece_sets_are_shipped():
    on_disk = {path.name for path in (ASSETS / "pieces").iterdir()}
    assert on_disk == set(LICENSED_SETS), "в pieces/ есть набор без записи о лицензии (или запись без набора)"


@pytest.mark.parametrize("set_name", sorted(LICENSED_SETS))
def test_piece_set_is_complete_and_documented(set_name):
    files = {path.name for path in (ASSETS / "pieces" / set_name).iterdir()}
    assert files == PIECE_CODES
    author, license_id = LICENSED_SETS[set_name]
    assert f"`{set_name}`" in ATTRIBUTION
    assert license_id in ATTRIBUTION


def test_no_non_commercial_piece_licenses():
    for set_name, (_author, license_id) in LICENSED_SETS.items():
        assert "NC" not in license_id.upper().split("-"), f"{set_name}: {license_id}"


def test_interface_offers_exactly_the_licensed_sets():
    config = (ROOT / "frontend" / "src" / "config" / "boardAppearance.ts").read_text(encoding="utf-8")
    offered = dict(re.findall(r"folder: '(\w+)'.*?license: '([^']+)'", config, flags=re.DOTALL))
    assert offered == {name: license_id for name, (_author, license_id) in LICENSED_SETS.items()}


def test_every_portrait_has_a_free_license_record():
    credits = json.loads((ROOT / "frontend" / "src" / "config" / "portraitCredits.json").read_text(encoding="utf-8"))
    portraits = {path.stem for path in (ASSETS / "champions").iterdir()}

    assert portraits == set(credits), "портрет без записи об источнике (или запись без файла)"
    for player_id, credit in credits.items():
        assert portrait_script.is_free_license(credit["license"]), f"{player_id}: {credit['license']}"
        assert credit["author"] and credit["source_url"].startswith("https://commons.wikimedia.org/")
        assert f"`{player_id}.jpg`" in ATTRIBUTION


def test_bundled_bot_portraits_are_copies_of_the_licensed_ones():
    public = ASSETS / "champions"
    for copy in (ROOT / "frontend" / "src" / "assets" / "champions").iterdir():
        assert (public / copy.name).read_bytes() == copy.read_bytes()


def test_no_recorded_audio_or_unlisted_textures():
    """Звуки синтезируются; записи (у прежних не было свободной лицензии) в проект не возвращаются."""
    frontend = ROOT / "frontend"
    audio = [
        path for folder in ("public", "src") for path in (frontend / folder).rglob("*")
        if path.suffix.lower() in {".mp3", ".ogg", ".wav", ".m4a", ".flac"}
    ]
    assert audio == []
    assert {path.name for path in (ASSETS / "textures").iterdir()} == {"wood-grain.svg"}
    assert "wood-grain.svg" in ATTRIBUTION


@pytest.mark.parametrize(("license_name", "is_free"), [
    ("Public domain", True),
    ("CC0", True),
    ("CC BY 4.0", True),
    ("CC BY-SA 3.0 de", True),
    ("CC BY-NC-SA 4.0", False),
    ("CC BY-ND 2.0", False),
    ("CC BY-NC 2.0", False),
    ("Fair use", False),
    ("", False),
])
def test_free_license_filter(license_name, is_free):
    assert portrait_script.is_free_license(license_name) is is_free
