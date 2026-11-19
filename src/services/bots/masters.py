"""
Исторические мастера (таск 21.5): Стейниц, Ласкер, Рубинштейн, Капабланка, Алехин, затем Чигорин, Тарраш,
Пильсбери, Маршалл, Нимцович, Рети, Тартаковер, Ботвинник, Таль, Петросян — умершие шахматисты (правило 1; последних
трёх — решение владельца 16.11), портреты со свободной лицензией (ATTRIBUTION.md, раздел портретов).

Каждый — соперник с характером мастерской (src/services/bots/personality.py: ползунки задают стиль, сила — по
target_elo) и своей дебютной книгой из его партий архива и библиотеки (scripts/build_master_books.py →
books/<id>.json). Имена, титулы и девизы — на клиенте (bots.profiles.<id>); девизы — свои формулировки стиля, не
цитаты. Сила уточняется калибровкой (scripts/calibrate_bots.py).

Данные — реестр MASTERS: новый мастер — новая запись, а не правка кода. Готовые боты MASTER_BOTS попадают в реестр
bots/__init__.py (BOT_INSTANCES) и в маршруты src/api/bots.py (там же читается MASTERS).
"""

from dataclasses import dataclass
from typing import ClassVar

import chess

from src.services.bots.base import BookEntry, HistoricalBot, load_bot_opening_book
from src.services.bots.personality import BotPersonalityConfig, PersonalityBot


@dataclass(frozen=True)
class Master:
    """
    Исторический мастер второй волны: id, имя для PGN, годы жизни, сила, настройки характера и признаки, по которым
    его партии находятся в PGN.
    """
    id: str
    # Имя для PGN: «Фамилия, Имя» латиницей.
    pgn_name: str
    # Годы жизни.
    era: str
    # Заявленная сила; совпадает с target_elo в config.
    rating: int
    config: BotPersonalityConfig
    # Как искать его партии в PGN: часть фамилии и исключения (однофамильцы).
    surname: str
    exclude: tuple[str, ...] = ()


def _cfg(target_elo: int, **fields) -> BotPersonalityConfig:
    """Сокращение для таблицы: характер с заданным target_elo и остальными полями-ползунками."""
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
    # Третья волна (16.11): мастера из списка 21.5 и чемпионы мира 1948–1969 (решение владельца 16.11). Партии для
    # книг — архив и библиотека (коллекция «Партии мастеров»).
    # Фигурная игра и атака: кони против слонов, борьба против догм.
    Master("chigorin", "Chigorin, Mikhail", "1850–1908", 2150,
           _cfg(2150, aggression=60, mobility=160, king_safety=90, randomness=25, draw_attitude=-50), "chigorin", ()),
    # Классика: центр, подвижные фигуры, простор.
    Master("tarrasch", "Tarrasch, Siegbert", "1862–1934", 2200,
           _cfg(2200, aggression=0, center_control=170, mobility=160, pawn_structure=120, randomness=10),
           "tarrasch", ()),
    # Атака на короля по ферзевому гамбиту, острая игра.
    Master("pillsbury", "Pillsbury, Harry Nelson", "1872–1906", 2250,
           _cfg(2250, aggression=60, mobility=150, king_safety=90, randomness=15, draw_attitude=-40), "pillsbury", ()),
    # Гамбиты и ловушки: инициатива любой ценой.
    Master("marshall", "Marshall, Frank James", "1877–1944", 2200,
           _cfg(2200, aggression=90, mobility=150, king_safety=70, randomness=25, draw_attitude=-60), "marshall", ()),
    # Блокада, сверхзащита и контроль центра фигурами издалека.
    Master("nimzowitsch", "Nimzowitsch, Aron", "1886–1935", 2250,
           _cfg(2250, aggression=-30, pawn_structure=170, king_safety=140, center_control=110, randomness=15),
           "nimzowitsch", ()),
    # Гипермодерн: фланговые начала и давление на центр.
    Master("reti", "Reti, Richard", "1889–1929", 2200,
           _cfg(2200, aggression=-10, center_control=130, mobility=140, randomness=15), "reti,", ()),
    # Неожиданные дебюты и практичная игра.
    Master("tartakower", "Tartakower, Savielly", "1887–1956", 2150,
           _cfg(2150, aggression=20, mobility=130, randomness=30, draw_attitude=0), "tartakower", ()),
    # Глубокий план, подготовка и техника.
    Master("botvinnik", "Botvinnik, Mikhail", "1911–1995", 2400,
           _cfg(2400, aggression=10, pawn_structure=160, center_control=150, king_safety=130, randomness=5,
                blunder_guard_cp=60),
           "botvinnik", ()),
    # Жертвы и атака: позиция в огне.
    Master("tal", "Tal, Mikhail", "1936–1992", 2450,
           _cfg(2450, aggression=100, mobility=180, king_safety=60, randomness=30, draw_attitude=-80), "tal,", ()),
    # Профилактика и безопасность: сначала отнять у соперника всё.
    Master("petrosian", "Petrosian, Tigran", "1929–1984", 2400,
           _cfg(2400, aggression=-60, king_safety=180, pawn_structure=160, randomness=5, blunder_guard_cp=80,
                draw_attitude=40),
           "petrosian", ("arshak",)),
)
# Поиск мастера по id (ключу бота в реестре).
MASTERS_BY_ID = {m.id: m for m in MASTERS}


class MasterBot(PersonalityBot):
    """Мастер: стиль — ползунки характера, дебют — своя книга (как у исторических ботов первой волны)."""

    # Задаётся в классе, созданном для конкретного мастера (см. MASTER_CLASSES).
    master: ClassVar[Master]

    def __init__(self, stockfish_path: str | None = None):
        """Бот по настройкам мастера: id, источник хода и книга — его собственные, а не «custom» из PersonalityBot."""
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
# Готовые экземпляры по id; реестр bots/__init__.py добавляет их в BOT_INSTANCES.
MASTER_BOTS: dict[str, MasterBot] = {key: cls() for key, cls in MASTER_CLASSES.items()}
