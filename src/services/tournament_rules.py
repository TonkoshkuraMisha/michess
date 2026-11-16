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

Большие турниры («Машина времени», таск 28.1 — знаменитые турниры прошлого в полном составе): круговой на любое
число участников до 28 (Карлсбад 1911: двадцать шесть мастеров и игрок; при нечётном числе каждый один тур
свободен) и в несколько кругов с переменой цвета (round_robin_schedule); сетка на любое число участников —
сильнейшие по посеву проходят первый круг без игры (bracket_slots). Обычные турниры игрока по-прежнему ограничены
размерами ниже.
"""

from dataclasses import dataclass
from typing import Literal

Result = Literal["1-0", "0-1", "1/2-1/2"]
Stage = Literal["main", "rematch", "armageddon"]

ROUND_ROBIN_SIZES = (4, 6, 8)
KNOCKOUT_SIZES = (4, 8)
# Швейцарская система (таск 15.4): размер и число туров.
SWISS_SIZES = (6, 8)
SWISS_ROUNDS = {6: 4, 8: 5}
MIN_SHORTENED_BASE_MS = 60_000
# Турниры в историческом составе: границы размера и числа кругов.
OPEN_ROUND_ROBIN_SIZES = range(3, 29)
OPEN_KNOCKOUT_SIZES = range(3, 34)
MAX_CYCLES = 6


# --- Круговой турнир ---------------------------------------------------------------------------------

def berger_rounds(n: int) -> list[list[tuple[int, int]]]:
    """
    Туры кругового турнира по таблицам Бергера: список туров, тур — пары (белые, чёрные) номеров 1..n.
    Последний номер «стоит на месте», остальные вращаются; цвета — как в таблицах ФИДЕ.
    """
    if n not in ROUND_ROBIN_SIZES:
        raise ValueError(f"round robin needs {ROUND_ROBIN_SIZES} players, got {n}")
    return _berger(n)


def _berger(n: int) -> list[list[tuple[int, int]]]:
    """Таблица Бергера для любого чётного n: шаг вращения n/2 взаимно прост с n − 1, поэтому встречаются все."""
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


def round_robin_schedule(n: int, cycles: int = 1) -> list[list[tuple[int, int]]]:
    """
    Расписание кругового турнира на любое число участников и кругов. При нечётном n таблица строится на n + 1:
    кому достался несуществующий номер, в этом туре свободен. Каждый следующий круг повторяет пары с переменой цвета.
    """
    if n not in OPEN_ROUND_ROBIN_SIZES:
        raise ValueError(f"round robin needs {OPEN_ROUND_ROBIN_SIZES.start}–{OPEN_ROUND_ROBIN_SIZES[-1]} players, got {n}")
    if not 1 <= cycles <= MAX_CYCLES:
        raise ValueError(f"round robin has 1–{MAX_CYCLES} cycles, got {cycles}")
    table = _berger(n + n % 2)
    single = [[pair for pair in rnd if max(pair) <= n] for rnd in table]
    rounds = []
    for cycle in range(cycles):
        rounds += single if cycle % 2 == 0 else [[(black, white) for white, black in rnd] for rnd in single]
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
    # Бухгольц — сумма очков соперников (швейцарская система).
    buchholz: float = 0.0


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


# --- Швейцарская система ----------------------------------------------------------------------------

def _points(seats: list[int], games: list[GameRecord]) -> dict[int, float]:
    points = {s: 0.0 for s in seats}
    for g in games:
        points[g.white] += _score(g, g.white)
        points[g.black] += _score(g, g.black)
    return points


def swiss_standings(seats: list[int], games: list[GameRecord]) -> list[Standing]:
    """Таблица швейцарки: очки, затем Бухгольц (сумма очков соперников), Зоннеборн–Бергер, посев."""
    points = _points(seats, games)
    buchholz = {s: 0.0 for s in seats}
    sb = {s: 0.0 for s in seats}
    for g in games:
        for seat, opponent in ((g.white, g.black), (g.black, g.white)):
            buchholz[seat] += points[opponent]
            sb[seat] += _score(g, seat) * points[opponent]
    order = sorted(seats, key=lambda s: (-points[s], -buchholz[s], -sb[s], s))
    return [
        Standing(seat=s, points=points[s], head_to_head=0.0, sonneborn_berger=sb[s], place=i + 1, buchholz=buchholz[s])
        for i, s in enumerate(order)
    ]


def _colors(a: int, b: int, games: list[GameRecord]) -> tuple[int, int]:
    """Белые тому, у кого меньше белых (разность белых и чёрных); при равенстве — кто прошлую партию играл чёрными,
    затем — сеяному выше."""
    def balance(seat: int) -> int:
        return sum(1 if g.white == seat else -1 for g in games if seat in (g.white, g.black))

    def last_white(seat: int) -> bool | None:
        own = [g for g in games if seat in (g.white, g.black)]
        return own[-1].white == seat if own else None

    if balance(a) != balance(b):
        return (a, b) if balance(a) < balance(b) else (b, a)
    if last_white(a) is not None and last_white(a) != last_white(b):
        return (b, a) if last_white(a) else (a, b)
    return (a, b) if a < b else (b, a)


def swiss_pairings(seats: list[int], games: list[GameRecord]) -> list[tuple[int, int]]:
    """
    Пары следующего тура (белые, чёрные). Первый тур — верхняя половина посева против нижней (1–4, 2–5, 3–6), цвета
    чередуются по доскам. Дальше — по очкам: каждый, начиная с лидера, получает ближайшего по таблице соперника, с
    которым ещё не играл (перебор с возвратом гарантирует, что пары найдутся для всех); если без повторов нельзя —
    повтор допускается.
    """
    ordered = sorted(seats)
    if not games:
        half = len(ordered) // 2
        pairs = []
        for board, (high, low) in enumerate(zip(ordered[:half], ordered[half:], strict=True)):
            pairs.append((high, low) if board % 2 == 0 else (low, high))
        return pairs
    points = _points(seats, games)
    ranking = sorted(seats, key=lambda s: (-points[s], s))
    played = {frozenset((g.white, g.black)) for g in games}

    def search(rest: list[int], allow_repeat: bool) -> list[tuple[int, int]] | None:
        if not rest:
            return []
        first = rest[0]
        for opponent in rest[1:]:
            if not allow_repeat and frozenset((first, opponent)) in played:
                continue
            tail = search([s for s in rest[1:] if s != opponent], allow_repeat)
            if tail is not None:
                return [(first, opponent), *tail]
        return None

    found = search(ranking, False) or search(ranking, True)
    assert found is not None
    return [_colors(a, b, games) for a, b in found]


# --- На выбывание ------------------------------------------------------------------------------------

def knockout_first_round(n: int) -> list[tuple[int, int]]:
    """Пары первого круга по посеву (сеяный выше — первым)."""
    if n == 4:
        return [(1, 4), (2, 3)]
    if n == 8:
        return [(1, 8), (4, 5), (2, 7), (3, 6)]
    raise ValueError(f"knockout needs {KNOCKOUT_SIZES} players, got {n}")


def bracket_size(n: int) -> int:
    """Размер сетки: ближайшая степень двойки не меньше числа участников."""
    size = 2
    while size < n:
        size *= 2
    return size


def bracket_slots(n: int) -> list[tuple[int, int | None]]:
    """
    Первый круг сетки на любое число участников: пары (сеяный выше, соперник) по порядку сетки. Соперника нет
    (None) — участник проходит круг без игры; так проходят сильнейшие по посеву. Сетка — классическая: первый и
    второй номера встречаются только в финале, для 4 и 8 совпадает с knockout_first_round.
    """
    if n not in OPEN_KNOCKOUT_SIZES:
        raise ValueError(f"knockout needs {OPEN_KNOCKOUT_SIZES.start}–{OPEN_KNOCKOUT_SIZES[-1]} players, got {n}")
    order = [1, 2]
    while len(order) < bracket_size(n):
        full = len(order) * 2
        order = [seat for high in order for seat in (high, full + 1 - high)]
    return [(high, low if low <= n else None) for high, low in zip(order[::2], order[1::2], strict=True)]


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
    Места: победитель — 1, проигравший финал — 2, проигравшие в полуфинале делят 3-е, в четвертьфинале — 5-е,
    кругом раньше — 9-е и так далее. eliminated_in_round: номер участника → круг (с 1), в котором он выбыл.
    """
    rounds_total = bracket_size(n).bit_length() - 1
    places = {champion: 1}
    for seat, rnd in eliminated_in_round.items():
        from_end = rounds_total - rnd  # 0 — финал, 1 — полуфинал, 2 — четвертьфинал
        places[seat] = 2 if from_end == 0 else 2 ** from_end + 1
    return places
