# --- FILE: tests/test_no_russian_in_api.py ---
"""
Сервер не отдаёт пользователю русский текст (таск 11.0c): тексты на трёх языках собирает клиент из каталогов,
сервер шлёт коды, ключи и параметры.

* Исходники src: ни одной строки с кириллицей вне docstring, описаний полей для OpenAPI (description=),
  логов и print — это тексты для разработчиков, они пишутся по-русски. Исключение — регулярные выражения
  правил имени, которые кириллицу как раз разрешают.
* Исключение — тексты писем (src/services/mailer.py, таск 17.5): письмо читают в почтовом клиенте, каталогов
  фронтенда там нет, поэтому оно собирается на сервере на языке игрока; там же — все три языка.
* Данные, которые сервер отдаёт как есть (дебютные книги ботов), — без кириллицы.
* Ответы ключевых эндпоинтов ботов и лестницы — без кириллицы.
"""

import ast
import json
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
CYRILLIC = re.compile(r"[Ѐ-ӿ]")
LOG_METHODS = {"debug", "info", "warning", "error", "exception", "critical"}
# Имена игроков могут быть кириллическими — правило имени перечисляет буквы алфавита.
ALLOWED = {
    ("src/schemas/user.py", "[A-Za-z0-9А-Яа-яЁё_-]+"),
    ("src/schemas/user.py", "[А-Яа-яЁё]"),
}


def _developer_text_nodes(tree: ast.AST) -> set[int]:
    skip: set[int] = set()
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and body \
                and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
            skip.add(id(body[0].value))
        if isinstance(node, ast.Call):
            func = node.func
            developer_call = (isinstance(func, ast.Attribute) and func.attr in LOG_METHODS) or (
                isinstance(func, ast.Name) and func.id == "print")
            parts = list(node.args) if developer_call else []
            parts += [kw.value for kw in node.keywords if kw.arg == "description"]
            for part in parts:
                skip.update(id(inner) for inner in ast.walk(part))
    return skip


def _user_facing_cyrillic(path: pathlib.Path) -> list[str]:
    rel = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else path.name
    tree = ast.parse(path.read_text(encoding="utf-8"))
    skip = _developer_text_nodes(tree)
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and CYRILLIC.search(node.value) \
                and id(node) not in skip and (rel, node.value) not in ALLOWED:
            found.append(f"{rel}:{node.lineno}: {node.value[:80]}")
    return found


# Файлы, где тексты для людей на трёх языках живут на сервере по необходимости (см. описание модуля).
ALLOWED_FILES = {"src/services/mailer.py"}


def test_server_source_has_no_user_facing_russian():
    found = [line for path in sorted((ROOT / "src").rglob("*.py"))
             if path.relative_to(ROOT).as_posix() not in ALLOWED_FILES
             for line in _user_facing_cyrillic(path)]
    assert found == [], "\n" + "\n".join(found)


def test_guard_sees_strings_but_not_developer_text(tmp_path):
    probe = tmp_path / "probe.py"
    probe.write_text(
        '"""Модуль."""\n'
        'import logging\n'
        'logger = logging.getLogger(__name__)\n'
        'def f(x=None):\n'
        '    """Функция."""\n'
        '    logger.warning("Лог %s", x)\n'
        '    return {"comment": "Реплика"}\n',
        encoding="utf-8",
    )
    assert [line.split(": ", 1)[1] for line in _user_facing_cyrillic(probe)] == ["Реплика"]


def test_opening_books_have_no_russian():
    for book in sorted((ROOT / "src" / "services" / "bots" / "books").glob("*.json")):
        assert not CYRILLIC.search(book.read_text(encoding="utf-8")), book.name


def _assert_no_cyrillic(payload) -> None:
    text = json.dumps(payload, ensure_ascii=False)
    assert not CYRILLIC.search(text), text[:500]


@pytest.mark.parametrize("url", ["/api/v1/bots/catalog", "/api/v1/bots/list"])
def test_bot_catalogs_have_no_russian(client, url):
    response = client.get(url)
    assert response.status_code == 200
    _assert_no_cyrillic(response.json())


@pytest.mark.parametrize("bot_id", ["philidor", "labourdonnais", "staunton", "anderssen", "morphy", "paulsen", "zukertort"])
def test_bot_moves_answer_with_comment_keys(client, monkeypatch, bot_id):
    from src.services.bots import base as bots_base

    monkeypatch.setattr(bots_base, "analyse_with_stockfish", lambda **kwargs: {})
    monkeypatch.setattr(bots_base, "_simulate_human_thinking_time", lambda *args, **kwargs: 0.0)
    for fen in (
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",  # ход из книги
        "r1bq1rk1/pp3ppp/2n2n2/2bpp3/8/2NP1NP1/PPP1PPBP/R1BQ1RK1 w - - 0 9",  # ход по стилю
    ):
        response = client.post("/api/v1/bots/move", json={"bot_id": bot_id, "fen": fen})
        assert response.status_code == 200, response.text
        body = response.json()
        _assert_no_cyrillic(body)
        assert set(body["comment"]) == {"key", "params"}


def test_custom_bot_move_answers_with_a_comment_key(client, monkeypatch):
    from src.services.bots import base as bots_base

    monkeypatch.setattr(bots_base, "analyse_with_stockfish", lambda **kwargs: {})
    response = client.post("/api/v1/bots/custom-move", json={
        "fen": "r1bq1rk1/pp3ppp/2n2n2/2bpp3/8/2NP1NP1/PPP1PPBP/R1BQ1RK1 w - - 0 9",
    })
    assert response.status_code == 200, response.text
    _assert_no_cyrillic(response.json())
    assert response.json()["comment"]["key"].startswith("personality.")


def test_mail_templates_cover_every_language():
    from src.services.mailer import LANGUAGES, TEMPLATES

    for kind, by_language in TEMPLATES.items():
        assert set(by_language) == set(LANGUAGES), kind
        for subject, body in by_language.values():
            assert subject and "{link}" in body and "{hours}" in body and "{username}" in body
