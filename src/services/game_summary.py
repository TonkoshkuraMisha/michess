# --- FILE: src/services/game_summary.py ---
"""
Итог партии (таск 11.5): тип партии по графику оценки и ключевые моменты — по уже готовому разбору, без движка.

Типы (проверяются по порядку, первый подходящий):
* ``seesaw`` — «качели»: решающий перевес (≥ LEAD_CP) переходил от одной стороны к другой не меньше двух раз;
* ``decisive_blunder`` — «решила ошибка»: проигравший грубо ошибся, не уступая до этого, и после ошибки
  перевес больше не возвращался к нему;
* ``domination`` — «доминирование»: победитель ни разу не был заметно хуже и почти всю партию был лучше;
* ``missed_win`` — «упущенная победа»: ничья, хотя одна из сторон имела выигрышный перевес (≥ WINNING_CP);
* ``balanced`` — «равная борьба»: больше EQUAL_SHARE ходов позиция была равной (|оценка| < EQUAL_CP);
* ``gradual`` — «постепенный перевес»: всё остальное — преимущество копилось без единого перелома.

Оценки — с точки зрения белых, мат приводится к ±CLAMP_CP. Ключевые моменты каждой стороны: лучший ход (точный ход с
самым большим улучшением оценки в свою пользу за пару полуходов — так засчитывается и наказание ошибки соперника) и
худший (самая большая потеря).
"""

from collections.abc import Sequence

LEAD_CP = 150
WINNING_CP = 300
EQUAL_CP = 100
EQUAL_SHARE = 0.4
DOMINATION_SHARE = 0.7
BLUNDER_CP = 200
CLAMP_CP = 1000
OPENING_PLIES = 8


def _clamp(value: int) -> int:
    return max(-CLAMP_CP, min(CLAMP_CP, value))


def _winner(result: str | None) -> int:
    """+1 — победили белые, −1 — чёрные, 0 — ничья или партия без результата."""
    return {"1-0": 1, "0-1": -1}.get(result or "", 0)


def _leader(eval_cp: int) -> int:
    if eval_cp >= LEAD_CP:
        return 1
    if eval_cp <= -LEAD_CP:
        return -1
    return 0


def _lead_changes(evals: Sequence[int]) -> int:
    changes = 0
    last = 0
    for value in evals:
        leader = _leader(value)
        if leader == 0:
            continue
        if last and leader != last:
            changes += 1
        last = leader
    return changes


def _turning_point(moves: Sequence[dict], evals: Sequence[int], winner: int) -> int | None:
    """Грубая ошибка проигравшего, после которой перевес победителя больше не уходил."""
    loser_color = "black" if winner == 1 else "white"
    previous = 0
    for index, move in enumerate(moves):
        before = previous
        previous = evals[index]
        if move.get("color") != loser_color or int(move.get("cp_loss", 0)) < BLUNDER_CP:
            continue
        # До ошибки проигравший не был хуже, после — проиграно, и перевес уже не вернулся.
        if before * winner > LEAD_CP / 2:
            continue
        if all(value * winner >= LEAD_CP for value in evals[index:]):
            return int(move.get("ply", index + 1))
    return None


def _key_moments(moves: Sequence[dict], evals: Sequence[int], color: str) -> dict:
    sign = 1 if color == "white" else -1
    best_ply: int | None = None
    best_gain = 0
    worst_ply: int | None = None
    worst_loss = 0
    for index, move in enumerate(moves):
        if move.get("color") != color:
            continue
        loss = int(move.get("cp_loss", 0))
        # Выигрыш считается от позиции до хода соперника: ход, наказавший его ошибку, — тоже лучший момент.
        baseline = evals[index - 2] if index >= 2 else 0
        gain = (evals[index] - baseline) * sign
        if loss <= 10 and gain > best_gain:
            best_gain, best_ply = gain, int(move.get("ply", index + 1))
        if loss > worst_loss:
            worst_loss, worst_ply = loss, int(move.get("ply", index + 1))
    # «Лучший ход» без заметного выигрыша и «худший» без заметной потери — не моменты.
    return {
        "best_ply": best_ply if best_gain >= 50 else None,
        "worst_ply": worst_ply if worst_loss >= 50 else None,
    }


def summarize(moves: Sequence[dict], result: str | None) -> dict | None:
    """Итог по ходам разбора (moves из analysis_json) и результату партии. Пустая партия — None."""
    if not moves:
        return None
    evals = [_clamp(int(move.get("eval_cp", 0))) for move in moves]
    winner = _winner(result)
    middlegame = evals[OPENING_PLIES:] or evals
    equal_share = sum(1 for value in evals if abs(value) < EQUAL_CP) / len(evals)
    changes = _lead_changes(evals)
    turning_point = _turning_point(moves, evals, winner) if winner else None

    kind: str
    if changes >= 2:
        kind = "seesaw"
    elif turning_point is not None:
        kind = "decisive_blunder"
    elif winner and all(value * winner > -LEAD_CP for value in evals) and (
            sum(1 for value in middlegame if value * winner > 0) / len(middlegame) >= DOMINATION_SHARE):
        kind = "domination"
    elif not winner and any(abs(value) >= WINNING_CP for value in evals):
        kind = "missed_win"
    elif equal_share > EQUAL_SHARE:
        kind = "balanced"
    else:
        kind = "gradual"

    return {
        "kind": kind,
        "turning_point_ply": turning_point,
        "lead_changes": changes,
        "equal_share": round(equal_share, 3),
        "white": _key_moments(moves, evals, "white"),
        "black": _key_moments(moves, evals, "black"),
    }
