"""Тексты заголовков библиотеки: кириллица в cp1251, прочитанная как латиница, и фигурки шрифтов — чинятся."""

import pytest

from src.services import cbh_reader, library


@pytest.mark.parametrize(("broken", "fixed"), [
    ("Ñèöèëèàíñêàÿ çàùèòà", "Сицилианская защита"),
    ("sic_def-Ñèöèëèàíñêàÿ çàùèòà", "sic_def-Сицилианская защита"),
    ("Øàáàëîâ, À", "Шабалов, А"),
    ("Ãàìáèò Ëèñèöèíà", "Гамбит Лисицина"),
    ("1.e4 c5 2. f4 e6 3.¤c3 d5", "1.e4 c5 2. f4 e6 3.Nc3 d5"),
    ("1.e4 g6 2.d4 ¥g7 3.¤c3 d6 4.f4", "1.e4 g6 2.d4 Bg7 3.Nc3 d6 4.f4"),
    ("3.¤g5 d5!? 4.d3 £d6", "3.Ng5 d5!? 4.d3 Qd6"),
    ("KID_AverbakhVar-Ñòàðîèíäèéñêàÿ", "KID_AverbakhVar-Староиндийская"),
    ("14 Sicilian Dragon-Âàðèàíò", "14 Sicilian Dragon-Вариант"),
])
def test_repairs_cp1251_read_as_latin(broken, fixed):
    assert library.repair_text(broken) == fixed


@pytest.mark.parametrize("text", ["Müller", "Réti, Richard", "Göteborg", "Ботвинник", "Przepiórka, Dawid", "Ståhlberg",
                                  "São Paulo", "1.e4 e5 2.Nf3", ""])
def test_keeps_correct_text(text):
    assert library.repair_text(text) == text


def test_pgn_import_repairs_headers():
    pgn = '[White "Øàáàëîâ, À"]\n[Black "Âîëüô, Ï"]\n[Event "Ñëàâÿíñêàÿ çàùèòà"]\n[Result "*"]\n\n1. d4 d5 *\n'
    parsed = library.parse_game(next(library.read_text(pgn)))
    assert (parsed.white, parsed.black, parsed.event) == ("Шабалов, А", "Вольф, П", "Славянская защита")


def test_cbh_text_decides_per_string():
    """В базе с латинскими именами (cp1252) русская строка всё равно читается как cp1251."""
    assert cbh_reader._text("Сицилианская".encode("cp1251") + b"\x00", "cp1252") == "Сицилианская"
    assert cbh_reader._text("Müller".encode("cp1252"), "cp1252") == "Müller"
