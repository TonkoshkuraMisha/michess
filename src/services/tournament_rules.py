# --- FILE: src/services/tournament_rules.py ---
"""
Правила турниров с историческими мастерами (таск 15.1) — чистые функции, без базы и движка.

Номер участника (seat) — его посев: 1 — сильнейший по рейтингу на старте.

Круговой турнир (4, 6, 8 участников): расписание по таблицам Бергера ФИДЕ. Места: очки, затем личная встреча
среди набравших поровну, затем коэффициент Зоннеборна–Бергера; если равно и это — выше посеянный выше.

На выбывание (4, 8): сетка по посеву (1–8, 4–5, 2–7, 3–6 — первый и второй номера встречаются только в финале).
Матч — одна партия, сеяный выше играет белыми. Ничья — переигровка с переменой цвета и вдвое коротким контролем;
снова ничья — решающая партия, в которой чёрным достаточно ничьей; чёрными играет сеяный выше (награда за посев).
Места: победитель — 1, финалист — 2, проигравшие в полуфинале делят 3-е, в четвертьфинале — 5-е.
"""

from dataclasses import dataclass
from typing import Literal

Result = Literal["1-0", "0-1", "1/2-1/2"]
Stage = Literal["main", "rematch", "armageddon"]

ROUND_ROBIN_SIZES = (4, 6, 8)
KNOCKOUT_SIZES = (4, 8)
MIN_SHORTENED_BASE_MS = 60_000


# --- Круговой турнир ---------------------------------------------------------------------------------

def berger_rounds(n: int) -> list[list[tuple[int, int]]]:
    """
    Туры кругового турнира по таблицам Бергера: список туров, тур — пары (белые, чёрные) номеров 1..n.
    Последний номер «стоит на месте», остальные вращаются; цвета — как в таблицах ФИДЕ.
    """
    if n not in ROUND_ROBIN_SIZES:
        raise ValueError(f"round robin needs {ROUND_ROBIN_SIZES} players, got {n}")
    m = n - 1

    def cyc(x: int) -> int:
        return (x - 1) % m + 1

    rounds = []
    for r in range(m):
        fixed = (r * (n // 2)) % m + 1
        pairs = [(fixed, n) if r % 2 == 0 else (n, fixed)]
        pairs += [(cyc(fixed + k), cyc(fixed - k)) for k in range(1, n // 2)]
        rounds.append(pairs)
    return rounds


@dataclass(frozen=True)
class GameRecord:
    white: int
    black: int
    result: Result


@dataclass(frozen=True)
class Standing:
    seat: int
    points: float
    head_to_head: float
    sonneborn_berger: float
    place: int


def _score(game: GameRecord, seat: int) -> float:
    if game.result == "1/2-1/2":
        return 0.5
    won_white = game.result == "1-0"
    return 1.0 if (seat == game.white) == won_white else 0.0


def round_robin_standings(seats: list[int], games: list[GameRecord]) -> list[Standing]:
    """Таблица кругового турнира по сыгранным партиям, места с учётом дополнительных показателей."""
    points = {s: 0.0 for s in seats}
    for g in games:
        points[g.white] += _score(g, g.white)
        points[g.black] += _score(g, g.black)

    sb = {s: 0.0 for s in seats}
    for g in games:
        for seat, opponent in ((g.white, g.black), (g.black, g.white)):
            sb[seat] += _score(g, seat) * points[opponent]

    h2h = {s: 0.0 for s in seats}
    for s in seats:
        tied = {o for o in seats if points[o] == points[s]}
        h2h[s] = sum(_score(g, s) for g in games if s in (g.white, g.black) and {g.white, g.black} <= tied)

    order = sorted(seats, key=lambda s: (-points[s], -h2h[s], -sb[s], s))
    return [
        Standing(seat=s, points=points[s], head_to_head=h2h[s], sonneborn_berger=sb[s], place=i + 1)
        for i, s in enumerate(order)
    ]


# --- На выбывание ------------------------------------------------------------------------------------

def knockout_first_round(n: int) -> list[tuple[int, int]]:
    """Пары первого круга по посеву (сеяный выше — первым)."""
    if n == 4:
        return [(1, 4), (2, 3)]
    if n == 8:
        return [(1, 8), (4, 5), (2, 7), (3, 6)]
    raise ValueError(f"knockout needs {KNOCKOUT_SIZES} players, got {n}")


@dataclass(frozen=True)
class MatchGame:
    stage: Stage
    white: int
    black: int
    shortened: bool


def match_game(high: int, low: int, stage: Stage) -> MatchGame:
    """Цвета и контроль партии матча: high — сеяный выше."""
    if stage == "main":
        return MatchGame("main", white=high, black=low, shortened=False)
    if stage == "rematch":
        return MatchGame("rematch", white=low, black=high, shortened=True)
    return MatchGame("armageddon", white=low, black=high, shortened=True)


def shortened_control(base_ms: int, increment_ms: int) -> tuple[int, int]:
    """Контроль переигровки и решающей партии: вдвое короче, но не меньше минуты."""
    return max(MIN_SHORTENED_BASE_MS, base_ms // 2), increment_ms // 2


@dataclass(frozen=True)
class MatchState:
    winner: int | None
    next_game: MatchGame | None


def match_state(high: int, low: int, played: list[tuple[Stage, GameRecord]]) -> MatchState:
    """
    Итог матча по сыгранным партиям (в порядке игры): победитель или следующая партия.
    В решающей партии ничья — победа чёрных.
    """
    stages: list[Stage] = ["main", "rematch", "armageddon"]
    for stage, game in played:
        if game.result == "1-0":
            return MatchState(game.white, None)
        if game.result == "0-1":
            return MatchState(game.black, None)
        if stage == "armageddon":
            return MatchState(game.black, None)
    next_stage = stages[len(played)]
    return MatchState(None, match_game(high, low, next_stage))


def knockout_next_round(winners: list[int]) -> list[tuple[int, int]]:
    """Пары следующего круга: победители соседних матчей сетки; сеяный выше — первым."""
    return [(min(a, b), max(a, b)) for a, b in zip(winners[::2], winners[1::2], strict=True)]


def knockout_places(n: int, eliminated_in_round: dict[int, int], champion: int) -> dict[int, int]:
    """
    Места: победитель — 1, проигравший финал — 2, проигравшие в полуфинале делят 3-е, в четвертьфинале — 5-е.
    eliminated_in_round: номер участника → круг (с 1), в котором он выбыл.
    """
    rounds_total = 2 if n == 4 else 3
    places = {champion: 1}
    for seat, rnd in eliminated_in_round.items():
        from_end = rounds_total - rnd  # 0 — финал, 1 — полуфинал, 2 — четвертьфинал
        places[seat] = 2 if from_end == 0 else 3 if from_end == 1 else 5
    return places
