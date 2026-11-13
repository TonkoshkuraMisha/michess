# --- FILE: src/core/errors.py ---
"""
Ошибки для клиента: код + параметры, а не готовый текст.

Сервер не знает языка игрока — текст собирает клиент из каталогов сообщений на трёх языках
(frontend/src/i18n/messages/*.ts, раздел serverErrors). Здесь у каждого кода есть английский
шаблон: он уходит в поле `message` для логов, внешних клиентов API и на случай, если клиент
устарел и кода ещё не знает. Тест tests/test_error_codes.py сверяет реестр с каталогами клиента:
коды и параметры шаблонов должны совпадать.

Формат ответа HTTP: {"detail": {"code": "...", "params": {...}, "message": "..."}}.
Формат события WebSocket: {"event": "error", "code": "...", "params": {...}, "message": "..."}.
Ошибки валидации запроса (422) — список {"type", "loc", "msg", "params"}; собственные проверки
схем используют коды этого же реестра в поле type (validation_error()).
"""

import string
from typing import Any

from fastapi import HTTPException
from pydantic_core import PydanticCustomError

ERROR_MESSAGES: dict[str, str] = {
    # --- общее ------------------------------------------------------------------------------
    "internal_error": "Internal server error",
    "not_authenticated": "Could not validate credentials",
    "rate_limited": "Too many actions in a row, please wait a moment",
    "message_too_large": "The message is too long",
    "engine_busy": "The engine is busy, please retry in a few seconds",
    "engine_rate_limited": "Too many engine requests, please try again in {retry_after} s",
    "engine_locked_in_game": "Engine analysis and hints are unavailable during a game against a person",
    "engine_locked_guest_ip": "A game against a person is in progress from this address — log in to use the engine",
    # --- вход и регистрация --------------------------------------------------------------------
    "too_many_registrations": "Too many registrations from this address, please try again in {retry_after} s",
    "too_many_login_attempts": "Too many login attempts, please try again in {retry_after} s",
    "account_login_locked": "Too many failed login attempts for this account, please try again in {retry_after} s",
    "too_many_reconnects": "Too many reconnects, please try again in {retry_after} s",
    "too_many_password_attempts": "Too many failed attempts, please try again in {retry_after} s",
    "username_reserved": "This name is reserved for a historical bot or a service page",
    "username_taken": "This username is already taken",
    "login_failed": "Incorrect username or password",
    "wrong_current_password": "The current password is incorrect",
    "username_invalid_chars": "A name may contain only letters (Latin or Cyrillic), digits, “_” and “-”",
    "username_mixed_scripts": "A name cannot mix Latin and Cyrillic letters",
    "username_no_letters": "A name must contain at least one letter",
    # --- позиции и партии ----------------------------------------------------------------------
    "invalid_fen": "Invalid FEN",
    "invalid_position": "The position is impossible under the rules of chess",
    "game_already_over": "The game is already over in this position",
    "invalid_history_move": "Invalid move in the history: {move}",
    "illegal_move": "Illegal move in this position: {move}",
    "puzzle_not_found": "Puzzle not found",
    "puzzle_not_active": "This puzzle is no longer active: open the next one",
    "no_puzzles_available": "No suitable puzzles right now",
    "unknown_theme": "Unknown theme: {theme}",
    "invalid_timed_minutes": "A timed run lasts 3 or 5 minutes",
    "timed_run_not_active": "No timed run in progress: start a new one",
    "timed_run_over": "The timed run is over",
    "training_target_required": "Choose either a theme or a section",
    "unknown_section": "Unknown section: {section}",
    "invalid_stage": "A stage is from 1 to 4",
    "illegal_history_move": "Illegal move in the history: {move}",
    "empty_moves": "The move list is empty",
    "invalid_player_color": "Invalid player color",
    "invalid_result": "Invalid game result",
    "flag_winner_required": "For a flag fall, specify which side won on time",
    "termination_required": "The game is not over on the board: specify termination ('resignation' or 'timeout')",
    "game_not_found": "Game {game_id} not found",
    "game_not_finished": "Game {game_id} is not finished yet",
    "pgn_not_found": "Game {game_id} or its PGN not found",
    "pgn_parse_failed": "Could not parse the game PGN",
    "game_init_failed": "Could not initialize the game state",
    "user_not_found": "User {username} not found",
    # --- боты, мастерская, лестница ----------------------------------------------------------------
    "bot_not_found": "Bot '{bot_id}' not found",
    "config_or_personality": "Specify either config or personality_id, not both",
    "login_required_for_personality": "Log in to play against a saved opponent",
    "custom_opponent_missing": "A workshop opponent needs a personality_id or a name",
    "ladder_game_missing": "The ladder game was not started or is out of date",
    "ladder_game_mismatch": "The game does not match the open ladder game",
    "personality_limit": "No more than {max} opponents in the workshop — delete some",
    "personality_duplicate": "An opponent with this name already exists",
    "personality_name_reserved": "This name belongs to a historical bot or a champion",
    "personality_not_found": "Opponent not found",
    # --- матчмейкинг и вызовы ----------------------------------------------------------------------
    "invalid_time_control": "Invalid time control",
    "self_in_game": "You are already playing a game",
    "opponent_in_game": "The opponent is already playing another game",
    "players_busy": "The player is already starting another game, please try again",
    "self_play": "You cannot play against yourself",
    "player_not_found": "Player not found",
    "own_challenge": "You cannot accept your own challenge",
    "challenge_gone": "The challenge is no longer active or was accepted by another player",
    "rating_out_of_range": "Your rating {rating} is outside the challenge range ({min}–{max})",
    "invite_invalid": "The invitation is invalid or has expired",
    # --- действия в партии (WebSocket) ----------------------------------------------------------------
    "spectate_unavailable": "The game is already over or was not found",
    "chat_forbidden": "Only the players of the game can write in its chat",
    "draw_offer_too_soon": "A draw can be offered once per move",
    "game_not_in_progress": "The game is not in progress",
    "abort_too_late": "The game can only be aborted before move 2",
    "no_draw_offer": "There is no draw offer to accept",
    "no_rematch_offer": "There is no rematch offer to accept",
}


def template_params(code: str) -> set[str]:
    """Имена параметров в английском шаблоне кода."""
    return {name for _, name, _, _ in string.Formatter().parse(ERROR_MESSAGES[code]) if name}


def error_payload(code: str, **params: Any) -> dict[str, Any]:
    """Тело ошибки для клиента; неизвестный код — ошибка программиста, а не игрока."""
    if code not in ERROR_MESSAGES:
        raise KeyError(f"Unknown error code: {code}")
    missing = template_params(code) - params.keys()
    if missing:
        raise KeyError(f"Error code {code} needs params: {sorted(missing)}")
    return {"code": code, "params": params, "message": ERROR_MESSAGES[code].format(**params)}


class DomainError(Exception):
    """
    Ожидаемый отказ бизнес-логики с кодом для клиента. Сервисы бросают его, не зная про HTTP;
    API превращает в ответ нужного статуса через to_http().
    """

    def __init__(self, code: str, **params: Any):
        self.payload = error_payload(code, **params)
        super().__init__(self.payload["message"])

    @property
    def code(self) -> str:
        return self.payload["code"]

    @property
    def params(self) -> dict[str, Any]:
        return self.payload["params"]

    @property
    def message(self) -> str:
        return self.payload["message"]

    def to_http(self, status_code: int, headers: dict[str, str] | None = None) -> HTTPException:
        return ApiError(status_code, self.code, headers=headers, **self.params)


class DomainValueError(DomainError, ValueError):
    """Некорректные входные данные (позиция, ходы, PGN): код для клиента и совместимость с ValueError."""


class ApiError(HTTPException):
    """HTTPException с кодом: detail = {"code", "params", "message"}."""

    def __init__(self, status_code: int, code: str, *, headers: dict[str, str] | None = None, **params: Any):
        payload = error_payload(code, **params)
        super().__init__(status_code=status_code, detail=payload, headers=headers)
        self.code = code
        self.params = params


def validation_error(code: str, **params: Any) -> PydanticCustomError:
    """Ошибка собственной проверки схемы: в ответе 422 её type — код реестра, params — параметры."""
    error_payload(code, **params)  # проверка кода и параметров
    # Шаблон {name} pydantic подставляет из context сам — тем же синтаксисом, что и у нас.
    return PydanticCustomError(code, ERROR_MESSAGES[code], params or None)


def validation_error_items(errors: Any) -> list[dict[str, Any]]:
    """
    Ошибки валидации запроса для ответа 422: тип (для своих проверок — код реестра), путь к полю,
    английский текст и параметры проверки (ограничения min_length, ge и т. п.). Присланное значение
    (input) не возвращается.
    """
    items = []
    for error in errors:
        ctx = error.get("ctx") or {}
        params = {key: value for key, value in ctx.items() if isinstance(value, (str, int, float, bool))}
        items.append({
            "type": error.get("type", "value_error"),
            "loc": [part for part in error.get("loc", ()) if isinstance(part, (str, int))],
            "msg": str(error.get("msg", "")),
            "params": params,
        })
    return items
