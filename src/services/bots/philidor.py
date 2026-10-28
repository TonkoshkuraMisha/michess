# --- FILE: src/services/bots/philidor.py ---

import logging
import os
import random
import shutil
import time
import chess
import chess.engine

logger = logging.getLogger(__name__)

# Дебютная книга Франсуа-Андре Филидора:
# Объединяет "Analyse du jeu des Échecs" (1749 г.) и реальные партии 1783-1795 гг.
PHILIDOR_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = {
    # === СТАНДАРТНЫЕ ПОЗИЦИИ И ТРАКТАТ 1749 ГОДА ===
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 92, "Пешка короля открывает путь слону и занимает центр (11 партий)."),
        ("d2d4", 8, "Атака ферзевой пешкой с последующим c2-c4."),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 72, "Встретим пешку соперника в центре: e7-e5 (8 партий)."),
        ("c7c5", 18, "Асимметричный фланговый ответ c7-c5 (3 партии)."),
        ("e7e6", 10, "Сдержанное построение e7-e6, готовя удар d7-d5."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("f1c4", 63, "Дебют слона! Слон атакует пункт f7, не мешая пешке f2 идти вперёд (5 партий)."),
        ("f2f4", 37, "Королевский гамбит — подорвём центр соперника с фланга! (3 партии)."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": [
        ("d7d6", 100, "Моя фирменная защита (d7-d6)! Белые напрасно вывели коня на f3, заперев свою пешку f2."),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq -": [
        ("f7f5", 65, "Контрудар f7-f5! Как я писал в «Анализе шахматной игры», перехватим инициативу пешками."),
        ("e5d4", 35, "Разменяем центральную пешку, удерживая прочный редут на d6."),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -": [
        ("f7f5", 60, "Смело двигаем пешку f7-f5, вскрывая линию для ладьи после рокировки!"),
        ("c7c6", 40, "Подготовим d6-d5 с помощью пешки c6 (партия против графа Брюля, 1783 г.)."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("c2c3", 100, "Сначала c2-c3! Конь никогда не должен становиться впереди пешки c."),
    ],
    "rnbqk1nr/pppp1ppp/8/2b1p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("c2c3", 100, "Первая партия из моего трактата 1749 года: c2-c3 готовит мощный пешечный центр d2-d4!"),
    ],
    "rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("d2d3", 50, "Укрепим пешку e4, чтобы затем подготовить c2-c3 и f2-f4."),
        ("d2d4", 30, "Немедленный удар по центру!"),
        ("b1c3", 20, "Развитие коня в борьбе за центральные поля."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq -": [
        ("c7c6", 80, "Сыграем c7-c6, чтобы следующим ходом захватить центр пешкой d7-d5! (4 партии)."),
        ("g8f6", 20, "Атакуем пешку e4 конём."),
    ],

    # === ПАРТИИ ИЗ ИСТОРИЧЕСКОЙ БАЗЫ PGN (ЛОНДОН И ПАРИЖ) ===
    "rnbqkbnr/pp1p1ppp/2p5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("d1e2", 50, "Исторический выбор Филидора: укрепляем e4 ферзём (2 партии)."),
        ("b1c3", 25, "Исторический выбор Филидора (1 партия)."),
        ("g1f3", 25, "Исторический выбор Филидора (1 партия)."),
    ],
    "rnbqkbnr/pp1p1ppp/2p5/4p3/2B1P3/8/PPPPQPPP/RNB1K1NR b KQkq -": [
        ("d7d6", 50, "Укрепляем пешку e5 по системе Филидора (1 партия)."),
        ("g8f6", 50, "Развиваем коня с темпом (1 партия)."),
    ],
    "rnbqkbnr/pp3ppp/2pp4/4p3/2B1P3/8/PPPPQPPP/RNB1K1NR w KQkq -": [
        ("c2c3", 100, "Готовим пешечное наступление в центре c2-c3 и d2-d4."),
    ],
    "rnbqkbnr/pp3ppp/2pp4/4p3/2B1P3/2P5/PP1PQPPP/RNB1K1NR b KQkq -": [
        ("f7f5", 100, "Фланговый контрудар пешкой f7-f5!"),
    ],
    "rnbqkbnr/pp4pp/2pp4/4pp2/2B1P3/2P5/PP1PQPPP/RNB1K1NR w KQkq -": [
        ("d2d3", 100, "Надёжно защищаем центральную цепь d3-e4."),
    ],
    "rnbqkbnr/pp4pp/2pp4/4pp2/2B1P3/2PP4/PP2QPPP/RNB1K1NR b KQkq -": [
        ("g8f6", 100, "Выводим коня в бой с контролем центра."),
    ],
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("f2f4", 67, "Против сицилианского построения сразу надвигаем пешку f4! (2 партии)."),
        ("f1c4", 33, "Выведем слона на активную диагональ a2-g8 (1 партия)."),
    ],
    "rnbqkbnr/pp1ppppp/8/2p5/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq -": [
        ("e7e6", 100, "Готовим продвижение d7-d5."),
    ],
    "rnbqkbnr/pp1p1ppp/4p3/2p5/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("d1e2", 100, "Освобождаем дорогу ладье и поддерживаем e4."),
    ],
    "rnbqkbnr/pp1p1ppp/4p3/2p5/2B1P3/8/PPPPQPPP/RNB1K1NR b KQkq -": [
        ("b8c6", 100, "Развитие ферзевого коня."),
    ],
    "r1bqkbnr/pp1p1ppp/2n1p3/2p5/2B1P3/8/PPPPQPPP/RNB1K1NR w KQkq -": [
        ("c2c3", 100, "Пешка c3 прокладывает маршрут для захвата центра d2-d4."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq -": [
        ("e5f4", 100, "Принимаем королевский гамбит (3 партии)."),
    ],
    "rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP2PP/RNBQKBNR w KQkq -": [
        ("g1f3", 100, "Предотвращаем шах ферзём на h4 (3 партии)."),
    ],
    "rnbqkbnr/pppp1ppp/8/8/4Pp2/5N2/PPPP2PP/RNBQKB1R b KQkq -": [
        ("g7g5", 100, "Удерживаем гамбитную пешку f4 цепью g7-g5 (3 партии)."),
    ],
    "rnbqkbnr/pppp1p1p/8/6p1/4Pp2/5N2/PPPP2PP/RNBQKB1R w KQkq -": [
        ("f1c4", 100, "Нацеливаем слона на уязвимый пункт f7 (3 партии)."),
    ],
    "rnbqkbnr/pppp1p1p/8/6p1/2B1Pp2/5N2/PPPP2PP/RNBQK2R b KQkq -": [
        ("g5g4", 67, "Атакуем коня f3 пешкой g4 (2 партии)."),
        ("f8g7", 33, "Укрепляем королевский фланг слоном на g7 (1 партия)."),
    ],
    "rnbqkbnr/pppp1p1p/8/8/2B1Ppp1/5N2/PPPP2PP/RNBQK2R w KQkq -": [
        ("d2d4", 100, "Захватываем центр и открываем слона c1 (2 партии)."),
    ],
    "rnbqkbnr/pppp1p1p/8/8/2BPPpp1/5N2/PPP3PP/RNBQK2R b KQkq -": [
        ("g4f3", 100, "Забираем коня в остром гамбите (2 партии)."),
    ],
    "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -": [
        ("d7d5", 100, "Удержим равновесие в центре."),
    ],
    "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -": [
        ("c2c4", 100, "Ферзевый гамбит — подрываем центральную пешку d5."),
    ],
    "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq -": [
        ("d5c4", 100, "Принятый ферзевый гамбит."),
    ],
    "rnbqkbnr/ppp1pppp/8/8/2pP4/8/PP2PPPP/RNBQKBNR w KQkq -": [
        ("e2e3", 100, "Отыгрываем пешку c4 слоном."),
    ],
    "rnbqkbnr/ppp1pppp/8/8/2pP4/4P3/PP3PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 100, "Немедленный контрудар в центре e7-e5!"),
    ],
    "rnbqkbnr/ppp2ppp/8/4p3/2pP4/4P3/PP3PPP/RNBQKBNR w KQkq -": [
        ("d4d5", 100, "Задвигаем d4-d5, стесняя фигуры соперника."),
    ],
    "rnbqkbnr/pp1ppppp/8/2p5/4PP2/8/PPPP2PP/RNBQKBNR b KQkq -": [
        ("e7e6", 50, "Готовим прорыв d7-d5 в центре."),
        ("b8c6", 50, "Контролируем центральное поле d4."),
    ],
    "r1bqkbnr/pp1p1ppp/2n1p3/2p5/4PP2/5N2/PPPP2PP/RNBQKB1R w KQkq -": [
        ("c2c3", 100, "Готовим мощный пешечный клин d2-d4 (2 партии)."),
    ],
    "r1bqkbnr/pp3ppp/2n1p3/2pp4/4PP2/2P2N2/PP1P2PP/RNBQKB1R w KQkq -": [
        ("e4e5", 100, "Закрываем центр и захватываем пространство на королевском фланге (2 партии)."),
    ],
    "r1bqkbnr/pp3ppp/2n1p3/2ppP3/5P2/2P2N2/PP1P2PP/RNBQKB1R b KQkq -": [
        ("f7f5", 100, "Блокируем пешечную лавину соперника ходом f7-f5 (2 партии)."),
    ],

    # === ГАНДИКАП-ПАРТИИ ФИЛИДОРА (БЕЗ ПЕШКИ f7 ИЛИ КОНЯ b8) ===
    "rnbqkbnr/ppppp1pp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 96, "Исторический выбор в гандикап-партиях Филидора (24 партии)."),
        ("d2d4", 4, "Исторический выбор в гандикап-партиях Филидора (1 партия)."),
    ],
    "rnbqkbnr/ppppp1pp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("g8h6", 45, "Филидор переводит коня через h6 на f7 для прикрытия короля (5 партий)."),
        ("e7e6", 28, "Филидор укрепляет центр ходом e7-e6 (3 партии)."),
        ("c7c5", 27, "Фланговый контрудар Филидора c7-c5 (3 партии)."),
    ],
    "rnbqkbnr/pppp2pp/4p3/8/3PPP2/8/PPP3PP/RNBQKBNR b KQkq -": [
        ("d7d5", 100, "Любимая стойка Филидора во французской структуре (11 партий)."),
    ],
    "rnbqkbnr/ppp3pp/4p3/3p4/3PPP2/8/PPP3PP/RNBQKBNR w KQkq -": [
        ("e4e5", 100, "Захватываем пространство в центре ходом e4-e5 (11 партий)."),
    ],
    "rnbqkbnr/ppp3pp/4p3/3pP3/3P1P2/8/PPP3PP/RNBQKBNR b KQkq -": [
        ("c7c5", 100, "Подрыв базы пешечной цепи соперника ходом c7-c5! (11 партий)."),
    ],
    "rnbqkbnr/pp4pp/4p3/2ppP3/3P1P2/8/PPP3PP/RNBQKBNR w KQkq -": [
        ("c2c3", 91, "Укрепляем центральную пешку d4 пешкой c3 (10 партий)."),
        ("g1f3", 9, "Развиваем коня на королевском фланге."),
    ],
}

CENTER_SQUARES = {chess.D4, chess.E4, chess.D5, chess.E5}
EXTENDED_CENTER = {chess.C4, chess.D4, chess.E4, chess.F4, chess.C5, chess.D5, chess.E5, chess.F5}

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}

PHILIDOR_BLUNDER_GUARD_CP = 120.0
BLUNDER_GUARD_MARGIN_CP = PHILIDOR_BLUNDER_GUARD_CP


def normalize_fen_key(board: chess.Board) -> str:
    parts = board.fen().split(" ")
    return f"{parts[0]} {parts[1]} {parts[2]} -"


def resolve_stockfish_path(custom_path: str | None = None) -> str | None:
    """Ищет бинарник Stockfish: сначала в локальной папке bin/, затем в системном PATH."""
    if custom_path and os.path.exists(custom_path):
        return custom_path

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    for binary_name in ("stockfish.exe", "stockfish"):
        candidate = os.path.join(project_root, "bin", binary_name)
        if os.path.exists(candidate) and os.path.isfile(candidate):
            return candidate

    return shutil.which("stockfish")


def _simulate_human_thinking_time(
        board: chess.Board,
        is_book_move: bool,
        bot_time_left_ms: int = 180000,
        base_time_ms: int = 180000,
) -> None:
    """
    Человеческий тайминг шахматиста с учётом стадии партии, теории,
    сложности эндшпиля/миттельшпиля и цейтнотного давления на часах.
    """
    # 1. Определение стадия партии
    piece_count = len(board.piece_map())
    move_number = board.fullmove_number

    is_opening = move_number <= 10 and piece_count >= 28
    is_endgame = piece_count <= 12  # Мало фигур — эндшпиль

    # 2. Базовое время в зависимости от стадии и дебютной памяти
    if is_opening:
        if is_book_move:
            # Знакомая дебютная теория — рука сама ставит фигуру (очень быстро)
            base_delay = random.uniform(0.8, 1.8)
        else:
            # Незнакомый дебют / отклонение от книги — человек думает над планом
            base_delay = random.uniform(3.5, 8.0)
    elif is_endgame:
        # Проверяем, теоретический ли это эндшпиль (например, только короли и пешки или простое ферзевое/ладейное)
        # В простых эндшпилях не думают, в сложных ладейных — зависают надолго
        is_simple_endgame = piece_count <= 6
        if is_simple_endgame:
            base_delay = random.uniform(0.8, 2.0)
        else:
            base_delay = random.uniform(4.0, 12.0)
    else:
        # Миттельшпиль — сердце борьбы, критические моменты
        legal_moves_count = board.legal_moves.count()
        # Если позиция острая (много вариантов), коэффициент сложности выше
        complexity_mult = 0.7 + (min(legal_moves_count, 45) / 45.0) * 0.8
        base_delay = random.uniform(4.0, 14.0) * complexity_mult

        # Иногда в миттельшпиле шахматист находит ключевой момент и думает «вечность» (15-30+ сек)
        if random.random() < 0.08 and base_time_ms > 60000:
            base_delay = random.uniform(18.0, 35.0)

    # 3. Коэффициент пропорциональности общему контролю партии
    # (Если контроль долгий — классика 90+30, думаем солиднее; если пуля — сжимаемся)
    control_scale_factor = max(0.3, min(3.0,
                                        base_time_ms / 300000.0))  # 5 минут = 1.0, 90 минут = ~18.0, но ограничено сверху
    if base_time_ms > 600000:  # для классики масштабируем мягче
        control_scale_factor = 1.5 + (base_time_ms / 1800000.0) * 1.5

    adjusted_delay = base_delay * control_scale_factor

    # 4. Фактор оставшегося времени на часах (Clock Pressure / Цейтнот)
    # Если на часах у бота осталось мало времени, он физически не может долго думать
    if bot_time_left_ms < 30000:  # Меньше 30 секунд
        time_ratio = bot_time_left_ms / 30000.0
        adjusted_delay = max(0.5, adjusted_delay * time_ratio)

    # 5. Случайное блуждание (шум)
    noise = random.gauss(0, 0.3) * adjusted_delay
    final_thinking_time = max(0.6, adjusted_delay + noise)

    # Защита от превышения реального остатка времени на часах бота
    max_allowed = max(0.5, (bot_time_left_ms - 2000) / 1000.0)
    final_thinking_time = min(final_thinking_time, max_allowed)

    time.sleep(final_thinking_time)


def _evaluate_pawn_structure(board: chess.Board, us: chess.Color) -> float:
    our_pawns = board.pieces(chess.PAWN, us)
    start_rank = 1 if us == chess.WHITE else 6
    pawn_files = [chess.square_file(sq) for sq in our_pawns]

    score = 0.0
    for sq in our_pawns:
        f = chess.square_file(sq)
        r = chess.square_rank(sq)

        if r != start_rank:
            score += float(r if us == chess.WHITE else (7 - r)) * 3.0

        if f < 7 and chess.square(f + 1, r) in our_pawns:
            score += 15.0

        support_rank = (r - 1) if us == chess.WHITE else (r + 1)
        if 0 <= support_rank <= 7:
            if (f > 0 and chess.square(f - 1, support_rank) in our_pawns) or (
                    f < 7 and chess.square(f + 1, support_rank) in our_pawns
            ):
                score += 10.0

    doubled_pawns = len(pawn_files) - len(set(pawn_files))
    score -= float(doubled_pawns) * 20.0

    return score


def evaluate_philidor_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    us = board_before.turn
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if piece.piece_type == chess.PAWN:
        bonus += 14.0
        if move.to_square in CENTER_SQUARES:
            bonus += 35.0
            note = "Пешки — душа шахмат! Мощный удар в центр доски."
        elif move.to_square in EXTENDED_CENTER:
            bonus += 22.0
            note = "Занимаем пространство пешечной фалангой."
        elif move.to_square in {chess.C3, chess.C6, chess.D3, chess.D6}:
            bonus += 16.0
            note = "Подготавливаем продвижение центральной пешки по методу Филидора."

    if piece.piece_type == chess.KNIGHT and board_before.fullmove_number <= 10:
        if us == chess.WHITE:
            if move.to_square == chess.C3 and board_before.piece_at(chess.C2) == chess.Piece(chess.PAWN, chess.WHITE):
                bonus -= 55.0
            if move.to_square == chess.F3 and board_before.piece_at(chess.F2) == chess.Piece(chess.PAWN, chess.WHITE):
                bonus -= 45.0
        else:
            if move.to_square == chess.C6 and board_before.piece_at(chess.C7) == chess.Piece(chess.PAWN, chess.BLACK):
                bonus -= 55.0
            if move.to_square == chess.F6 and board_before.piece_at(chess.F7) == chess.Piece(chess.PAWN, chess.BLACK):
                bonus -= 45.0

    structure_before = _evaluate_pawn_structure(board_before, us)
    board_after = board_before.copy()
    board_after.push(move)
    structure_after = _evaluate_pawn_structure(board_after, us)

    bonus += structure_after - structure_before

    return bonus, note


def static_board_eval_cp(board: chess.Board, perspective: chess.Color) -> float:
    if board.is_checkmate():
        return -100000.0 if board.turn == perspective else 100000.0
    if board.is_stalemate() or board.is_insufficient_material():
        return 0.0

    score = 0.0
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if not p:
            continue
        val = float(PIECE_VALUES[p.piece_type])
        if sq in CENTER_SQUARES:
            val += 25.0 if p.piece_type == chess.PAWN else 15.0
        elif sq in EXTENDED_CENTER:
            val += 15.0 if p.piece_type == chess.PAWN else 8.0

        if p.color == perspective:
            score += val
        else:
            score -= val
    return score


def analyse_with_stockfish(
        board: chess.Board,
        engine_path: str | None,
        skill_level: int = 7,
        uci_elo: int | None = 1850,
        depth: int = 6,
        time_limit: float = 0.25,
        multipv: int = 6,
) -> dict[chess.Move, float]:
    if not engine_path or not os.path.exists(engine_path):
        return {}

    scores: dict[chess.Move, float] = {}
    try:
        with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
            options: dict[str, int | bool] = {"Skill Level": skill_level}
            if uci_elo is not None:
                if "UCI_LimitStrength" in engine.options:
                    options["UCI_LimitStrength"] = True
                if "UCI_Elo" in engine.options:
                    min_elo = getattr(engine.options["UCI_Elo"], "min", 1320) or 1320
                    max_elo = getattr(engine.options["UCI_Elo"], "max", 3190) or 3190
                    options["UCI_Elo"] = max(min_elo, min(max_elo, uci_elo))
            engine.configure(options)

            infos = engine.analyse(
                board,
                chess.engine.Limit(depth=depth, time=time_limit),
                multipv=min(multipv, board.legal_moves.count()),
            )
            if isinstance(infos, dict):
                infos = [infos]
            for info in infos:
                pv = info.get("pv")
                if pv:
                    mv = pv[0]
                    cp = info["score"].pov(board.turn).score(mate_score=100000)
                    if cp is not None:
                        scores[mv] = float(cp)
    except Exception as exc:
        logger.warning("Ошибка запуска Stockfish (%s): %s", engine_path, exc)
        return {}

    return scores


class PhilidorBot:
    """Филидор (~1850 Эло, depth=6, skill=7, с человеческим таймингом)."""

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 7,
            uci_elo: int = 1850,
            search_depth: int = 6,
    ):
        self._explicit_stockfish_path = stockfish_path
        self.stockfish_path = resolve_stockfish_path(stockfish_path)
        self.skill_level = skill_level
        self.uci_elo = uci_elo
        self.search_depth = search_depth

    def _get_active_engine_path(self) -> str | None:
        if self._explicit_stockfish_path is not None:
            return self._explicit_stockfish_path if os.path.exists(self._explicit_stockfish_path) else None
        if self.stockfish_path and os.path.exists(self.stockfish_path):
            return self.stockfish_path
        self.stockfish_path = resolve_stockfish_path()
        return self.stockfish_path

    def choose_move(self, fen: str) -> dict:
        board = chess.Board(fen)
        if board.is_game_over():
            raise ValueError("Game is already over")

        # 1. Проверяем дебютную книгу
        fen_key = normalize_fen_key(board)
        if fen_key in PHILIDOR_OPENING_BOOK:
            candidates = PHILIDOR_OPENING_BOOK[fen_key]
            valid_book_moves = []
            for item in candidates:
                uci_str, weight, comment = item[0], int(item[1]), item[2]
                if uci_str == "0000":
                    continue
                try:
                    move = chess.Move.from_uci(uci_str)
                except ValueError:
                    continue
                if move in board.legal_moves:
                    valid_book_moves.append((move, weight, comment))

            if valid_book_moves:
                _simulate_human_thinking_time(board, is_book_move=True)
                moves, weights, comments = zip(*valid_book_moves)
                idx = random.choices(range(len(moves)), weights=weights, k=1)[0]
                chosen_move = moves[idx]
                san = board.san(chosen_move)
                board.push(chosen_move)
                return {
                    "uci": chosen_move.uci(),
                    "san": san,
                    "fen_after": board.fen(),
                    "source": "opening_book",
                    "comment": comments[idx],
                }

        # Имитируем раздумья человека
        _simulate_human_thinking_time(board, is_book_move=False)

        # 2. Тактический расчёт Stockfish
        engine_path = self._get_active_engine_path() if self.stockfish_path is not None else None
        base_scores = analyse_with_stockfish(
            board=board,
            engine_path=engine_path,
            skill_level=self.skill_level,
            uci_elo=self.uci_elo,
            depth=self.search_depth,
            time_limit=0.25,
            multipv=6,
        )

        if not base_scores:
            us = board.turn
            for mv in board.legal_moves:
                b1 = board.copy()
                b1.push(mv)
                if b1.is_checkmate():
                    base_scores[mv] = 100000.0
                    continue
                worst_reply_score = 100000.0
                for reply in b1.legal_moves:
                    b2 = b1.copy()
                    b2.push(reply)
                    s = static_board_eval_cp(b2, us)
                    if s < worst_reply_score:
                        worst_reply_score = s
                base_scores[mv] = worst_reply_score if b1.legal_moves.count() > 0 else 0.0

        # 3. Коридор уступки (120 cp) + разброс
        max_tactical_cp = max(base_scores.values())
        candidate_scores = {
                               mv: cp for mv, cp in base_scores.items()
                               if cp >= max_tactical_cp - PHILIDOR_BLUNDER_GUARD_CP
                           } or base_scores

        best_move = None
        best_total_score = -float("inf")
        best_comment = None

        for mv, tactical_cp in candidate_scores.items():
            style_bonus, note = evaluate_philidor_style_bonus(board, mv)
            jitter = random.uniform(-8.0, 8.0)
            total_score = tactical_cp + style_bonus + jitter

            if total_score > best_total_score:
                best_total_score = total_score
                best_move = mv
                best_comment = note

        if best_move is None:
            best_move = next(iter(board.legal_moves))

        san = board.san(best_move)
        board.push(best_move)

        return {
            "uci": best_move.uci(),
            "san": san,
            "fen_after": board.fen(),
            "source": "philidor_style_engine_deep",
            "comment": best_comment or "Пешки — душа шахмат. Строим несокрушимую пешечную цепь.",
        }


philidor_bot = PhilidorBot()
