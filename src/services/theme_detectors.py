"""
Распознавание тем без тега в открытой базе задач (таск 27.8, наполнение тем «M»): по позиции и решению задачи — какой
приём в ней показан. Только правила python-chess, без движка; каждое правило консервативно (лучше пропустить задачу,
чем приписать ей чужую тему). Вход — как в базе: FEN до хода соперника, ходы (первый — соперника), теги базы.

Темы: греческий дар, двойная жертва слонов, мельница, вечный шах и патовая ловушка (они же «спасите партию»),
прорыв и гонка пешек, оппозиция, Лусена, Филидор, ладья позади проходной, «не тот» слон, простейшие маты, дебютная
ловушка, ранний ферзь, отставание в развитии, комбинация, подключение ладьи, седьмая горизонталь, изолированная пешка,
неотвратимая угроза, доминация, подрыв защитника, использование связки.

Вызывает puzzle_import.py при разборе строк открытой базы lichess (detect). Тактики-приёмы для темы «комбинация» —
по тегам базы через themes.themes_for_lichess_tags.
"""

import chess

from src.services import pawn_structures

# Коды тактических приёмов реестра: два и больше таких в одной задаче дают тему «комбинация».
TACTICS = {"fork", "pin", "skewer", "discovered_attack", "double_check", "deflection", "decoy", "remove_defender",
           "interference", "clearance", "intermezzo", "x_ray", "overload", "trapped_piece", "hanging_piece", "sacrifice"}


def _relative_rank(square: chess.Square, color: chess.Color) -> int:
    """Номер горизонтали с точки зрения стороны: 0 — её первая, 7 — последняя."""
    rank = chess.square_rank(square)
    return rank if color == chess.WHITE else 7 - rank


def _only(board: chess.Board, kinds: set[int]) -> bool:
    """На доске, кроме королей, только фигуры перечисленных видов."""
    return all(piece.piece_type in kinds | {chess.KING} for piece in board.piece_map().values())


def _material(board: chess.Board, color: chess.Color) -> list[int]:
    """Виды фигур стороны без короля, по возрастанию (для сравнения со списком вроде [PAWN, ROOK])."""
    return sorted(p.piece_type for p in board.piece_map().values() if p.color == color and p.piece_type != chess.KING)


def _passed(board: chess.Board, square: chess.Square, color: chess.Color) -> bool:
    """Пешка стороны color на поле square проходная: впереди на своей и соседних вертикалях нет пешек соперника."""
    file, rank = chess.square_file(square), chess.square_rank(square)
    for other in board.pieces(chess.PAWN, not color):
        o_file, o_rank = chess.square_file(other), chess.square_rank(other)
        if abs(o_file - file) <= 1 and ((o_rank > rank) if color == chess.WHITE else (o_rank < rank)):
            return False
    return True


def _discovered_check(board: chess.Board, move: chess.Move) -> bool:
    """Ход даёт шах не той фигурой, что пошла (вскрытый шах)."""
    if not board.gives_check(move):
        return False
    after = board.copy(stack=False)
    after.push(move)
    king = after.king(after.turn)
    return king is not None and any(sq != move.to_square for sq in after.checkers())


def detect(fen: str, moves: list[str], tags: list[str]) -> list[str]:
    """
    Коды тем реестра, которые показывает задача, по порядку обнаружения. fen — позиция до хода соперника, moves — UCI
    (первый ход соперника, затем решение), tags — теги базы. Пустой список — тем не найдено или данные не разбираются.
    """
    found: list[str] = []

    def add(*codes: str) -> None:
        for code in codes:
            if code not in found:
                found.append(code)

    try:
        board = chess.Board(fen)
        board.push_uci(moves[0])
    except (ValueError, IndexError):
        return found
    solver = board.turn
    start = board.copy(stack=False)
    line = [chess.Move.from_uci(u) for u in moves[1:]]
    tagset = set(tags)

    solver_moves: list[tuple[chess.Board, chess.Move]] = []
    current = board.copy(stack=False)
    for index, move in enumerate(line):
        if move not in current.legal_moves:
            return found
        if index % 2 == 0:
            solver_moves.append((current.copy(stack=False), move))
        current.push(move)
    final = current
    if not solver_moves:
        return found
    first_board, first = solver_moves[0]
    mover = first_board.piece_at(first.from_square)

    # Греческий дар: слон бьёт h7 (h2) с шахом королю на g8 (g1).
    target, king_square = (chess.H7, chess.G8) if solver == chess.WHITE else (chess.H2, chess.G1)
    bishop_takes_h = [(b, m) for b, m in solver_moves
                      if m.to_square == target and b.piece_type_at(m.from_square) == chess.BISHOP and b.is_capture(m)]
    if (bishop_takes_h and first.to_square == target and start.king(not solver) == king_square
            and first_board.gives_check(first)):
        add("greek_gift", "sacrifice")
    # Двойная жертва слонов: слоны бьют h7 и g7 (h2 и g2).
    g_square = chess.G7 if solver == chess.WHITE else chess.G2
    if bishop_takes_h and any(m.to_square == g_square and b.piece_type_at(m.from_square) == chess.BISHOP and b.is_capture(m)
                              for b, m in solver_moves):
        add("double_bishop_sacrifice", "sacrifice")

    # Мельница: два и больше вскрытых шаха, хотя бы один со взятием.
    discovered = [(b, m) for b, m in solver_moves if _discovered_check(b, m)]
    if len(discovered) >= 2 and any(b.is_capture(m) for b, m in discovered):
        add("windmill")

    # Спасите партию: вечный шах (все ходы решающего — шахи, итог — равенство) и патовая ловушка.
    if "equality" in tagset and len(solver_moves) >= 2 and all(b.gives_check(m) for b, m in solver_moves):
        add("perpetual_check", "save_by_perpetual")
    if final.is_stalemate():
        add("stalemate_trick", "save_by_stalemate")

    # Пешечные окончания.
    if _only(start, {chess.PAWN}):
        promotes = any(m.promotion for _, m in solver_moves)
        if promotes and mover and mover.piece_type == chess.PAWN:
            # Прорыв — пешка идёт под удар (жертва), гонка — свободные проходные у обеих сторон.
            if first_board.is_attacked_by(not solver, first.to_square):
                add("pawn_breakthrough")
            elif _passed(first_board, first.from_square, solver) and any(
                    _passed(first_board, sq, not solver) for sq in first_board.pieces(chess.PAWN, not solver)):
                add("pawn_race")
        if mover and mover.piece_type == chess.KING:
            after = first_board.copy(stack=False)
            after.push(first)
            own, other = after.king(solver), after.king(not solver)
            if own is not None and other is not None:
                df = abs(chess.square_file(own) - chess.square_file(other))
                dr = abs(chess.square_rank(own) - chess.square_rank(other))
                if (df, dr) in ((0, 2), (2, 0)):
                    add("opposition")

    # Ладейные окончания: Лусена, Филидор, ладья позади проходной.
    mine, theirs = _material(start, solver), _material(start, not solver)
    if mine == [chess.PAWN, chess.ROOK] and theirs == [chess.ROOK]:
        pawn = next(iter(start.pieces(chess.PAWN, solver)))
        king = start.king(solver)
        if _relative_rank(pawn, solver) == 6 and king is not None and _relative_rank(king, solver) == 7:
            add("lucena")
    if mine == [chess.ROOK] and theirs == [chess.PAWN, chess.ROOK] and {"equality", "defensiveMove"} & tagset:
        add("philidor_position")
    if mover and mover.piece_type == chess.ROOK and "rookEndgame" in tagset:
        file = chess.square_file(first.to_square)
        for pawn in first_board.pieces(chess.PAWN, solver):
            ahead = (chess.square_rank(pawn) > chess.square_rank(first.to_square)) == (solver == chess.WHITE)
            if chess.square_file(pawn) == file and ahead and _passed(first_board, pawn, solver):
                add("rook_behind_passer")
    # «Не тот» слон: слон и крайние пешки против короля, поле превращения не цвета слона — защищается решающий.
    if not mine and theirs and set(theirs) <= {chess.BISHOP, chess.PAWN} and theirs.count(chess.BISHOP) == 1:
        pawns = start.pieces(chess.PAWN, not solver)
        bishop = next(iter(start.pieces(chess.BISHOP, not solver)))
        files = {chess.square_file(p) for p in pawns}
        if pawns and files <= {0} | {7} and len(files) == 1:
            attacker_rank = 7 if solver == chess.BLACK else 0  # поле превращения сильнейшей стороны
            corner = chess.square(files.pop(), attacker_rank)
            light = chess.BB_LIGHT_SQUARES
            if bool(chess.BB_SQUARES[corner] & light) != bool(chess.BB_SQUARES[bishop] & light):
                add("wrong_bishop")

    # Простейшие маты: на доске не больше четырёх фигур с королями.
    if final.is_checkmate() and len(start.piece_map()) <= 4:
        add("basic_mates")

    # Дебют: ловушка, ранний ферзь, отставание в развитии.
    if "opening" in tagset and start.fullmove_number <= 12 and ({"mate", "crushing"} & tagset or final.is_checkmate()):
        add("opening_trap")
        queen_home = chess.D8 if solver == chess.WHITE else chess.D1
        enemy_queens = start.pieces(chess.QUEEN, not solver)
        if start.fullmove_number <= 10 and enemy_queens and queen_home not in enemy_queens and any(
                b.piece_type_at(m.to_square) == chess.QUEEN and b.color_at(m.to_square) != solver for b, m in solver_moves):
            add("early_queen")
        home = [chess.B8, chess.C8, chess.F8, chess.G8] if solver == chess.WHITE else [chess.B1, chess.C1, chess.F1, chess.G1]
        if sum(1 for sq in home if start.piece_type_at(sq) in (chess.KNIGHT, chess.BISHOP)
               and start.color_at(sq) != solver) >= 3:
            add("development_lag")

    # Расчёт: комбинация — два и больше тактических приёма в одной задаче (по тегам базы).
    from src.services.themes import themes_for_lichess_tags

    if len(set(themes_for_lichess_tags(tags)) & TACTICS) >= 2:
        add("combination")
    # Неотвратимая угроза: тихий ход, после которого мат неизбежен.
    if "quietMove" in tagset and ({"mate"} & tagset or final.is_checkmate()):
        add("unstoppable_threat")
    # Доминация: ловля фигуры тихим ходом.
    if "trappedPiece" in tagset and "quietMove" in tagset:
        add("domination")
    # Подрыв защитника: защитник уничтожен ударом пешки.
    if "capturingDefender" in tagset and mover and mover.piece_type == chess.PAWN and first_board.is_capture(first):
        add("undermining")
    # Использование связки: решающий бьёт связанную фигуру соперника.
    if "pin" in tagset and first_board.is_capture(first) and first_board.is_pinned(not solver, first.to_square):
        add("pin_exploit")

    # Атака: подключение ладьи по третьей горизонтали к королю.
    for index, (b, m) in enumerate(solver_moves):
        if b.piece_type_at(m.from_square) == chess.ROOK and _relative_rank(m.to_square, solver) == 2 and \
                _relative_rank(m.from_square, solver) == 0:
            later = [(b2, m2) for b2, m2 in solver_moves[index + 1:] if m2.from_square == m.to_square]
            if later and (later[0][0].gives_check(later[0][1]) or chess.square_file(later[0][1].to_square) in (6, 7)):
                add("rook_lift")
                break
    # Седьмая горизонталь: ладья решающего врывается на 7-ю (2-ю) с шахом или взятием.
    if any(b.piece_type_at(m.from_square) == chess.ROOK and _relative_rank(m.to_square, solver) == 6
           and (b.gives_check(m) or b.is_capture(m)) for b, m in solver_moves):
        add("seventh_rank")
    # Позиция с изолированной пешкой (структура 27.5).
    if pawn_structures.detect(start) == "isolated_pawn":
        add("isolated_pawn")
    return found
