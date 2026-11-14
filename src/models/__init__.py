from src.models.base import Base
from src.models.email_token import EmailToken
from src.models.game import Game
from src.models.lesson import LessonProgress
from src.models.move import Move
from src.models.personality import BotPersonality
from src.models.puzzle import DefenseDrill, DrillRecord, PersonalPuzzle, Puzzle, PuzzleAttempt, PuzzleTheme, ThemeProgress
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.models.user import User

__all__ = [
    "Base",
    "BotPersonality",
    "DefenseDrill",
    "DrillRecord",
    "EmailToken",
    "Game",
    "LessonProgress",
    "Move",
    "PersonalPuzzle",
    "Puzzle",
    "PuzzleAttempt",
    "PuzzleTheme",
    "ThemeProgress",
    "Tournament",
    "TournamentGame",
    "TournamentPlayer",
    "User",
]

# This ensures all models are loaded when Alembic imports this file.
