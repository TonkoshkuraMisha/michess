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
    "daily_limit_reached": "The free daily limit of {limit} is used up, it renews in {hours} h",
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
    "guess_position_not_found": "Position not found",
    "career_stage_unknown": "Unknown career tournament",
    "time_machine_event_unknown": "There is no such historical tournament",
    "career_stage_locked": "This career tournament is not open yet",
    "trainer_not_found": "Unknown trainer",
    "cannot_follow_self": "You cannot follow yourself",
    "cannot_challenge_self": "You cannot challenge yourself",
    "cannot_message_self": "You cannot write to yourself",
    "cannot_block_self": "You cannot block yourself",
    "dm_closed": "This player does not accept messages from you",
    "dm_you_blocked": "You have blocked this player: unblock them to write",
    "dm_chat_banned": "Writing messages is suspended for you by a moderator for now",
    "dm_empty": "The message is empty",
    "attachment_invalid": "This game, position or material cannot be attached",
    "posting_banned": "A moderator has suspended your posts and comments for now",
    "post_empty": "The post is empty",
    "post_not_found": "Post not found",
    "comment_empty": "The comment is empty",
    "comment_closed": "The author does not accept comments from you",
    "comment_not_found": "Comment not found",
    "text_flagged": "This text looks offensive. Please rephrase it — or send it for a moderator to review",
    "posting_limited": "New players and players warned by a moderator can send at most {limit} of these per hour",
    "arena_not_found": "Arena not found",
    "team_not_found": "Team not found",
    "report_invalid": "Invalid report",
    "report_self": "You cannot report yourself",
    "report_duplicate": "You already have an open report here",
    "report_not_found": "Report not found or already resolved",
    "appeal_not_flagged": "Your account is not flagged",
    "moderator_only": "Moderators only",
    "terms_not_accepted": "Accept the community rules and privacy summary to register",
    "registration_invite_required": "Registration is by invitation only: enter your invite code",
    "registration_invite_invalid": "This invite code is invalid, expired or already used up",
    "beta_invite_not_found": "Invite not found",
    "feedback_not_found": "Message not found",
    "feedback_invalid": "Invalid message",
    "too_many_feedback": "Too many messages, please try again in {retry_after} s",
    "too_many_invite_checks": "Too many attempts, please try again in {retry_after} s",
    "translation_helper_off": "Turn on translation helper mode in your profile first",
    "blindfold_not_allowed": "Blindfold play is only for unrated games",
    "mini_game_not_found": "No such game",
    "mini_game_bad_position": "Invalid position for this game",
    "mini_game_illegal_move": "This move is not allowed by the rules of the game",
    "mini_game_over": "The game is already over",
    "mini_room_not_found": "This game room does not exist or has expired",
    "mini_room_full": "Both seats in this game are already taken",
    "mini_room_not_player": "You are not playing in this game",
    "mini_room_waiting": "Wait for the opponent to join",
    "mini_room_not_your_turn": "It is not your turn",
    "mini_room_stale": "The position has changed: the move was already made",
    "mini_room_busy": "The game is busy, try again",
    "mini_room_in_progress": "The game is not over yet",
    "chess960_bad_position": "There is no such starting position (0-959)",
    "exam_section_unknown": "There is no such exam test",
    "exam_section_empty": "There are no positions for this test yet",
    "exam_question_unknown": "This position is not part of this test",
    "repertoire_not_found": "Repertoire not found",
    "library_collection_not_found": "Collection not found",
    "library_game_not_found": "Game not found in the library",
    "repertoire_starter_not_found": "No such starter repertoire",
    "repertoire_limit": "You can have at most {limit} repertoires",
    "repertoire_too_large": "A repertoire can hold at most {limit} moves",
    "repertoire_bad_pgn": "No lines from the initial position were found in this PGN",
    "repertoire_move_not_found": "This move is not in the repertoire",
    "chat_banned": "Chat is disabled for you for now",
    "study_room_not_found": "Study room not found",
    "study_host_only": "Only the host can do this",
    "study_bad_position": "This position is not possible",
    "study_empty_message": "The message is empty",
    "study_bad_question": "The question needs correct answers",
    "study_question_closed": "The question is closed",
    "study_bad_material": "A lesson needs 1 to {max} steps",
    "study_material_not_found": "Material not found",
    "team_name_invalid": "A team name must be {min} to {max} characters long",
    "team_name_taken": "This team name is already taken",
    "team_already_member": "You are already in a team",
    "team_not_member": "You are not in a team",
    "arena_finished": "This arena is over",
    "arena_not_running": "This arena is not running",

    "arena_pairing_closed": "The last start of this arena has passed: the remaining games are being finished",
    "arena_no_abort": "An arena game cannot be aborted: a missing first move counts as a loss",
    "arena_fair_play": "Arenas are closed while your account is flagged by the fair-play system",
    "arena_not_joined": "Join the arena first",
    "match_entry_closed": "Entry to this conference match is closed: the line-ups are set",
    "match_no_conference": "Choose your country in the profile to play for your conference",
    "match_wrong_conference": "Only players of the two conferences of this match can enter it",
    "berserk_unavailable": "Berserk is not available in this game",
    "berserk_too_late": "Berserk is only possible before your first move",
    "arena_reminder_too_late": "This arena has already started",
    "country_unknown": "Unknown country code",
    "country_change_too_soon": "You can change your conference once a season: the next change is possible next month",
    "tablebase_unavailable": "Endgame tables are unavailable, please try again later",
    "tablebase_too_many_pieces": "Endgame tables cover at most {max} pieces",
    "puzzle_not_active": "This puzzle is no longer active: open the next one",
    "no_puzzles_available": "No suitable puzzles right now",
    "unknown_theme": "Unknown theme: {theme}",
    "invalid_timed_minutes": "A timed run lasts 3 or 5 minutes",
    "timed_run_not_active": "No timed run in progress: start a new one",
    "timed_run_over": "The timed run is over",
    "training_target_required": "Choose either a theme or a section",
    "unknown_section": "Unknown section: {section}",
    "unknown_goal": "Unknown goal: {goal}",
    "invalid_stage": "A stage is from 1 to 4",
    "unknown_drill_kind": "Unknown exercise type: {kind}",
    "drill_not_active": "This exercise is no longer active: open the next one",
    "drill_wrong_step": "This step of the exercise is already done",
    "invalid_square": "Invalid square: {square}",
    "drill_not_a_choice": "Choose one of the three offered moves",
    "unknown_drill": "Unknown exercise: {drill}",
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
    "guest_not_found": "There is no such master of the past",
    "config_or_personality": "Specify either config or personality_id, not both",
    "bot_opening_unknown": "This opening is not in the openings table",
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
    # --- турниры ---------------------------------------------------------------------------------------
    "account_in_game": "Finish your current game before deleting the account",
    "email_taken": "This e-mail is already linked to another account",
    "email_link_invalid": "The link is invalid, expired or already used",
    "too_many_emails": "Too many letters requested, try again later",
    "lesson_progress_limit": "Too many lessons in progress (limit {max})",
    "tournament_not_found": "Tournament not found",
    "tournament_active_exists": "This career step already has a tournament in progress — finish it first",
    "tournament_size_invalid": "This format needs {sizes} participants",
    "tournament_participants_count": "Choose {expected} opponents",
    "tournament_participant_unknown": "Unknown participant: {participant}",
    "tournament_participant_duplicate": "A participant is listed twice: {participant}",
    "tournament_game_closed": "This tournament game is already finished",
    "tournament_game_mismatch": "The game does not match your tournament game",
    "tournament_game_not_started": "Start your tournament game from the tournament page",
    # --- импорт партий с других сайтов (таск 24.1) ----------------------------------------------------
    "import_rate_limited": "Too many imports, please try again in {retry_after} s",
    "import_source_unknown": "Unknown site",
    "import_username_invalid": "Enter a username from the site: letters, digits, “_” and “-”",
    "import_player_not_found": "No player with this username was found on the site",
    "import_source_busy": "The site limits requests right now, please try again in {retry_after} s",
    "import_source_unavailable": "The site did not respond, please try again later",
    "import_limit_reached": "You already have {max} imported games — delete some to import new ones",
    "import_pgn_too_large": "The PGN is too large (up to {max_kb} KB)",
    "import_pgn_empty": "No standard chess games with moves were found in the PGN",
    "import_player_not_in_pgn": "No game in the PGN has a player named “{player}”",
    "imported_game_not_found": "Imported game not found",
    # --- открытые данные (таск 24.3) ---------------------------------------------------------------------
    "public_api_rate_limited": "Too many requests to the public API, please try again in {retry_after} s",
    "calibration_run_not_found": "Calibration log not found",
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
