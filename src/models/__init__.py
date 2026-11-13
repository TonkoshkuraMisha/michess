from src.models.base import Base
from src.models.game import Game
from src.models.move import Move
from src.models.personality import BotPersonality
from src.models.puzzle import DefenseDrill, PersonalPuzzle, Puzzle, PuzzleAttempt, PuzzleTheme, ThemeProgress
from src.models.user import User

__all__ = [
    "Base",
    "BotPersonality",
    "DefenseDrill",
    "Game",
    "Move",
    "PersonalPuzzle",
    "Puzzle",
    "PuzzleAttempt",
    "PuzzleTheme",
    "ThemeProgress",
    "User",
]

# This ensures all models are loaded when Alembic imports this file.
