from src.models.arena import Arena, ArenaGame, ArenaPlayer
from src.models.base import Base
from src.models.collection import CollectionEntry
from src.models.email_token import EmailToken
from src.models.game import Game
from src.models.guess import GuessPosition
from src.models.lesson import LessonProgress
from src.models.move import Move
from src.models.personality import BotPersonality
from src.models.position import PositionGame, PositionStat
from src.models.product_event import ProductEvent
from src.models.puzzle import DefenseDrill, DrillRecord, PersonalPuzzle, Puzzle, PuzzleAttempt, PuzzleTheme, ThemeProgress
from src.models.social import Follow, Notification
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.models.trainer import TrainerResult
from src.models.user import User

__all__ = [
    "Arena",
    "ArenaGame",
    "ArenaPlayer",
    "Base",
    "BotPersonality",
    "DefenseDrill",
    "DrillRecord",
    "EmailToken",
    "Game",
    "CollectionEntry",
    "Follow",
    "GuessPosition",
    "Notification",
    "PositionGame",
    "PositionStat",
    "LessonProgress",
    "Move",
    "PersonalPuzzle",
    "ProductEvent",
    "Puzzle",
    "PuzzleAttempt",
    "PuzzleTheme",
    "ThemeProgress",
    "TrainerResult",
    "Tournament",
    "TournamentGame",
    "TournamentPlayer",
    "User",
]

# This ensures all models are loaded when Alembic imports this file.
