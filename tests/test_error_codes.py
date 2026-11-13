# --- FILE: tests/test_error_codes.py ---
"""
Ошибки для клиента — коды, а не тексты (таск 11.0b).

* Реестр src/core/errors.py совпадает с разделом serverErrors в трёх каталогах клиента: одни и те же коды
  и одни и те же параметры шаблонов. Новый код без перевода (или перевод без кода) этот тест уронит.
* Каждый код, который сервер где-то отдаёт, есть в реестре, и каждый код реестра где-то используется.
* Форматы ответов: HTTP — {"detail": {"code", "params", "message"}}, 422 — список без эха присланных значений,
  429 — с параметром retry_after, WebSocket — событие error с кодом.
"""

import ast
import pathlib
import re
import string

import pytest

from src.core.errors import (
    ERROR_MESSAGES,
    ApiError,
    DomainError,
    error_payload,
    template_params,
    validation_error,
    validation_error_items,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOGS = ROOT / "frontend" / "src" / "i18n" / "messages"
LANGUAGES = ("en", "uk", "ru")


def _catalog_section(language: str, section: str) -> dict[str, str]:
    text = (CATALOGS / f"{language}.ts").read_text(encoding="utf-8")
    match = re.search(rf"^    {section}: \{{\n(.*?)^    \}},$", text, re.M | re.S)
    assert match, f"{language}.ts: нет раздела {section}"
    entries = {}
    for key, value in re.findall(r"^        (\w+): '((?:[^'\\]|\\.)*)',$", match.group(1), re.M):
        entries[key] = value.replace("\\'", "'")
    return entries


def _placeholders(template: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(template) if name}


# --- реестр и каталоги ----------------------------------------------------------------------------------------

@pytest.mark.parametrize("language", LANGUAGES)
def test_catalog_has_exactly_the_registry_codes(language):
    assert set(_catalog_section(language, "serverErrors")) == set(ERROR_MESSAGES)


@pytest.mark.parametrize("language", LANGUAGES)
def test_catalog_texts_use_the_same_params_as_the_registry(language):
    catalog = _catalog_section(language, "serverErrors")
    for code in ERROR_MESSAGES:
        assert _placeholders(catalog[code]) == template_params(code), f"{language}: {code}"


def _codes_used_in_source() -> set[str]:
    """Коды из вызовов, которые создают ошибки для клиента, и из полей "code"/reason ответов."""
    positional = {
        "ApiError": 1, "error_payload": 0, "validation_error": 0, "DomainError": 0, "DomainValueError": 0,
        "MatchmakingError": 0, "GameNotFinishedError": 0, "GameDataNotFoundError": 0,
        "InvalidStartPositionError": 0, "PuzzleError": 0, "error": 0, "enforce_rate_limit": 4,
        "ensure_below_limit": 4,
    }
    used: set[str] = set()
    for path in (ROOT / "src").rglob("*.py"):
        if path.name == "errors.py":
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call):
                func = node.func
                name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else ""
                index = positional.get(name)
                if name == "error" and not (isinstance(func, ast.Attribute) and getattr(func.value, "id", "") == "ctx"):
                    index = None  # logger.error и т. п. — не ошибка для клиента
                if index is not None and len(node.args) > index:
                    arg = node.args[index]
                    # ctx.error(result.get("code", "запасной_код")) — запасной код тоже отдаётся клиенту.
                    if (isinstance(arg, ast.Call) and getattr(arg.func, "attr", "") == "get" and len(arg.args) == 2
                            and getattr(arg.args[0], "value", None) == "code"):
                        arg = arg.args[1]
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        used.add(arg.value)
                for keyword in node.keywords:
                    if keyword.arg == "reason" and isinstance(keyword.value, ast.Constant) and name == "SkippedPersonality":
                        used.add(keyword.value.value)
            if isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values, strict=True):
                    if getattr(key, "value", None) == "code" and isinstance(value, ast.Constant):
                        used.add(value.value)
    return used


def test_every_code_in_source_is_registered_and_every_registered_code_is_used():
    used = _codes_used_in_source()
    assert used - set(ERROR_MESSAGES) == set(), "коды без записи в реестре"
    assert set(ERROR_MESSAGES) - used == set(), "коды реестра, которые сервер никогда не отдаёт"


# --- построение ошибок ------------------------------------------------------------------------------------------

def test_payload_carries_code_params_and_english_message():
    assert error_payload("rating_out_of_range", rating=1500, min=1600, max=1800) == {
        "code": "rating_out_of_range",
        "params": {"rating": 1500, "min": 1600, "max": 1800},
        "message": "Your rating 1500 is outside the challenge range (1600–1800)",
    }


def test_unknown_code_and_missing_params_are_programming_errors():
    with pytest.raises(KeyError):
        error_payload("no_such_code")
    with pytest.raises(KeyError):
        error_payload("user_not_found")  # нет username


def test_english_messages_contain_no_cyrillic():
    assert not [code for code, text in ERROR_MESSAGES.items() if re.search(r"[Ѐ-ӿ]", text)]


def test_domain_error_converts_to_http_with_the_same_code():
    http = DomainError("game_not_finished", game_id=7).to_http(409)
    assert isinstance(http, ApiError)
    assert http.status_code == 409
    assert http.detail == error_payload("game_not_finished", game_id=7)


def test_validation_error_items_drop_input_and_keep_params():
    items = validation_error_items([
        {"type": "string_too_short", "loc": ("body", "password"), "msg": "too short",
         "input": "secret", "ctx": {"min_length": 8}},
        {"type": "username_mixed_scripts", "loc": ("body", "username"), "msg": "x", "input": "Мorphy"},
    ])
    assert items == [
        {"type": "string_too_short", "loc": ["body", "password"], "msg": "too short", "params": {"min_length": 8}},
        {"type": "username_mixed_scripts", "loc": ["body", "username"], "msg": "x", "params": {}},
    ]


def test_validation_error_formats_params_like_the_registry():
    error = validation_error("personality_limit", max=20)
    assert error.type == "personality_limit"
    assert error.message() == "No more than 20 opponents in the workshop — delete some"


# --- ответы API -------------------------------------------------------------------------------------------------

def test_http_error_body(client):
    response = client.get("/api/v1/profile/nobody_like_this")
    assert response.status_code == 404
    assert response.json() == {"detail": error_payload("user_not_found", username="nobody_like_this")}


def test_422_has_codes_and_does_not_echo_the_password(client):
    response = client.post("/api/v1/auth/register", json={"username": "Мorphy", "password": "pw7Zq"})
    assert response.status_code == 422
    assert "pw7Zq" not in response.text and "Мorphy" not in response.text  # присланное не возвращается
    by_field = {item["loc"][-1]: item for item in response.json()["detail"]}
    assert by_field["username"]["type"] == "username_mixed_scripts"
    assert by_field["password"]["type"] == "string_too_short"
    assert by_field["password"]["params"] == {"min_length": 8}


def test_429_has_retry_after_in_params_and_header(client, monkeypatch, freeze_rate_limit_window):
    from src.core.config import settings

    monkeypatch.setattr(settings, "RATE_LIMIT_REGISTER_PER_IP", 1)
    assert client.post("/api/v1/auth/register", json={"username": "first_one", "password": "secret123"}).status_code == 201
    limited = client.post("/api/v1/auth/register", json={"username": "second_one", "password": "secret123"})
    assert limited.status_code == 429
    detail = limited.json()["detail"]
    assert detail["code"] == "too_many_registrations"
    assert detail["params"]["retry_after"] == int(limited.headers["Retry-After"])


def test_login_failure_is_a_code(client):
    response = client.post("/api/v1/auth/login", data={"username": "ghost", "password": "whatever1"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "login_failed"
