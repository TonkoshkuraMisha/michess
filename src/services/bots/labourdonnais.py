# --- FILE: src/services/bots/labourdonnais.py ---

import random
import shutil
import chess
import chess.engine
from src.services.bots.philidor import (
    CENTER_SQUARES,
    EXTENDED_CENTER,
    normalize_fen_key,
    static_board_eval_cp,
)

# Дебютная книга Луи-Шарля Маэ де Лабурдонне (на основе 20 исторических партий, вкл. матчи с Мак-Доннеллом 1834 г.)
LABOURDONNAIS_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 65, "Любимый ход Лабурдонне в атаке: открываем линии для фигур! (13 партий)."),
        ("d2d4", 35, "Ферзевый гамбит в стиле матчей с Мак-Доннеллом (7 партий)."),
    ],
    "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -": [
        ("d7d5", 100, "Принимаем бой в центре доски: d7-d5 (7 партий)."),
    ],
    "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -": [
        ("c2c4", 100, "Ферзевый гамбит! Жертвуем пешку ради темпа и захвата центра (7 партий)."),
    ],
    "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq -": [
        ("d5c4", 86, "Принимаем гамбит d5xc4, вскрывая игру (6 партий)."),
        ("e7e6", 14, "Укрепляем центр ходом e7-e6 (1 партия)."),
    ],
    "rnbqkbnr/ppp1pppp/8/8/2pP4/8/PP2PPPP/RNBQKBNR w KQkq -": [
        ("e2e3", 83, "Открываем диагональ слону f1 и готовим отыгрыш пешки (5 партий)."),
        ("e2e4", 17, "Немедленный захват всего центра пешками e4 и d4! (1 партия)."),
    ],
    "rnbqkbnr/ppp1pppp/8/8/2pP4/4P3/PP3PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 100, "Встречный удар в центре e7-e5! Никакой пассивной обороны (5 партий)."),
    ],
    "rnbqkbnr/ppp2ppp/8/4p3/2pP4/4P3/PP3PPP/RNBQKBNR w KQkq -": [
        ("f1c4", 100, "Слон выходит на ударную позицию c4, прицеливаясь к f7 (5 партий)."),
    ],
    "rnbqkbnr/ppp2ppp/8/4p3/2BP4/4P3/PP3PPP/RNBQK1NR b KQkq -": [
        ("e5d4", 100, "Вскрываем центральные вертикали: e5xd4 (5 партий)."),
    ],
    "rnbqkbnr/ppp2ppp/8/8/2Bp4/4P3/PP3PPP/RNBQK1NR w KQkq -": [
        ("e3d4", 100, "Боевая изолированная пешка d4 даёт простор для фигурной атаки (5 партий)."),
    ],
    "rnbqkbnr/ppp2ppp/8/8/2BP4/8/PP3PPP/RNBQK1NR b KQkq -": [
        ("g8f6", 100, "Выводим коня в бой и контролируем поле e4 (5 партий)."),
    ],
    "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -": [
        ("b1c3", 100, "Развиваем ферзевого коня для давления на d5."),
    ],
    "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq -": [
        ("g8f6", 100, "Быстрое развитие фигур королевского фланга."),
    ],
    "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq -": [
        ("g1f3", 100, "Гармонично вводим в бой второго коня."),
    ],
    "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq -": [
        ("c7c5", 100, "Атакуем центр белых ходом c7-c5!"),
    ],
    "rnbqkb1r/pp3ppp/4pn2/2pp4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq -": [
        ("c4d5", 100, "Вскрываем игру в центре доски."),
    ],
    "rnbqkb1r/pp3ppp/4pn2/2pP4/3P4/2N2N2/PP2PPPP/R1BQKB1R b KQkq -": [
        ("e6d5", 100, "Освобождаем диагональ для белопольного слона c8."),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 100, "Открытый бой e7-e5 — в духе романтических дуэлей в «Кафе де ля Режанс»! (13 партий)."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("f2f4", 62, "Королевский гамбит! Жертвуем пешку ради стремительного штурма по линии f (8 партий)."),
        ("g1f3", 23, "Атакуем пешку e5 и готовим итальянскую партию или гамбит Эванса (3 партии)."),
        ("f1c4", 15, "Дебют слона — прямой прицел на поле f7 (2 партии)."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq -": [
        ("e5f4", 100, "Вызов принят! Забираем пешку e5xf4 (8 партий)."),
    ],
    "rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP2PP/RNBQKBNR w KQkq -": [
        ("g1f3", 88, "Королевский гамбит коня — захватываем центр и готовим рокировку (7 партий)."),
        ("f1c4", 12, "Гамбит слона! Пусть чёрный ферзь даёт шах на h4 — мы выиграем время для атаки!"),
    ],
    "rnbqkbnr/pppp1ppp/8/8/4Pp2/5N2/PPPP2PP/RNBQKB1R b KQkq -": [
        ("g7g5", 100, "Защищаем пешку f4 и готовимся согнать белого коня ходом g5-g4 (7 партий)."),
    ],
    "rnbqkbnr/pppp1p1p/8/6p1/4Pp2/5N2/PPPP2PP/RNBQKB1R w KQkq -": [
        ("f1c4", 86, "Выводим слона на c4, готовя острейший гамбит Муцио! (6 партий)."),
        ("h2h4", 14, "Подрываем пешечную цепь чёрных ходом h2-h4 (1 партия)."),
    ],
    "rnbqkbnr/pppp1p1p/8/6p1/2B1Pp2/5N2/PPPP2PP/RNBQK2R b KQkq -": [
        ("g5g4", 50, "Вперёд, g5-g4! Атакуем коня f3 (3 партии)."),
        ("f8g7", 50, "Укрепляем пункт h6 и ставим слона на большую диагональ (3 партии)."),
    ],
    "rnbqkbnr/pppp1p1p/8/8/2B1Ppp1/5N2/PPPP2PP/RNBQK2R w KQkq -": [
        ("b1c3", 67, "Гамбит Мак-Доннелла! Оставляем коня f3 под боем ради тотальной мобилизации! (2 партии)."),
        ("f3e5", 33, "Прыжок коня в самый центр на e5! (1 партия)."),
    ],
    "rnbqkbnr/pppp1p1p/8/8/2B1Ppp1/2N2N2/PPPP2PP/R1BQK2R b KQkq -": [
        ("g4f3", 100, "Принимаем жертву фигуры g4xf3 — проверим атаку соперника на прочность! (2 партии)."),
    ],
    "rnbqk1nr/pppp1pbp/8/6p1/2B1Pp2/5N2/PPPP2PP/RNBQK2R w KQkq -": [
        ("d2d4", 100, "Захватываем центр и открываем линию слону c1 (3 партии)."),
    ],
    "rnbqk1nr/pppp1pbp/8/6p1/2BPPp2/5N2/PPP3PP/RNBQK2R b KQkq -": [
        ("d7d6", 100, "Открываем диагональ белопольному слону c8 (3 партии)."),
    ],
    "rnbqkbnr/pppp1ppp/8/8/2B1Pp2/8/PPPP2PP/RNBQK1NR b KQkq -": [
        ("d8h4", 100, "Шах ферзём на h4! Лишаем белого короля рокировки."),
    ],
    "rnb1kbnr/pppp1ppp/8/8/2B1Pp1q/8/PPPP2PP/RNBQK1NR w KQkq -": [
        ("e1f1", 100, "Король отступает на f1, а мы выигрываем темпы с ходом Nf3!"),
    ],
    "rnb1kbnr/pppp1ppp/8/8/2B1Pp1q/8/PPPP2PP/RNBQ1KNR b kq -": [
        ("g7g5", 100, "Укрепляем пешку f4 на королевском фланге."),
    ],
    "rnb1kbnr/pppp1p1p/8/6p1/2B1Pp1q/8/PPPP2PP/RNBQ1KNR w kq -": [
        ("b1c3", 100, "Быстро вводим ферзевого коня в атаку."),
    ],
    "rnb1kbnr/pppp1p1p/8/6p1/2B1Pp1q/2N5/PPPP2PP/R1BQ1KNR b kq -": [
        ("f8g7", 100, "Развиваем слона на g7, прикрывая королевский фланг."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq -": [
        ("f8c5", 100, "Симметричный выход слона f8-c5 (2 партии)."),
    ],
    "rnbqk1nr/pppp1ppp/8/2b1p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("c2c3", 50, "Готовим прорыв в центре d2-d4."),
        ("g1f3", 50, "Развиваем коня и готовим рокировку."),
    ],
    "rnbqk1nr/pppp1ppp/8/2b1p3/2B1P3/2P5/PP1P1PPP/RNBQK1NR b KQkq -": [
        ("d8e7", 100, "Укрепляем пешку e5 и препятствуем d2-d4."),
    ],
    "rnb1k1nr/ppppqppp/8/2b1p3/2B1P3/2P5/PP1P1PPP/RNBQK1NR w KQkq -": [
        ("g1f3", 100, "Выводим коня на f3."),
    ],
    "rnb1k1nr/ppppqppp/8/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R b KQkq -": [
        ("d7d6", 100, "Открываем диагональ слону c8."),
    ],
    "rnb1k1nr/ppp1qppp/3p4/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w KQkq -": [
        ("e1g1", 100, "Рокировка! Вводим ладью f1 в бой (2 партии)."),
    ],
    "rnb1k1nr/ppp1qppp/3p4/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQ1RK1 b kq -": [
        ("c5b6", 50, "Уводим слона на b6 от удара d2-d4."),
        ("g8f6", 50, "Завершаем развитие королевского фланга."),
    ],
    "rnbqk1nr/pppp1ppp/8/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -": [
        ("d7d6", 100, "Защищаем пешку e5."),
    ],
    "rnbqk1nr/ppp2ppp/3p4/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("c2c3", 100, "Готовим захват центра d2-d4."),
    ],
    "rnbqk1nr/ppp2ppp/3p4/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R b KQkq -": [
        ("d8e7", 100, "Удерживаем центральный пункт e5."),
    ],
    "rnbqkbnr/ppp1pppp/8/8/2pPP3/8/PP3PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 100, "Контрудар по центру e7-e5!"),
    ],
    "rnbqkbnr/ppp2ppp/8/4p3/2pPP3/8/PP3PPP/RNBQKBNR w KQkq -": [
        ("d4d5", 100, "Создаём мощную проходную и захватываем пространство!"),
    ],
    "rnbqkbnr/ppp2ppp/8/3Pp3/2p1P3/8/PP3PPP/RNBQKBNR b KQkq -": [
        ("f7f5", 100, "Атакуем центр с фланга: f7-f5!"),
    ],
    "rnbqkbnr/ppp3pp/8/3Ppp2/2p1P3/8/PP3PPP/RNBQKBNR w KQkq -": [
        ("b1c3", 100, "Защищаем e4 и развиваем фигуру."),
    ],
    "rnbqkbnr/ppp3pp/8/3Ppp2/2p1P3/2N5/PP3PPP/R1BQKBNR b KQkq -": [
        ("g8f6", 100, "Развиваем коня с давлением на центр."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": [
        ("b8c6", 100, "Защищаем пешку e5 конём: 2... Nc6 (3 партии)."),
    ],
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": [
        ("f1c4", 100, "Итальянская партия — выводим слона на боевую диагональ a2-g8 (3 партии)."),
    ],
    "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -": [
        ("f8c5", 100, "Встречный выход слона f8-c5 (3 партии)."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("b2b4", 100, "Гамбит Эванса! Жертвуем пешку b4 ради молниеносного захвата центра! (3 партии)."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/1PB1P3/5N2/P1PP1PPP/RNBQK2R b KQkq -": [
        ("c5b4", 100, "Принимаем гамбит Эванса: слон бьёт b4 (3 партии)."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/4p3/1bB1P3/5N2/P1PP1PPP/RNBQK2R w KQkq -": [
        ("c2c3", 100, "С темпом атакуем слона и готовим d2-d4! (3 партии)."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/4p3/1bB1P3/2P2N2/P2P1PPP/RNBQK2R b KQkq -": [
        ("b4d6", 67, "Отводим слона на d6 для укрепления центра (2 партии)."),
        ("b4e7", 33, "Слон отступает на e7 (1 партия)."),
    ],
    "rnbqkbnr/pppp1p1p/8/4N3/2B1Ppp1/8/PPPP2PP/RNBQK2R b KQkq -": [
        ("d8h4", 100, "Немедленный выпад ферзём на h4 с шахом!"),
    ],
    "rnbqkbnr/pppp1p1p/8/6p1/4Pp1P/5N2/PPPP2P1/RNBQKB1R b KQkq -": [
        ("g5g4", 100, "Продвигаем g5-g4 в гамбите Кизерицкого!"),
    ],
    "rnbqkbnr/pppp1p1p/8/8/4PppP/5N2/PPPP2P1/RNBQKB1R w KQkq -": [
        ("f3g5", 100, "Атакующий прыжок коня на g5!"),
    ],
    "rnbqkbnr/pppp1p1p/8/6N1/4PppP/8/PPPP2P1/RNBQKB1R b KQkq -": [
        ("b8c6", 100, "Быстрое развитие ферзевого коня."),
    ],
}


def evaluate_labourdonnais_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    """
    Доктрина Лабурдонне: «Инициатива, темп и прямая атака на короля!».
    Поощряет быстрый вывод лёгких фигур, рокировку, шахи и вскрытие центра.
    """
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    # 1. Быстрая рокировка и ввод ладьи в бой
    if board_before.is_castling(move):
        bonus += 35.0
        note = "Рокировка! Вводим ладью в бой и готовим решительный штурм."

    # 2. Энергичное развитие лёгких фигур в дебюте
    if piece.piece_type in {chess.KNIGHT, chess.BISHOP} and board_before.fullmove_number <= 12:
        back_rank = 0 if board_before.turn == chess.WHITE else 7
        if chess.square_rank(move.from_square) == back_rank:
            bonus += 22.0
            note = "Быстро выводим фигуры в бой — каждый темп на счету!"
        if move.to_square in EXTENDED_CENTER:
            bonus += 15.0
            note = "Фигуры устремляются в центр для комбинационной атаки!"

    # 3. Захват центра и тактические удары
    if move.to_square in CENTER_SQUARES:
        bonus += 20.0
        if not note:
            note = "Захватываем инициативу в центре в духе французской романтической школы!"

    # 4. Поощрение шахов и прямой атаки
    if board_before.gives_check(move):
        bonus += 18.0
        note = "Шах! Не даём сопернику передышки!"
    elif board_before.is_capture(move):
        bonus += 10.0

    return bonus, note


class LabourdonnaisBot:
    """
    Исторический бот Луи-Шарля Маэ де Лабурдонне (1795–1840).
    Комбинационный атакующий стиль с дебютным репертуаром матчей 1834 года.
    """

    def __init__(self, stockfish_path: str | None = None, skill_level: int = 14):
        self.stockfish_path = stockfish_path or shutil.which("stockfish")
        self.skill_level = skill_level

    def choose_move(self, fen: str) -> dict:
        board = chess.Board(fen)
        if board.is_game_over():
            raise ValueError("Game is already over")

        # 1. Проверяем дебютную книгу Лабурдонне
        fen_key = normalize_fen_key(board)
        if fen_key in LABOURDONNAIS_OPENING_BOOK:
            candidates = LABOURDONNAIS_OPENING_BOOK[fen_key]
            valid_book_moves = []
            for item in candidates:
                uci_str, weight, comment = item[0], int(item[1]), item[2]
                try:
                    move = chess.Move.from_uci(uci_str)
                except ValueError:
                    continue
                if move in board.legal_moves:
                    valid_book_moves.append((move, weight, comment))

            if valid_book_moves:
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

        # 2. Тактический расчёт Stockfish
        base_scores: dict[chess.Move, float] = {}
        if self.stockfish_path:
            try:
                with chess.engine.SimpleEngine.popen_uci(self.stockfish_path) as engine:
                    engine.configure({"Skill Level": self.skill_level})
                    infos = engine.analyse(
                        board,
                        chess.engine.Limit(depth=12, time=0.3),
                        multipv=min(8, board.legal_moves.count()),
                    )
                    for info in infos:
                        pv = info.get("pv")
                        if pv:
                            mv = pv[0]
                            cp = info["score"].pov(board.turn).score(mate_score=100000) or 0
                            base_scores[mv] = float(cp)
            except Exception:
                base_scores = {}

        # Fallback: двухходовый минимакс при отсутствии бинарника Stockfish
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

        # 3. Применяем атакующий стиль Лабурдонне
        best_move = None
        best_total_score = -float("inf")
        best_comment = None

        for mv, tactical_cp in base_scores.items():
            style_bonus, note = evaluate_labourdonnais_style_bonus(board, mv)
            jitter = random.uniform(-2.5, 2.5)
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
            "source": "labourdonnais_style_engine",
            "comment": best_comment or "Атака и комбинационный натиск в стиле «Кафе де ля Режанс»!",
        }


labourdonnais_bot = LabourdonnaisBot()
