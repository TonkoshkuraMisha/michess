"""
Исторические мастера второй волны (таск 21.5): Стейниц, Ласкер, Рубинштейн, Капабланка, Алехин — давно умершие
шахматисты (правило 1), портреты уже есть со свободной лицензией (ATTRIBUTION.md, раздел портретов).

Каждый — соперник с характером мастерской (src/services/bots/personality.py: ползунки задают стиль, сила — по
target_elo) и своей дебютной книгой из его партий архива и библиотеки (scripts/build_master_books.py →
books/<id>.json). Имена, титулы и девизы — на клиенте (bots.profiles.<id>); девизы — свои формулировки стиля, не
цитаты. Сила уточняется калибровкой (scripts/calibrate_bots.py).
"""

from dataclasses import dataclass
from typing import ClassVar

import chess

from src.services.bots.base import BookEntry, HistoricalBot, load_bot_opening_book
from src.services.bots.personality import BotPersonalityConfig, PersonalityBot


@dataclass(frozen=True)
class Master:
    id: str
    pgn_name: str
    era: str
    rating: int
    config: BotPersonalityConfig
    # Как искать его партии в PGN: часть фамилии и исключения (однофамильцы).
    surname: str
    exclude: tuple[str, ...] = ()


def _cfg(target_elo: int, **fields) -> BotPersonalityConfig:
    return BotPersonalityConfig(target_elo=target_elo, **fields)


MASTERS: tuple[Master, ...] = (
    # Позиционная школа: укреплённый король, здоровая структура, атака — только когда позиция готова.
    Master("steinitz", "Steinitz, William", "1836–1900", 2050,
           _cfg(2050, aggression=-40, king_safety=160, pawn_structure=180, center_control=140, randomness=15,
                draw_attitude=-20), "steinitz"),
    # Практик и боец: играет против соперника, не уходит от сложностей.
    Master("lasker", "Lasker, Emanuel", "1868–1941", 2250,
           _cfg(2250, aggression=10, mobility=140, king_safety=120, randomness=25, draw_attitude=-50), "lasker",
           ("edward", "berthold")),
    # Мастер ладейного эндшпиля: структура, проходные, терпение.
    Master("rubinstein", "Rubinstein, Akiba", "1880–1961", 2200,
           _cfg(2200, aggression=-20, pawn_structure=170, center_control=130, passed_pawns=170, randomness=10),
           "rubinstein"),
    # Ясность и техника: простые позиции, точный эндшпиль, охотно упрощает.
    Master("capablanca", "Capablanca, Jose Raul", "1888–1942", 2300,
           _cfg(2300, aggression=-10, mobility=150, pawn_structure=150, passed_pawns=140, randomness=5,
                blunder_guard_cp=60, draw_attitude=30), "capablanca"),
    # Инициатива и комбинации: активные фигуры, центр, атака на короля.
    Master("alekhine", "Alekhine, Alexander", "1892–1946", 2300,
           _cfg(2300, aggression=80, mobility=170, center_control=150, king_safety=80, randomness=15,
                draw_attitude=-60), "alekhine"),
)
MASTERS_BY_ID = {m.id: m for m in MASTERS}


class MasterBot(PersonalityBot):
    """Мастер: стиль — ползунки характера, дебют — своя книга (как у исторических ботов первой волны)."""

    master: ClassVar[Master]

    def __init__(self, stockfish_path: str | None = None):
        super().__init__(self.master.config, stockfish_path)
        self.bot_id = self.master.id
        self.engine_source_name = f"{self.master.id}_style_engine"
        self.opening_book: dict[str, list[BookEntry]] = load_bot_opening_book(self.master.id)

    def _book_move(self, board: chess.Board) -> tuple[chess.Move, dict] | None:
        # Своя книга с репликой «… партий в архиве», а не любимые дебюты мастерской.
        return HistoricalBot._book_move(self, board)


# Отдельный класс на каждого мастера: турнирная симуляция создаёт свежего бота как type(bot)().
MASTER_CLASSES: dict[str, type[MasterBot]] = {
    m.id: type(f"{m.id.capitalize()}Bot", (MasterBot,), {"master": m}) for m in MASTERS
}
MASTER_BOTS: dict[str, MasterBot] = {key: cls() for key, cls in MASTER_CLASSES.items()}
