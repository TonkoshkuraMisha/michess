# --- FILE: tests/test_themes.py ---
"""
Реестр тактических приёмов (таск 13.0): целостность реестра, тексты на трёх языках, согласие с каталогом в docs,
соответствие тегов lichess и мотивов детектора, API.
"""

import pathlib
import re
from typing import get_args

import pytest

from src.services.mentor_service import MotifCode
from src.services.themes import (
    LICHESS_TAG_TO_THEMES,
    SECTIONS,
    SOURCES,
    THEMES,
    THEMES_BY_CODE,
    themes_for_lichess_tags,
    themes_for_motif,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOGS = ROOT / "frontend" / "src" / "i18n" / "messages"
DOC = ROOT / "docs" / "training" / "tactical-themes.md"
CODE = re.compile(r"^[a-z][a-z0-9_]*$")


def _theme_texts(lang: str) -> dict[str, dict[str, str]]:
    """Тексты themes.<код>.{name,short,explain} из каталога языка."""
    text = (CATALOGS / f"{lang}.ts").read_text(encoding="utf-8")
    block = text[text.index("\n    themes: {\n"):]
    block = block[:block.index("\n    },\n")]
    result: dict[str, dict[str, str]] = {}
    current = None
    for line in block.splitlines():
        if m := re.match(r"^        (\w+): \{$", line):
            current = m.group(1)
            result[current] = {}
        elif current and (m := re.match(r"^            (name|short|explain): '(.*)',$", line)):
            result[current][m.group(1)] = m.group(2)
    return result


def test_registry_is_consistent():
    codes = [t.code for t in THEMES]
    assert len(codes) == len(set(codes)) == 115
    for theme in THEMES:
        assert CODE.match(theme.code), theme.code
        assert theme.section in SECTIONS, theme.code
        assert theme.sources and set(theme.sources) <= set(SOURCES), theme.code
        assert theme.parent is None or theme.parent in THEMES_BY_CODE, theme.code
        assert theme.parent != theme.code
        assert len(theme.minimums) == 4 and all(n >= 0 for n in theme.minimums) and theme.minimums[-1] > 0
        if "L" in theme.sources and not theme.code.startswith("combination"):
            assert theme.lichess, f"{theme.code}: размечается тегом lichess, но тег не указан"
        if theme.detector:
            assert "D" in theme.sources, theme.code
    assert {t.section for t in THEMES} == set(SECTIONS)


def test_detector_codes_exist():
    known = set(get_args(MotifCode))
    for theme in THEMES:
        assert set(theme.detector) <= known, theme.code


@pytest.mark.parametrize("lang", ["en", "uk", "ru"])
def test_every_theme_has_texts(lang):
    texts = _theme_texts(lang)
    assert set(texts) == set(THEMES_BY_CODE), set(texts) ^ set(THEMES_BY_CODE)
    for code, entry in texts.items():
        assert set(entry) == {"name", "short", "explain"}, code
        assert all(value.strip() for value in entry.values()), code
        # Объяснение — как тренер ученику: 2–4 предложения.
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", entry["explain"]) if s]
        assert 2 <= len(sentences) <= 4, (lang, code, len(sentences))


def test_texts_differ_between_languages():
    en, uk, ru = (_theme_texts(lang) for lang in ("en", "uk", "ru"))
    for code in THEMES_BY_CODE:
        assert en[code]["explain"] != ru[code]["explain"] != uk[code]["explain"], code


def test_doc_lists_every_theme():
    doc = DOC.read_text(encoding="utf-8")
    documented = set(re.findall(r"`([a-z][a-z0-9_]*)`", doc))
    # «mate_in_1 … mate_in_5» и «kingside_attack / queenside_attack» в документе даны одной строкой.
    documented |= {f"mate_in_{n}" for n in range(1, 6)}
    assert set(THEMES_BY_CODE) <= documented, set(THEMES_BY_CODE) - documented


def test_lichess_tags_map_to_themes():
    assert themes_for_lichess_tags(["fork", "mateIn2", "unknownTag", "fork"]) == ["fork", "mate_in_2"]
    assert LICHESS_TAG_TO_THEMES["veryLong"] == ("long_calculation",)
    assert themes_for_lichess_tags(["attraction", "capturingDefender"]) == ["decoy", "remove_defender"]


def test_motifs_map_to_themes():
    assert themes_for_motif("fork", "n") == ["fork", "fork_knight"]
    assert themes_for_motif("fork", "p") == ["fork", "fork_pawn"]
    assert themes_for_motif("pin_relative") == ["pin"]
    assert themes_for_motif("overloaded") == ["overload"]
    assert themes_for_motif("battery") == ["battery"]
    assert themes_for_motif("interference") == ["interference"]
    assert themes_for_motif("passed_pawn") == []


def test_api_lists_the_registry(client):
    body = client.get("/api/v1/themes").json()
    assert body["sections"] == list(SECTIONS)
    assert len(body["themes"]) == 115
    fork_knight = next(t for t in body["themes"] if t["code"] == "fork_knight")
    assert fork_knight == {"code": "fork_knight", "section": "A", "parent": "fork", "sources": ["D"],
                           "minimums": [25, 25, 20, 15]}
