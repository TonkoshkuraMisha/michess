# --- FILE: src/services/study_room.py ---
"""
Совместный разбор и занятие с тренером (таск 17.3). Комната живёт в Redis (TTL ROOM_TTL_S, продлевается при каждом
изменении): ведущий меняет доску (позиция, ходы, стрелки, подсветка, «призрачная» фигура), задаёт вопрос (ход или выбор
из вариантов, с таймером); участники раз в секунду спрашивают состояние (если версия не изменилась — ответ пустой),
пишут в чат и отвечают на вопрос. Тексты в комнате — ввод людей (чат, вопрос ведущего), строк интерфейса тут нет.
"""

import json
import secrets
import time

import chess

from src.core.errors import DomainError
from src.db import redis as redis_module

ROOM_TTL_S = 6 * 3600
CHAT_KEEP = 50
MAX_TEXT = 300
MAX_ARROWS = 24
MAX_HIGHLIGHTS = 32
MAX_OPTIONS = 6
COLORS = ("green", "red", "blue", "yellow")
TONES = ("light", "dark")
PRESENCE_S = 15


def _key(code: str) -> str:
    return f"study:{code}"


async def _load(code: str) -> dict:
    raw = await redis_module.redis_client.get(_key(code))
    if not raw:
        raise DomainError("study_room_not_found")
    return json.loads(raw)


async def _save(code: str, room: dict) -> None:
    await redis_module.redis_client.set(_key(code), json.dumps(room), ex=ROOM_TTL_S)


def _bump(room: dict) -> None:
    room["version"] = int(room.get("version", 0)) + 1


def _host(room: dict, user_id: int) -> None:
    if room["host_id"] != user_id:
        raise DomainError("study_host_only")


def _clean_board(state: dict) -> dict:
    """Проверенная позиция доски: FEN (возможная по правилам), стрелки, подсветка, призрак."""
    fen = str(state.get("fen", ""))
    try:
        board = chess.Board(fen)
    except ValueError:
        raise DomainError("study_bad_position") from None
    if not board.is_valid():
        raise DomainError("study_bad_position")
    square = set(chess.SQUARE_NAMES)
    arrows = [{"from": a["from"], "to": a["to"], "color": a.get("color") if a.get("color") in COLORS else "green"}
              for a in (state.get("arrows") or [])[:MAX_ARROWS]
              if isinstance(a, dict) and a.get("from") in square and a.get("to") in square]
    highlights = [{"square": h["square"], "tone": h.get("tone") if h.get("tone") in TONES else "light"}
                  for h in (state.get("highlights") or [])[:MAX_HIGHLIGHTS]
                  if isinstance(h, dict) and h.get("square") in square]
    ghost = state.get("ghost")
    if not (isinstance(ghost, dict) and ghost.get("square") in square and str(ghost.get("piece", ""))[:2] in
            {c + p for c in "wb" for p in "KQRBNP"}):
        ghost = None
    return {"fen": board.fen(), "last_move": str(state.get("last_move") or "")[:5] or None,
            "arrows": arrows, "highlights": highlights, "ghost": ghost}


async def create(host_id: int, username: str) -> dict:
    code = secrets.token_urlsafe(6).replace("-", "a").replace("_", "b")[:8]
    room = {"code": code, "host_id": host_id, "host": username, "version": 1, "created_at": time.time(),
            "board": {"fen": chess.STARTING_FEN, "last_move": None, "arrows": [], "highlights": [], "ghost": None},
            "chat": [], "question": None, "answers": {}, "seen": {}}
    await _save(code, room)
    return view(room, host_id)


def view(room: dict, user_id: int | None) -> dict:
    """
    Состояние комнаты для участника: доска, чат, присутствующие и вопрос без верного ответа (ответ виден после
    раскрытия). Ведущий дополнительно видит ответы участников.
    """
    now = time.time()
    present = sorted(name for name, seen in room.get("seen", {}).items() if now - seen < PRESENCE_S)
    question = room.get("question")
    public_question = None
    if question:
        public_question = {k: v for k, v in question.items() if k != "correct"}
        if question.get("revealed"):
            public_question["correct"] = question.get("correct")
    data = {"code": room["code"], "host": room["host"], "is_host": user_id == room["host_id"],
            "version": room["version"], "board": room["board"], "chat": room["chat"], "question": public_question,
            "participants": present}
    if user_id == room["host_id"] and question:
        data["answers"] = room.get("answers", {})
        data["question"] = question
    elif user_id is not None and question:
        data["my_answer"] = room.get("answers", {}).get(str(user_id), {}).get("answer")
    return data


async def poll(code: str, user_id: int, username: str, since: int) -> dict | None:
    """Состояние комнаты, если версия новее since (иначе None); отмечает участника присутствующим."""
    room = await _load(code)
    room.setdefault("seen", {})[username] = time.time()
    await _save(code, room)
    if room["version"] <= since and user_id != room["host_id"]:
        return None
    return view(room, user_id)


async def set_board(code: str, user_id: int, state: dict) -> dict:
    room = await _load(code)
    _host(room, user_id)
    room["board"] = _clean_board(state)
    _bump(room)
    await _save(code, room)
    return view(room, user_id)


async def say(code: str, user_id: int, username: str, text: str) -> dict:
    """Сообщение в чат комнаты; хранятся последние CHAT_KEEP сообщений."""
    room = await _load(code)
    message = " ".join(text.split())[:MAX_TEXT]
    if not message:
        raise DomainError("study_empty_message")
    room["chat"] = (room["chat"] + [{"from": username, "text": message, "at": time.time()}])[-CHAT_KEEP:]
    _bump(room)
    await _save(code, room)
    return view(room, user_id)


async def ask(code: str, user_id: int, question: dict) -> dict:
    """Вопрос ведущего: kind=move (ответ — ход на своей доске; correct — список ходов UCI) или choice (варианты)."""
    room = await _load(code)
    _host(room, user_id)
    kind = question.get("kind")
    prompt = " ".join(str(question.get("prompt", "")).split())[:MAX_TEXT]
    seconds = max(10, min(int(question.get("seconds") or 60), 600))
    if kind == "choice":
        options = [" ".join(str(o).split())[:80] for o in (question.get("options") or [])][:MAX_OPTIONS]
        correct = question.get("correct")
        if len(options) < 2 or not isinstance(correct, int) or not 0 <= correct < len(options):
            raise DomainError("study_bad_question")
        clean = {"kind": "choice", "options": options, "correct": correct}
    elif kind == "move":
        board = chess.Board(room["board"]["fen"])
        moves = [m for m in (question.get("correct") or []) if isinstance(m, str)]
        legal = {m.uci() for m in board.legal_moves}
        if not moves or any(m not in legal for m in moves):
            raise DomainError("study_bad_question")
        clean = {"kind": "move", "correct": moves}
    else:
        raise DomainError("study_bad_question")
    room["question"] = {**clean, "id": secrets.token_hex(4), "prompt": prompt, "deadline": time.time() + seconds,
                        "revealed": False}
    room["answers"] = {}
    _bump(room)
    await _save(code, room)
    return view(room, user_id)


async def answer(code: str, user_id: int, username: str, value: str | int) -> dict:
    """Ответ участника на вопрос ведущего: один раз, пока идёт время и ответ не раскрыт."""
    room = await _load(code)
    question = room.get("question")
    if not question or question.get("revealed") or time.time() > question["deadline"]:
        raise DomainError("study_question_closed")
    if str(user_id) in room["answers"] or user_id == room["host_id"]:
        raise DomainError("study_question_closed")
    correct = (value in question["correct"]) if question["kind"] == "move" else (value == question["correct"])
    room["answers"][str(user_id)] = {"name": username, "answer": value, "correct": bool(correct), "at": time.time()}
    _bump(room)
    await _save(code, room)
    return view(room, user_id)


async def reveal(code: str, user_id: int) -> dict:
    """Ведущий раскрывает верный ответ на вопрос."""
    room = await _load(code)
    _host(room, user_id)
    if not room.get("question"):
        raise DomainError("study_question_closed")
    room["question"]["revealed"] = True
    _bump(room)
    await _save(code, room)
    return view(room, user_id)
