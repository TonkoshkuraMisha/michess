# --- FILE: scripts/style_metrics.py ---
"""
Характер ботов в миттельшпиле по партиям калибровки (таск B.5): виден ли стиль не только в дебютной книге.

    python scripts/calibrate_bots.py --only morphy staunton --rounds 4 --pgn scripts/calibration_runs/style.pgn
    python scripts/style_metrics.py scripts/calibration_runs/style.pgn

Считается только миттельшпиль — с MIDDLEGAME_FROM_PLY и пока на доске не меньше MIDDLEGAME_MIN_PIECES очков
фигур (без пешек). Метрики — на 100 ходов игрока, без движка, по материалу:
* жертвы — после хода и ответа соперника материал игрока ниже, чем до хода, на SACRIFICE_PAWNS и больше, и через
  ход его ещё не отыграли (взятие с немедленным отыгрышем жертвой не считается). Без движка жертву не отличить от
  зевка — поэтому сравнивать ботов примерно одной силы;
* размены — взятие фигуры (не пешки) равной ценности, на которое соперник сразу отвечает взятием на том же поле;
* шахи;
* давление на короля — сколько раз фигуры игрока бьют поля вокруг короля соперника (в среднем после хода);
* штурм — ходы пешкой вперёд на фланге короля соперника (вертикали короля ±1), за пределы своей половины доски.

Ожидание по характерам: у романтиков (Лабурдонне, Андерсен, Морфи, Цукерторт) жертв, шахов и давления на короля
больше, у Стаунтона и Паульсена — больше разменов и меньше жертв. Сравнивать игроков между собой при сходной силе:
сильный бот чаще получает выигранную позицию и атакует просто потому, что сильнее.
"""

import argparse
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import chess
import chess.pgn

MIDDLEGAME_FROM_PLY = 16
MIDDLEGAME_MIN_PIECES = 26
SACRIFICE_PAWNS = 2

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def material(board: chess.Board, color: chess.Color) -> int:
    """Материал стороны минус материал соперника, в пешках."""
    return sum(
        VALUES[piece.piece_type] * (1 if piece.color == color else -1) for piece in board.piece_map().values()
    )


def piece_material(board: chess.Board) -> int:
    """Фигуры обеих сторон без пешек и королей — по нему видно, что дело дошло до эндшпиля."""
    return sum(VALUES[p.piece_type] for p in board.piece_map().values() if p.piece_type != chess.PAWN)


def king_zone_attacks(board: chess.Board, color: chess.Color) -> int:
    """Сколько раз фигуры стороны бьют короля соперника и поля вокруг него."""
    king = board.king(not color)
    if king is None:
        return 0
    zone = chess.SquareSet(chess.BB_KING_ATTACKS[king]) | chess.SquareSet.from_square(king)
    return sum(len(board.attackers(color, square)) for square in zone)


@dataclass
class PlayerStats:
    games: int = 0
    moves: int = 0
    sacrifices: int = 0
    trades: int = 0
    checks: int = 0
    king_pressure: int = 0
    storm: int = 0
    opponents: set[str] = field(default_factory=set)

    def per_100(self, value: int) -> float:
        return 100.0 * value / self.moves if self.moves else 0.0

    def row(self) -> dict[str, float]:
        return {
            "sacrifices": self.per_100(self.sacrifices),
            "trades": self.per_100(self.trades),
            "checks": self.per_100(self.checks),
            "king_pressure": self.king_pressure / self.moves if self.moves else 0.0,
            "storm": self.per_100(self.storm),
        }


def _is_storm(board: chess.Board, move: chess.Move, color: chess.Color) -> bool:
    piece = board.piece_at(move.from_square)
    king = board.king(not color)
    if piece is None or piece.piece_type != chess.PAWN or king is None or board.is_capture(move):
        return False
    if abs(chess.square_file(move.to_square) - chess.square_file(king)) > 1:
        return False
    rank = chess.square_rank(move.to_square)
    return rank >= 4 if color == chess.WHITE else rank <= 3


def _is_trade(before: chess.Board, move: chess.Move, after: chess.Board, reply: chess.Move) -> bool:
    """Взятие фигуры равной ценности, на которое соперник сразу отвечает взятием на том же поле."""
    captured = before.piece_at(move.to_square)
    mover = before.piece_at(move.from_square)
    if captured is None or mover is None or captured.piece_type == chess.PAWN:
        return False
    if VALUES[captured.piece_type] != VALUES[mover.piece_type]:
        return False
    return reply.to_square == move.to_square and after.is_capture(reply)


def game_stats(game: chess.pgn.Game, from_ply: int = MIDDLEGAME_FROM_PLY) -> dict[chess.Color, PlayerStats]:
    """Метрики одной партии для белых и чёрных."""
    stats = {chess.WHITE: PlayerStats(games=1), chess.BLACK: PlayerStats(games=1)}
    board = game.board()
    moves = list(game.mainline_moves())
    # Позиции до каждого полухода и после последнего: по ним видно, что стало с материалом через 2 и 4 полухода.
    positions = [board.copy(stack=False)]
    for move in moves:
        board.push(move)
        positions.append(board.copy(stack=False))

    for i, move in enumerate(moves):
        before = positions[i]
        color = before.turn
        ply = before.ply()
        if ply < from_ply or piece_material(before) < MIDDLEGAME_MIN_PIECES:
            continue
        player = stats[color]
        player.moves += 1
        after = positions[i + 1]
        start = material(before, color)
        reply = positions[min(i + 2, len(moves))]
        later = positions[min(i + 4, len(moves))]
        if (material(reply, color) <= start - SACRIFICE_PAWNS and material(later, color) <= start - SACRIFICE_PAWNS
                and not after.is_checkmate()):
            player.sacrifices += 1
        if i + 1 < len(moves) and _is_trade(before, move, after, moves[i + 1]):
            player.trades += 1
        if after.is_check():
            player.checks += 1
        player.king_pressure += king_zone_attacks(after, color)
        if _is_storm(before, move, color):
            player.storm += 1
    return stats


def collect(path: Path, from_ply: int = MIDDLEGAME_FROM_PLY) -> dict[str, PlayerStats]:
    """Метрики по всем партиям файла, по игрокам (заголовки White/Black)."""
    totals: dict[str, PlayerStats] = defaultdict(PlayerStats)
    with path.open(encoding="utf-8") as handle:
        while (game := chess.pgn.read_game(handle)) is not None:
            names = {chess.WHITE: game.headers.get("White", "?"), chess.BLACK: game.headers.get("Black", "?")}
            for color, stats in game_stats(game, from_ply).items():
                total = totals[names[color]]
                total.games += stats.games
                total.moves += stats.moves
                total.sacrifices += stats.sacrifices
                total.trades += stats.trades
                total.checks += stats.checks
                total.king_pressure += stats.king_pressure
                total.storm += stats.storm
                total.opponents.add(names[not color])
    return dict(totals)


def report(totals: dict[str, PlayerStats], with_anchors: bool = False) -> str:
    header = f"{'игрок':<28}{'партий':>7}{'ходов':>7}{'жертвы':>8}{'размены':>9}{'шахи':>7}{'давл.':>7}{'штурм':>7}"
    lines = [header, "-" * len(header)]
    for name in sorted(totals, key=lambda n: -totals[n].row()["sacrifices"]):
        if name.startswith("anchor:") and not with_anchors:
            continue
        stats = totals[name]
        row = stats.row()
        lines.append(
            f"{name:<28}{stats.games:>7}{stats.moves:>7}{row['sacrifices']:>8.1f}{row['trades']:>9.1f}"
            f"{row['checks']:>7.1f}{row['king_pressure']:>7.2f}{row['storm']:>7.1f}"
        )
    lines.append("жертвы, размены, шахи, штурм — на 100 ходов миттельшпиля; давл. — атак на зону короля после хода")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pgn", type=Path, help="PGN партий калибровки (calibrate_bots.py --pgn)")
    parser.add_argument("--from-ply", type=int, default=MIDDLEGAME_FROM_PLY, help="С какого полухода миттельшпиль")
    parser.add_argument("--anchors", action="store_true", help="Показать и якоря Stockfish (для сравнения)")
    args = parser.parse_args()
    if not args.pgn.exists():
        raise SystemExit(f"Нет файла {args.pgn}")
    print(report(collect(args.pgn, args.from_ply), args.anchors))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    main()
