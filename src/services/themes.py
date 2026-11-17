# --- FILE: src/services/themes.py ---
"""
Реестр тактических приёмов и тем упражнений (таск 13.0) — источник правды для задач, уроков, тренажёров и карты
навыков. Описание тем и порядок добавления — docs/training/tactical-themes.md; названия и объяснения — в каталогах
клиента (`themes.<код>.name / .short / .explain`) на трёх языках.

У темы: код (неизменный ключ), раздел A–L, родитель, источники разметки (D — детектор мотивов, L — тег открытой
базы задач lichess, M — ручная разметка), теги lichess для импорта (13.1), коды детектора мотивов (11.1) и минимумы
задач на ступени 1–4 для выдачи «по теме».

Второй признак (таск 27.8) — цель приёма: мат, материал, превращение, вторжение, ничья, темп. У темы цель задана, если
приём служит одной цели (маты — мату, «спасите партию» — ничьей); у остальных (вилка, отвлечение…) цель задаёт
задача. Цель задачи выводится из её тем: мат > ничья > превращение > материал (`puzzle_goal`).
"""

from dataclasses import dataclass, field

SECTIONS = ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L")
SOURCES = ("D", "L", "M")
DEFAULT_MINIMUMS = (25, 25, 20, 15)
GOALS = ("mate", "material", "promotion", "invasion", "draw", "tempo")
# Цели, которые бывают у задачи (итог решения), по старшинству.
PUZZLE_GOALS = ("mate", "draw", "promotion", "material")


@dataclass(frozen=True)
class Theme:
    """
    Тема реестра: неизменный код, раздел A–L, источники разметки, родитель, теги базы lichess, коды детектора мотивов,
    минимумы задач по ступеням и цель приёма.
    """
    code: str
    section: str
    sources: tuple[str, ...]
    parent: str | None = None
    lichess: tuple[str, ...] = ()
    detector: tuple[str, ...] = ()
    minimums: tuple[int, int, int, int] = field(default=DEFAULT_MINIMUMS)
    goal: str | None = None


def _t(code: str, section: str, sources: str, parent: str | None = None, lichess: str = "", detector: str = "",
       minimums: tuple[int, int, int, int] = DEFAULT_MINIMUMS, goal: str | None = None) -> Theme:
    if goal is None:
        goal = _DEFAULT_GOAL.get(code, "mate" if section == "F" else None)
    return Theme(code, section, tuple(sources.split(",")), parent,
                 tuple(lichess.split()) if lichess else (), tuple(detector.split()) if detector else (), minimums, goal)


# Цель приёма для тем вне раздела F (там всегда мат).
_DEFAULT_GOAL = {
    **dict.fromkeys(("greek_gift", "double_bishop_sacrifice", "f7_f2_attack", "kingside_attack", "queenside_attack",
                     "trap_scholars_mate", "basic_mates"), "mate"),
    **dict.fromkeys(("promotion", "underpromotion", "pawn_breakthrough", "pawn_race", "advanced_pawn",
                     "passed_pawn_support", "square_rule", "key_squares", "lucena", "rook_behind_passer"), "promotion"),
    **dict.fromkeys(("perpetual_check", "stalemate_trick", "fortress", "save_by_perpetual", "save_by_stalemate",
                     "equality", "philidor_position", "wrong_bishop", "perpetual_attack"), "draw"),
    **dict.fromkeys(("trapped_piece", "domination", "hanging_piece"), "material"),
    **dict.fromkeys(("open_file", "seventh_rank", "outpost"), "invasion"),
    **dict.fromkeys(("tempo_gain", "development_lag"), "tempo"),
}


# Темы, у которых по определению нет лёгких ступеней (длинное решение не бывает «знакомством»): минимум 0.
_MATE_MINIMUMS = {1: DEFAULT_MINIMUMS, 2: DEFAULT_MINIMUMS, 3: (0, 25, 20, 15), 4: (0, 0, 20, 15), 5: (0, 0, 0, 15)}


THEMES: tuple[Theme, ...] = (
    # A. Двойной удар
    _t("fork", "A", "D,L", lichess="fork", detector="fork"),
    _t("fork_knight", "A", "D", "fork"),
    _t("fork_pawn", "A", "D", "fork"),
    _t("fork_bishop", "A", "D", "fork"),
    _t("fork_rook", "A", "D", "fork"),
    _t("fork_queen", "A", "D", "fork"),
    _t("fork_king", "A", "D", "fork"),
    _t("double_attack", "A", "D,M"),
    _t("double_check", "A", "D,L", "discovered_check", lichess="doubleCheck", detector="double_check"),
    # B. Линейные удары
    _t("pin", "B", "D,L", lichess="pin", detector="pin_absolute pin_relative"),
    _t("pin_exploit", "B", "D", "pin"),
    _t("skewer", "B", "D,L", lichess="skewer", detector="skewer"),
    _t("x_ray", "B", "D,L", lichess="xRayAttack"),
    _t("discovered_attack", "B", "D,L", lichess="discoveredAttack", detector="discovered_attack"),
    _t("discovered_check", "B", "D", "discovered_attack", detector="discovered_check"),
    _t("windmill", "B", "D,M", "discovered_check"),
    _t("battery", "B", "D", detector="battery"),
    # C. Устранение защиты
    _t("remove_defender", "C", "D,L", lichess="capturingDefender"),
    _t("deflection", "C", "D,L", lichess="deflection"),
    _t("decoy", "C", "D,L", lichess="attraction"),
    _t("overload", "C", "D", detector="overloaded"),
    _t("undermining", "C", "D,M", "remove_defender"),
    _t("interference", "C", "D,L", lichess="interference", detector="interference"),
    _t("clearance", "C", "L,M", lichess="clearance"),
    _t("intermezzo", "C", "L", lichess="intermezzo"),
    _t("quiet_move", "C", "L", lichess="quietMove"),
    _t("desperado", "C", "M"),
    _t("hanging_piece", "C", "D,L", lichess="hangingPiece", detector="hanging"),
    # D. Ловля, ограничение, особые позиции
    _t("trapped_piece", "D", "D,L", lichess="trappedPiece", detector="trapped"),
    _t("domination", "D", "D,M", "trapped_piece"),
    _t("zugzwang", "D", "L", lichess="zugzwang"),
    _t("perpetual_check", "D", "D,M"),
    _t("stalemate_trick", "D", "D,M"),
    _t("fortress", "D", "M"),
    _t("en_passant", "D", "L", lichess="enPassant"),
    _t("castling_tactic", "D", "L,M", lichess="castling"),
    _t("perpetual_attack", "D", "M"),
    # E. Пешки
    _t("promotion", "E", "L", lichess="promotion"),
    _t("underpromotion", "E", "L", "promotion", lichess="underPromotion"),
    _t("pawn_breakthrough", "E", "D,M"),
    _t("pawn_race", "E", "D,M"),
    _t("advanced_pawn", "E", "L", lichess="advancedPawn"),
    _t("passed_pawn_support", "E", "M"),
    # F. Матовые конструкции
    *(_t(f"mate_in_{n}", "F", "L,D", lichess=f"mateIn{n}", detector="mate_in" if n == 1 else "",
         minimums=_MATE_MINIMUMS[n]) for n in range(1, 6)),
    _t("back_rank_mate", "F", "D,L", lichess="backRankMate", detector="back_rank"),
    _t("smothered_mate", "F", "L", lichess="smotheredMate"),
    _t("anastasia_mate", "F", "L", lichess="anastasiaMate"),
    _t("arabian_mate", "F", "L", lichess="arabianMate"),
    _t("boden_mate", "F", "L", lichess="bodenMate"),
    _t("double_bishop_mate", "F", "L", lichess="doubleBishopMate"),
    _t("dovetail_mate", "F", "L", lichess="dovetailMate"),
    _t("epaulette_mate", "F", "M"),
    _t("hook_mate", "F", "L", lichess="hookMate"),
    _t("opera_mate", "F", "M", "back_rank_mate"),
    _t("legal_mate", "F", "M"),
    _t("greco_mate", "F", "M"),
    _t("damiano_mate", "F", "M"),
    _t("lolli_mate", "F", "M"),
    _t("pillsbury_mate", "F", "M"),
    _t("morphy_mate", "F", "M"),
    _t("blackburne_mate", "F", "M"),
    _t("corridor_mate", "F", "M"),
    _t("queen_kiss_mate", "F", "M"),
    _t("vukovic_mate", "F", "L", lichess="vukovicMate"),
    # G. Атака на короля
    _t("greek_gift", "G", "D,M", "sacrifice"),
    _t("double_bishop_sacrifice", "G", "D,M", "sacrifice"),
    _t("f7_f2_attack", "G", "L", lichess="attackingF2F7"),
    _t("exposed_king", "G", "L", lichess="exposedKing"),
    _t("kingside_attack", "G", "L", lichess="kingsideAttack"),
    _t("queenside_attack", "G", "L", lichess="queensideAttack"),
    _t("rook_lift", "G", "D,M"),
    _t("pawn_storm", "G", "M"),
    _t("sacrifice", "G", "L", lichess="sacrifice"),
    # H. Дебютные ловушки и ошибки
    _t("opening_trap", "H", "D,M"),
    _t("early_queen", "H", "D,M", "opening_trap"),
    _t("trap_noahs_ark", "H", "M", "opening_trap"),
    _t("trap_fishing_pole", "H", "M", "opening_trap"),
    _t("trap_elephant", "H", "M", "opening_trap"),
    _t("trap_lasker", "H", "M", "opening_trap"),
    _t("trap_scholars_mate", "H", "M", "opening_trap"),
    _t("development_lag", "H", "D,M"),
    # I. Защита
    _t("find_the_threat", "I", "D"),
    _t("defensive_move", "I", "L", lichess="defensiveMove"),
    _t("counterattack", "I", "M"),
    _t("save_by_perpetual", "I", "D,M", "perpetual_check"),
    _t("save_by_stalemate", "I", "D,M", "stalemate_trick"),
    _t("blunder_check", "I", "D"),
    # J. Эндшпильная техника
    _t("opposition", "J", "D,M"),
    _t("triangulation", "J", "M", "opposition"),
    _t("square_rule", "J", "M"),
    _t("key_squares", "J", "M"),
    _t("outflanking", "J", "M", "key_squares"),
    _t("shouldering", "J", "M", "key_squares"),
    _t("lucena", "J", "D,M"),
    _t("philidor_position", "J", "D,M"),
    _t("rook_behind_passer", "J", "D,M"),
    _t("wrong_bishop", "J", "D,M"),
    _t("basic_mates", "J", "D,M"),
    # K. Расчёт и сочетание приёмов
    _t("combination", "K", "L,D"),
    _t("long_calculation", "K", "L", lichess="veryLong", minimums=(0, 0, 20, 15)),  # «long» в базе — 3 хода
    _t("equality", "K", "L", lichess="equality"),
    _t("candidate_moves", "K", "M"),
    _t("tempo_gain", "K", "M"),
    _t("unstoppable_threat", "K", "D,M"),
    _t("critical_position", "K", "M"),
    # L. Позиционные темы
    _t("outpost", "L", "M"),
    _t("open_file", "L", "D"),
    _t("seventh_rank", "L", "D"),
    _t("bad_bishop", "L", "M"),
    _t("weak_squares", "L", "M"),
    _t("isolated_pawn", "L", "D,M"),
    _t("minority_attack", "L", "M"),
    _t("piece_improvement", "L", "M"),
    _t("prophylaxis", "L", "M"),
    _t("exchange_choice", "L", "M"),
    _t("blockade", "L", "M"),
    _t("overprotection", "L", "M"),
    _t("centralization", "L", "M"),
    _t("pawn_chain", "L", "M"),
    _t("restriction", "L", "M"),
    _t("bishop_pair", "L", "M"),
)

THEMES_BY_CODE: dict[str, Theme] = {theme.code: theme for theme in THEMES}
LICHESS_TAG_TO_THEMES: dict[str, tuple[str, ...]] = {}
for _theme in THEMES:
    for _tag in _theme.lichess:
        LICHESS_TAG_TO_THEMES[_tag] = (*LICHESS_TAG_TO_THEMES.get(_tag, ()), _theme.code)
DETECTOR_TO_THEMES: dict[str, tuple[str, ...]] = {}
for _theme in THEMES:
    for _code in _theme.detector:
        DETECTOR_TO_THEMES[_code] = (*DETECTOR_TO_THEMES.get(_code, ()), _theme.code)

GOAL_THEMES: dict[str, tuple[str, ...]] = {
    goal: tuple(t.code for t in THEMES if t.goal == goal) for goal in GOALS
}


def puzzle_goal(codes: list[str]) -> str:
    """Цель задачи по её темам: мат > ничья > превращение > материал."""
    for goal in PUZZLE_GOALS[:-1]:
        if any(code in GOAL_THEMES[goal] for code in codes):
            return goal
    return "material"


# Вилка по типу нападающей фигуры (детектор отдаёт общую «fork»).
FORK_BY_PIECE = {"n": "fork_knight", "p": "fork_pawn", "b": "fork_bishop", "r": "fork_rook", "q": "fork_queen",
                 "k": "fork_king"}


def themes_for_lichess_tags(tags: list[str]) -> list[str]:
    """Коды реестра по тегам задачи из базы lichess (неизвестные теги пропускаются)."""
    result: list[str] = []
    for tag in tags:
        for code in LICHESS_TAG_TO_THEMES.get(tag, ()):
            if code not in result:
                result.append(code)
    return result


def themes_for_motif(code: str, attacker_piece: str | None = None) -> list[str]:
    """Коды реестра по мотиву детектора; вилка уточняется типом нападающей фигуры ('n', 'p', …)."""
    result = list(DETECTOR_TO_THEMES.get(code, ()))
    if code == "fork" and attacker_piece in FORK_BY_PIECE:
        result.append(FORK_BY_PIECE[attacker_piece])
    return result


def registry_payload() -> list[dict]:
    """Реестр для клиента: тексты он берёт из своих каталогов по коду."""
    return [
        {"code": t.code, "section": t.section, "parent": t.parent, "sources": list(t.sources),
         "minimums": list(t.minimums), "goal": t.goal}
        for t in THEMES
    ]
