# --- FILE: src/services/coach.py ---
"""
Наставник словами (таск 11.2): из фактов детектора мотивов (src/services/mentor_service.py) и линии движка
собирается объяснение хода — что не так с ходом, что теперь грозит, в чём идея лучшего хода, — и стрелки для
доски.

Сервер не пишет текст: объяснение — список предложений ``{"key", "params"}``, ключи — шаблоны каталога
``coach`` на клиенте (три языка). У каждого шаблона несколько формулировок (``.v1``, ``.v2``); какую взять,
решает позиция, а не случай, поэтому один и тот же разбор всегда читается одинаково.

Фигуры и поля в параметрах — фигурной нотацией («♘f7», «♕d8»), как в шахматной литературе: она одинаково
читается на любом языке и не требует склонять названия фигур.

Главный принцип детектора остаётся: ложное объяснение хуже молчания. Мотив называется причиной ошибки,
только если его подтверждает лучший ответ соперника по движку (вилку — взятием одной из целей, висящую
фигуру — её взятием, мат — матующим ходом). Если подтверждения нет, наставник говорит только то, в чём уверен:
оценку хода и лучший ход.
"""

import zlib
from collections.abc import Iterable

import chess

from src.services.mentor_service import PIECE_VALUE, Motif, analyze_move, detect_motifs
from src.services.positional import move_idea, positional_features

# Формулировок на каждый шаблон: ключи «coach.<группа>.<код>.v1» … «.vN».
VARIANTS = 2

FIGURINES = {
    chess.WHITE: {chess.KING: "♔", chess.QUEEN: "♕", chess.ROOK: "♖", chess.BISHOP: "♗", chess.KNIGHT: "♘", chess.PAWN: "♙"},
    chess.BLACK: {chess.KING: "♚", chess.QUEEN: "♛", chess.ROOK: "♜", chess.BISHOP: "♝", chess.KNIGHT: "♞", chess.PAWN: "♟"},
}

# Шаблоны и их параметры: (группа, код) → имена параметров. Каталоги клиента обязаны иметь ровно эти ключи
# с ровно этими параметрами (tests/test_coach.py).
TEMPLATES: dict[tuple[str, str], tuple[str, ...]] = {
    # Оценка сделанного хода — первое предложение комментария к неточности, ошибке, зевку.
    ("verdict", "inaccuracy"): ("move",),
    ("verdict", "mistake"): ("move",),
    ("verdict", "blunder"): ("move",),
    # Что грозит стороне, которая ходит (после хода — сопернику сходившего; в совете — игроку).
    ("threat", "mate_in"): ("n", "move"),
    ("threat", "mate_threat"): ("piece", "square"),
    ("threat", "hanging"): ("piece",),
    ("threat", "fork"): ("attacker", "target1", "target2"),
    ("threat", "skewer"): ("attacker", "front", "behind"),
    ("threat", "pin_absolute"): ("attacker", "front", "behind"),
    ("threat", "pin_relative"): ("attacker", "front", "behind"),
    ("threat", "trapped"): ("piece",),
    ("threat", "overloaded"): ("defender", "target1", "target2"),
    ("threat", "back_rank"): ("king", "square"),
    # Упущенная возможность: она была до хода и пропала.
    ("missed", "mate_in"): ("n", "move"),
    ("missed", "hanging"): ("piece",),
    # Идея лучшего хода.
    ("best", "mate"): ("move",),
    ("best", "fork"): ("move", "attacker", "target1", "target2"),
    ("best", "skewer"): ("move", "attacker", "front", "behind"),
    ("best", "pin_absolute"): ("move", "attacker", "front", "behind"),
    ("best", "pin_relative"): ("move", "attacker", "front", "behind"),
    ("best", "discovered_attack"): ("move", "attacker", "target"),
    ("best", "discovered_check"): ("move", "attacker"),
    ("best", "double_check"): ("move",),
    ("best", "mate_threat"): ("move", "piece", "square"),
    ("best", "trapped"): ("move", "piece"),
    ("best", "capture"): ("move", "piece"),
    ("best", "generic"): ("move",),
    # Позиционная идея лучшего хода, когда тактики нет (таск B.4, src/services/positional.py).
    ("best", "pos_castle"): ("move",),
    ("best", "pos_open_file"): ("move", "file"),
    ("best", "pos_outpost"): ("move", "square"),
    ("best", "pos_king_active"): ("move",),
    ("best", "pos_passed_push"): ("move",),
    # Удачный ход с тактикой.
    ("good", "checkmate"): ("move",),
    ("good", "fork"): ("attacker", "target1", "target2"),
    ("good", "skewer"): ("attacker", "front", "behind"),
    ("good", "pin_absolute"): ("attacker", "front", "behind"),
    ("good", "pin_relative"): ("attacker", "front", "behind"),
    ("good", "discovered_attack"): ("attacker", "target"),
    ("good", "discovered_check"): ("attacker",),
    ("good", "double_check"): ("move",),
    ("good", "mate_threat"): ("piece", "square"),
    ("good", "trapped"): ("piece",),
    # Совет по позиции (POST /analysis/advice).
    ("advice", "chance_mate"): ("n", "move"),
    ("advice", "chance_capture"): ("piece",),
    ("advice", "quiet"): (),
    # Позиционные признаки, когда угроз нет (таск B.4).
    ("advice", "pos_king_center"): (),
    ("advice", "pos_passed_enemy"): ("square",),
    ("advice", "pos_passed_own"): ("square",),
    ("advice", "pos_king_active"): (),
    ("advice", "pos_open_file"): ("file",),
    ("advice", "pos_outpost"): ("square",),
    ("advice", "pos_isolated_enemy"): ("square",),
    ("advice", "pos_bad_bishop"): ("square",),
    ("advice", "pos_doubled_own"): ("file",),
    # Подсказка по ступеням (таск 11.4). Ступень 1 — намёк без полей и фигур, ступень 2 — какой фигурой ходить.
    ("hint", "mate"): ("n",),
    ("hint", "fork"): (),
    ("hint", "skewer"): (),
    ("hint", "pin_absolute"): (),
    ("hint", "pin_relative"): (),
    ("hint", "discovered_attack"): (),
    ("hint", "discovered_check"): (),
    ("hint", "double_check"): (),
    ("hint", "mate_threat"): (),
    ("hint", "trapped"): (),
    ("hint", "capture"): (),
    ("hint", "defend"): (),
    ("hint", "quiet"): (),
    ("hint", "piece"): ("piece",),
}

BAD_CLASSIFICATIONS = {"Inaccuracy": "inaccuracy", "Mistake": "mistake", "Blunder": "blunder"}
GOOD_CLASSIFICATIONS = {"Best", "Good"}

# Какую угрозу назвать первой, если ход позволил несколько: от самой опасной.
THREAT_PRIORITY = (
    "mate_in", "mate_threat", "fork", "skewer", "trapped", "hanging", "pin_absolute", "overloaded",
    "back_rank", "pin_relative",
)
# Идея лучшего хода / удачного хода: от самой сильной.
IDEA_PRIORITY = (
    "double_check", "discovered_check", "fork", "skewer", "mate_threat", "trapped", "discovered_attack",
    "pin_absolute", "pin_relative",
)


def all_message_keys() -> dict[str, tuple[str, ...]]:
    """Все ключи каталога, которые может отдать наставник, с их параметрами."""
    return {
        f"coach.{group}.{code}.v{variant}": params
        for (group, code), params in TEMPLATES.items()
        for variant in range(1, VARIANTS + 1)
    }


def _sentence(group: str, code: str, seed: str, **params: str | int) -> dict:
    expected = TEMPLATES[(group, code)]
    if set(params) != set(expected):
        raise KeyError(f"coach.{group}.{code}: params {sorted(params)} != {sorted(expected)}")
    variant = zlib.crc32(f"{seed}|{group}.{code}".encode()) % VARIANTS + 1
    return {"key": f"coach.{group}.{code}.v{variant}", "params": params}


def _arrow(from_square: chess.Square, to_square: chess.Square, kind: str) -> dict:
    return {"from": chess.square_name(from_square), "to": chess.square_name(to_square), "kind": kind}


def piece_label(board: chess.Board, square: chess.Square) -> str:
    """«♘f7» — фигура на поле фигурной нотацией (пустое поле — просто имя поля)."""
    piece = board.piece_at(square)
    name = chess.square_name(square)
    return f"{FIGURINES[piece.color][piece.piece_type]}{name}" if piece else name


def figurine_san(board: chess.Board, move: chess.Move) -> str:
    """SAN хода с фигурками вместо букв (Nf3 → ♘f3, e8=Q → e8=♕)."""
    san = board.san(move)
    figurines = FIGURINES[board.turn]
    letters = {"K": chess.KING, "Q": chess.QUEEN, "R": chess.ROOK, "B": chess.BISHOP, "N": chess.KNIGHT}
    if san[0] in letters:
        san = figurines[letters[san[0]]] + san[1:]
    if "=" in san:
        head, tail = san.split("=", 1)
        san = f"{head}={figurines[letters[tail[0]]]}{tail[1:]}"
    return san


def _move_from_motif(board: chess.Board, motif: Motif) -> chess.Move | None:
    """Ход из мотива мата (поле «откуда» и поле «куда»), если он легален в этой позиции."""
    if not motif.targets:
        return None
    for move in board.legal_moves:
        if move.from_square == motif.square and move.to_square == motif.targets[0]:
            return move
    return None


def _caused_by(motif: Motif, move: chess.Move, board_after: chess.Board) -> bool:
    """
    Мотив создан именно этим ходом: его ведёт пошедшая фигура, или ход открыл линию дальнобойной фигуре (ушёл
    с линии между ней и целью), или это вскрытие по определению. Мотив, который возник в позиции «сам» (король
    отошёл, и где-то на доске сложилась связка), идеей хода не считается.
    """
    if motif.code in ("discovered_attack", "discovered_check", "double_check"):
        return True
    if motif.code == "trapped":
        return motif.square in board_after.attacks(move.to_square)
    if motif.square == move.to_square:
        return True
    target = motif.targets[0] if motif.targets else None
    return target is not None and move.from_square in chess.SquareSet(chess.between(motif.square, target))


def _material_lost(motif: Motif, played: chess.Move, board_before: chess.Board) -> bool:
    """
    Незащищённая фигура — настоящая потеря, а не размен: если ход сам взял фигуру на этом поле, соперник
    отыгрывает её не с выигрышем, пока забранное не меньше того, что он выиграет взятием.
    """
    if motif.square != played.to_square or not board_before.is_capture(played):
        return True
    captured = board_before.piece_at(played.to_square)
    captured_value = PIECE_VALUE[captured.piece_type] if captured else PIECE_VALUE[chess.PAWN]  # на проходе
    return (motif.value or 0) > captured_value


def _first(motifs: Iterable[Motif], priority: tuple[str, ...]) -> list[Motif]:
    ranked = [m for m in motifs if m.code in priority]
    return sorted(ranked, key=lambda m: priority.index(m.code))


# --- описание мотивов ------------------------------------------------------------------------------------

def _tactic_params(board: chess.Board, motif: Motif) -> dict[str, str]:
    """Параметры шаблонов вилки, связки, сквозного удара, перегрузки, вскрытия (по позиции ``board``)."""
    code = motif.code
    if code == "fork":
        return {
            "attacker": piece_label(board, motif.square),
            "target1": piece_label(board, motif.targets[0]),
            "target2": piece_label(board, motif.targets[1]),
        }
    if code in ("skewer", "pin_absolute", "pin_relative"):
        return {
            "attacker": piece_label(board, motif.square),
            "front": piece_label(board, motif.targets[0]),
            "behind": piece_label(board, motif.targets[1]),
        }
    if code == "overloaded":
        return {
            "defender": piece_label(board, motif.square),
            "target1": piece_label(board, motif.targets[0]),
            "target2": piece_label(board, motif.targets[1]),
        }
    if code == "discovered_attack":
        return {"attacker": piece_label(board, motif.square), "target": piece_label(board, motif.targets[0])}
    if code == "discovered_check":
        return {"attacker": piece_label(board, motif.square)}
    if code == "mate_threat":
        return {"piece": piece_label(board, motif.square), "square": chess.square_name(motif.targets[0])}
    if code == "trapped":
        return {"piece": piece_label(board, motif.square)}
    return {}


def _tactic_arrows(motif: Motif, kind: str) -> tuple[list[dict], list[dict]]:
    """Стрелки «кто бьёт → что» и подсветка целей."""
    arrows: list[dict] = []
    highlights: list[dict] = []
    code = motif.code
    if code in ("fork", "discovered_attack"):
        arrows = [_arrow(motif.square, target, kind) for target in motif.targets[:2]]
        highlights = [{"square": chess.square_name(t), "kind": "target"} for t in motif.targets[:2]]
    elif code in ("skewer", "pin_absolute", "pin_relative"):
        arrows = [_arrow(motif.square, motif.targets[1], kind)]
        highlights = [{"square": chess.square_name(t), "kind": "target"} for t in motif.targets[:2]]
    elif code == "overloaded":
        highlights = [{"square": chess.square_name(motif.square), "kind": "target"}]
        highlights += [{"square": chess.square_name(t), "kind": "target"} for t in motif.targets[:2]]
    elif code in ("mate_threat", "mate_in"):
        arrows = [_arrow(motif.square, motif.targets[0], kind)]
    elif code == "discovered_check":
        if motif.targets:
            arrows = [_arrow(motif.square, motif.targets[0], kind)]
    elif code == "trapped":
        highlights = [{"square": chess.square_name(motif.square), "kind": "target"}]
    return arrows, highlights


# --- что грозит --------------------------------------------------------------------------------------------

def _confirmed_by_reply(motif: Motif, reply: chess.Move | None) -> bool:
    """
    Подтверждает ли лучший ответ соперника, что мотив — настоящая причина: ответ использует именно его.
    Без ответа движка (нет оценки) подтверждения нет — только мат, он не требует подтверждения.
    """
    if motif.code == "mate_in":
        return True
    if reply is None:
        return False
    to = reply.to_square
    if motif.code == "hanging":
        return to == motif.square
    if motif.code in ("fork", "overloaded", "skewer"):
        return to in motif.targets
    if motif.code in ("pin_absolute", "pin_relative"):
        return to == motif.targets[0]
    if motif.code == "trapped":
        return to == motif.square
    if motif.code == "back_rank":
        return to in motif.targets
    return False


def _threat_sentence(board: chess.Board, motif: Motif, seed: str) -> tuple[dict, list[dict], list[dict]]:
    """Предложение «что грозит» для стороны, которая не ходит (``motif.color`` — та, что ходит)."""
    code = motif.code
    if code == "mate_in":
        move = _move_from_motif(board, motif)
        sentence = _sentence("threat", "mate_in", seed, n=int(motif.value or 1),
                             move=figurine_san(board, move) if move else chess.square_name(motif.targets[0]))
        return sentence, [_arrow(motif.square, motif.targets[0], "threat")], []
    if code == "hanging":
        arrows = [_arrow(attacker, motif.square, "threat") for attacker in motif.targets[:1]]
        return (_sentence("threat", "hanging", seed, piece=piece_label(board, motif.square)), arrows,
                [{"square": chess.square_name(motif.square), "kind": "target"}])
    if code == "back_rank":
        king = motif.square
        return (_sentence("threat", "back_rank", seed, king=piece_label(board, king),
                          square=chess.square_name(motif.targets[0])), [],
                [{"square": chess.square_name(motif.targets[0]), "kind": "target"}])
    arrows, highlights = _tactic_arrows(motif, "threat")
    return _sentence("threat", code, seed, **_tactic_params(board, motif)), arrows, highlights


# --- комментарий к ходу партии --------------------------------------------------------------------------------

def _idea_of(board_before: chess.Board, move: chess.Move, before_motifs: list[Motif]) -> Motif | None:
    """Самая сильная тактика, которую создаёт сам ход (не существовавшая до него)."""
    board_after = board_before.copy(stack=False)
    board_after.push(move)
    facts = analyze_move(board_before, move, before_motifs=before_motifs)
    ideas = [m for m in _first(facts.created, IDEA_PRIORITY) if _caused_by(m, move, board_after)]
    return ideas[0] if ideas else None


def _best_idea(board_before: chess.Board, best: chess.Move, seed: str,
               before_motifs: list[Motif]) -> tuple[list[dict], list[dict], list[dict]]:
    """Предложения про упущенное и про лучший ход, стрелки и подсветка."""
    mover = board_before.turn
    sentences: list[dict] = []
    arrows = [_arrow(best.from_square, best.to_square, "best")]
    highlights: list[dict] = []
    move = figurine_san(board_before, best)

    board_after = board_before.copy(stack=False)
    board_after.push(best)
    if board_after.is_checkmate():
        return [_sentence("best", "mate", seed, move=move)], arrows, highlights

    # Упущенное: мат или незащищённая фигура, которые лучший ход и использует.
    for motif in before_motifs:
        if motif.color != mover:
            continue
        if motif.code == "mate_in" and best.from_square == motif.square:
            return [_sentence("missed", "mate_in", seed, n=int(motif.value or 1), move=move)], arrows, highlights
        if motif.code == "hanging" and best.to_square == motif.square:
            sentences.append(_sentence("missed", "hanging", seed, piece=piece_label(board_before, motif.square)))
            highlights.append({"square": chess.square_name(motif.square), "kind": "target"})
            break

    idea = _idea_of(board_before, best, before_motifs)
    if idea is not None:
        params = _tactic_params(board_after, idea)
        if idea.code == "double_check":
            params = {}
        sentences.append(_sentence("best", idea.code, seed, move=move, **params))
        idea_arrows, idea_highlights = _tactic_arrows(idea, "idea")
        arrows += idea_arrows
        highlights += idea_highlights
    elif not sentences:
        if board_before.is_capture(best):
            captured = board_before.piece_at(best.to_square)
            label = piece_label(board_before, best.to_square) if captured else chess.square_name(best.to_square)
            sentences.append(_sentence("best", "capture", seed, move=move, piece=label))
        else:
            positional = move_idea(board_before, best)
            if positional is not None:
                sentences.append(_sentence("best", f"pos_{positional.code}", seed, move=move, **positional.params))
            else:
                sentences.append(_sentence("best", "generic", seed, move=move))
    return sentences, arrows, highlights


def comment_for_move(
        board_before: chess.Board,
        played: chess.Move,
        best_uci: str | None,
        reply_uci: str | None,
        classification: str,
) -> dict | None:
    """
    Комментарий наставника к ходу партии: ``{"comment": [...], "arrows": [...], "highlights": [...]}`` или
    None, если сказать нечего (обычный хорошо сыгранный ход). ``best_uci`` — лучший ход движка в позиции до хода,
    ``reply_uci`` — лучший ответ соперника после сделанного хода (по нему проверяются причины ошибки).
    """
    if played not in board_before.legal_moves:
        return None
    seed = board_before.fen()
    move_label = figurine_san(board_before, played)
    before_motifs = detect_motifs(board_before)
    board_after = board_before.copy(stack=False)
    board_after.push(played)

    if classification in GOOD_CLASSIFICATIONS:
        if board_after.is_checkmate():
            return {"comment": [_sentence("good", "checkmate", seed, move=move_label)], "arrows": [], "highlights": []}
        facts = analyze_move(board_before, played, before_motifs=before_motifs)
        ideas = [m for m in _first(facts.created, IDEA_PRIORITY) if _caused_by(m, played, board_after)]
        if not ideas:
            return None
        idea = ideas[0]
        params = {"move": move_label} if idea.code == "double_check" else _tactic_params(board_after, idea)
        good_arrows, good_highlights = _tactic_arrows(idea, "idea")
        return {"comment": [_sentence("good", idea.code, seed, **params)],
                "arrows": good_arrows, "highlights": good_highlights}

    verdict = BAD_CLASSIFICATIONS.get(classification)
    if verdict is None:
        return None
    sentences = [_sentence("verdict", verdict, seed, move=move_label)]
    arrows: list[dict] = []
    highlights: list[dict] = []

    # Что грозит после хода — только подтверждённое ответом движка.
    reply = _legal(board_after, reply_uci)
    facts = analyze_move(board_before, played, before_motifs=before_motifs)
    for motif in _first(facts.allowed, THREAT_PRIORITY):
        if motif.code == "hanging" and not _material_lost(motif, played, board_before):
            continue
        if _confirmed_by_reply(motif, reply):
            sentence, threat_arrows, threat_highlights = _threat_sentence(board_after, motif, seed)
            sentences.append(sentence)
            arrows += threat_arrows
            highlights += threat_highlights
            break

    best = _legal(board_before, best_uci)
    if best is not None and best != played:
        idea_sentences, idea_arrows, idea_highlights = _best_idea(board_before, best, seed, before_motifs)
        sentences += idea_sentences
        arrows += idea_arrows
        highlights += idea_highlights
    return {"comment": sentences, "arrows": arrows, "highlights": highlights}


def _legal(board: chess.Board, uci: str | None) -> chess.Move | None:
    if not uci:
        return None
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return None
    return move if move in board.legal_moves else None


# --- совет по позиции ------------------------------------------------------------------------------------------

def advice_for_position(board: chess.Board, best_uci: str | None) -> dict:
    """
    Совет для стороны, которая ходит: что грозит ей (тактика соперника), что есть у неё самой (мат, незащищённая
    фигура соперника) и в чём идея лучшего хода. Без движка — только факты детектора.
    """
    seed = board.fen()
    mover = board.turn
    motifs = detect_motifs(board)
    sentences: list[dict] = []
    arrows: list[dict] = []
    highlights: list[dict] = []

    own = [m for m in motifs if m.color == mover]
    # Есть мат — больше ни о чём говорить не нужно.
    mate = next((m for m in own if m.code == "mate_in"), None)
    if mate is not None:
        move = _move_from_motif(board, mate)
        if move is not None:
            return {
                "comment": [_sentence("advice", "chance_mate", seed, n=int(mate.value or 1),
                                      move=figurine_san(board, move))],
                "arrows": [_arrow(move.from_square, move.to_square, "best")],
                "highlights": [],
            }

    # Что грозит игроку: тактика в пользу соперника (если бы ходил он).
    threats = [m for m in motifs if m.color != mover and m.code != "mate_in"]
    for motif in _first(threats, THREAT_PRIORITY):
        sentence, threat_arrows, threat_highlights = _threat_sentence(board, motif, seed)
        sentences.append(sentence)
        arrows += threat_arrows
        highlights += threat_highlights
        break

    best = _legal(board, best_uci)

    if best is not None:
        idea_sentences, idea_arrows, idea_highlights = _best_idea(board, best, seed, motifs)
        sentences += idea_sentences
        arrows += idea_arrows
        highlights += idea_highlights
    else:
        loose = next((m for m in own if m.code == "hanging"), None)
        if loose is not None:
            sentences.append(_sentence("advice", "chance_capture", seed, piece=piece_label(board, loose.square)))
            highlights.append({"square": chess.square_name(loose.square), "kind": "target"})

    # Угроз нет — одно слово о позиции: что важнее всего в структуре (таск B.4).
    if not any(m.color != mover and m.code != "mate_in" for m in motifs):
        features = positional_features(board, mover)
        if features:
            feature = features[0]
            sentences.append(_sentence("advice", f"pos_{feature.code}", seed, **feature.params))
            highlights += [{"square": chess.square_name(sq), "kind": "target"} for sq in feature.squares]

    if not sentences:
        sentences.append(_sentence("advice", "quiet", seed))
    return {"comment": sentences, "arrows": arrows, "highlights": highlights}


HINT_STEPS = 3


def _nudge(board: chess.Board, best: chess.Move | None, motifs: list[Motif], seed: str) -> dict:
    """Ступень 1: в чём суть позиции, без названия полей и фигур."""
    mover = board.turn
    own = [m for m in motifs if m.color == mover]
    mate = next((m for m in own if m.code == "mate_in"), None)
    if best is not None:
        after = board.copy(stack=False)
        after.push(best)
        if after.is_checkmate():
            return _sentence("hint", "mate", seed, n=1)
        if mate is not None and best.from_square == mate.square:
            return _sentence("hint", "mate", seed, n=int(mate.value or 1))
        idea = _idea_of(board, best, motifs)
        if idea is not None:
            return _sentence("hint", idea.code, seed)
        if any(m.code == "hanging" and m.square == best.to_square for m in own):
            return _sentence("hint", "capture", seed)
    elif mate is not None:
        return _sentence("hint", "mate", seed, n=int(mate.value or 1))
    elif any(m.code == "hanging" for m in own):
        return _sentence("hint", "capture", seed)
    if any(m.color != mover and m.code != "mate_in" for m in motifs):
        return _sentence("hint", "defend", seed)
    return _sentence("hint", "quiet", seed)


def hint_for_position(board: chess.Board, best_uci: str | None, step: int) -> dict:
    """
    Подсказка по ступеням: 1 — намёк словами (тема), 2 — какой фигурой ходить (поле подсвечено), 3 — полный совет со
    стрелкой лучшего хода. Ступени раньше третьей не раскрывают ход. Без лучшего хода (нет движка) вторая ступень
    невозможна — сразу полный совет по фактам детектора.
    """
    step = max(1, min(HINT_STEPS, step))
    seed = board.fen()
    best = _legal(board, best_uci)
    if step == 1:
        return {"comment": [_nudge(board, best, detect_motifs(board), seed)], "arrows": [], "highlights": []}
    if step == 2 and best is not None:
        return {
            "comment": [_sentence("hint", "piece", seed, piece=piece_label(board, best.from_square))],
            "arrows": [],
            "highlights": [{"square": chess.square_name(best.from_square), "kind": "piece"}],
        }
    return advice_for_position(board, best_uci)
