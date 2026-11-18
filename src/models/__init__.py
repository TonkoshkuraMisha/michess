"""
Все модели базы данных в одном месте.

Импорт каждого файла моделей здесь обязателен: Alembic берёт таблицы из Base.metadata после импорта этого пакета
(migrations/env.py), так же тесты создают схему. Модель из файла, который здесь не импортирован, не попадёт ни в
миграцию, ни в проверку `alembic check`. Таблица регистрируется при импорте своего файла, поэтому модель из уже
импортированного файла видна Alembic, даже если её имени нет в списке ниже (так сейчас с LibraryAnnotation из
library.py — её импортируют напрямую из src.models.library). Какие таблицы к какому разделу сайта относятся —
docs/ARCHITECTURE.md, раздел 3.
"""

from src.models.achievement import UserAchievement
from src.models.arena import Arena, ArenaAward, ArenaGame, ArenaPlayer, ArenaReminder
from src.models.base import Base
from src.models.beta import Feedback, Invite
from src.models.bot_memory import BotOpeningStat, BotRating, BotRival, BotRivalStat, BotTuning, BotTuningLog
from src.models.collection import CollectionEntry
from src.models.email_token import EmailToken
from src.models.game import Game
from src.models.guess import GuessPosition
from src.models.imported_game import ImportedGame
from src.models.ladder import LadderBeaten
from src.models.lesson import LessonProgress
from src.models.library import LibraryCollection, LibraryGame, LibraryGameCollection
from src.models.moderation import Report
from src.models.move import Move
from src.models.personality import BotPersonality
from src.models.position import PositionGame, PositionLibraryGame, PositionStat
from src.models.product_event import ProductEvent
from src.models.puzzle import DefenseDrill, DrillRecord, PersonalPuzzle, Puzzle, PuzzleAttempt, PuzzleTheme, ThemeProgress
from src.models.repertoire import Repertoire, RepertoireCard, RepertoireMove
from src.models.social import (
    Block,
    DirectMessage,
    Follow,
    HiddenConversation,
    Notification,
    Post,
    PostComment,
    PostLike,
)
from src.models.study import StudyMaterial
from src.models.team import Team, TeamMember
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.models.trainer import ExamResult, TrainerResult
from src.models.user import User

__all__ = [
    "BotOpeningStat",
    "BotRating",
    "BotRival",
    "BotRivalStat",
    "BotTuning",
    "BotTuningLog",
    "Arena",
    "ArenaAward",
    "ArenaGame",
    "ArenaPlayer",
    "ArenaReminder",
    "Base",
    "BotPersonality",
    "DefenseDrill",
    "DrillRecord",
    "EmailToken",
    "Feedback",
    "Invite",
    "Game",
    "CollectionEntry",
    "Follow",
    "GuessPosition",
    "ImportedGame",
    "Notification",
    "DirectMessage",
    "Block",
    "Post",
    "PostComment",
    "PostLike",
    "HiddenConversation",
    "PositionGame",
    "PositionLibraryGame",
    "PositionStat",
    "LessonProgress",
    "Move",
    "Report",
    "LadderBeaten",
    "PersonalPuzzle",
    "ProductEvent",
    "Puzzle",
    "PuzzleAttempt",
    "PuzzleTheme",
    "ThemeProgress",
    "LibraryCollection",
    "LibraryGame",
    "LibraryGameCollection",
    "Repertoire",
    "RepertoireCard",
    "RepertoireMove",
    "ExamResult",
    "TrainerResult",
    "StudyMaterial",
    "Team",
    "TeamMember",
    "Tournament",
    "TournamentGame",
    "TournamentPlayer",
    "User",
    "UserAchievement",
]

# Импорты выше нужны ради побочного эффекта: при импорте этого пакета все таблицы оказываются в Base.metadata.
