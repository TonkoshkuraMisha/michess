from src.models.achievement import UserAchievement
from src.models.arena import Arena, ArenaGame, ArenaPlayer
from src.models.base import Base
from src.models.beta import Feedback, Invite
from src.models.collection import CollectionEntry
from src.models.email_token import EmailToken
from src.models.game import Game
from src.models.guess import GuessPosition
from src.models.imported_game import ImportedGame
from src.models.lesson import LessonProgress
from src.models.library import LibraryCollection, LibraryGame, LibraryGameCollection
from src.models.moderation import Report
from src.models.move import Move
from src.models.personality import BotPersonality
from src.models.position import PositionGame, PositionStat
from src.models.product_event import ProductEvent
from src.models.puzzle import DefenseDrill, DrillRecord, PersonalPuzzle, Puzzle, PuzzleAttempt, PuzzleTheme, ThemeProgress
from src.models.repertoire import Repertoire, RepertoireCard, RepertoireMove
from src.models.social import Block, DirectMessage, Follow, Notification
from src.models.study import StudyMaterial
from src.models.team import Team, TeamMember
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.models.trainer import ExamResult, TrainerResult
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
    "PositionGame",
    "PositionStat",
    "LessonProgress",
    "Move",
    "Report",
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

# This ensures all models are loaded when Alembic imports this file.
