# --- FILE: src/services/achievements.py ---
"""
Достижения и звания клуба (таск 17.6) — только за реальные результаты. Условия считаются по данным, которые уже есть
(партии, попытки задач, прогресс уроков, турниры, арены, рейтинги, команды); открытое достижение запоминается с
датой (user_achievements) и больше не теряется. Тексты — в каталогах клиента (achievements.<код>).

Звание клуба — по лучшему рейтингу в категориях, после TITLE_MIN_GAMES рейтинговых партий (иначе «новичок клуба»).
"""

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.achievement import UserAchievement
from src.models.arena import ArenaPlayer
from src.models.game import Game, GameStatus
from src.models.lesson import LessonProgress
from src.models.puzzle import PuzzleAttempt
from src.models.team import TeamMember
from src.models.tournament import Tournament, TournamentPlayer
from src.models.trainer import TrainerResult
from src.models.user import RatingCategory, User
from src.services import arena_awards

# Категории рейтинга партий с людьми; звание и достижения rating_* берут лучший рейтинг из четырёх.
CATEGORIES: tuple[RatingCategory, ...] = ("bullet", "blitz", "rapid", "classical")
# Сколько партий (сумма счётчиков *_games_played по четырём категориям) нужно сыграть, чтобы получить звание.
TITLE_MIN_GAMES = 10
# Звания клуба: (нижняя граница лучшего рейтинга, код звания), от старшего к младшему — берётся первое подходящее.
TITLES = ((2000, "club_master"), (1700, "candidate"), (1400, "first_class"), (1000, "amateur"), (0, "beginner"))
# Число разделов азбуки (записи lesson_progress с кодом basics-<раздел>); все пройдены — достижение basics_done.
BASICS_SECTIONS = 8
# Обход конём: за открытый — до 100 очков (OPEN_TOUR_SCORE минус подсказки), за замкнутый — от 110 (CLOSED_TOUR_SCORE
# = 200 минус не больше 90 за подсказки); константы — frontend/src/trainers/boardPuzzles.ts. Очки считает клиент,
# сервер хранит присланный результат (trainer_results).
CLOSED_TOUR_MIN = 100


@dataclass(frozen=True)
class Rule:
    """Достижение: код (ключ текста achievements.<код> на клиенте), имя счётчика из _metrics и порог открытия."""
    code: str
    metric: str
    target: int


RULES = (
    Rule("first_game", "games", 1),
    Rule("wins_10", "wins", 10),
    Rule("wins_100", "wins", 100),
    Rule("human_win", "human_wins", 1),
    Rule("puzzles_100", "puzzles", 100),
    Rule("puzzles_1000", "puzzles", 1000),
    Rule("puzzle_rating_1800", "puzzle_rating", 1800),
    Rule("lessons_10", "lessons", 10),
    Rule("basics_done", "basics", BASICS_SECTIONS),
    Rule("endgames_10", "endgames", 10),
    Rule("tournament_podium", "podiums", 1),
    Rule("tournament_win", "tournament_wins", 1),
    Rule("invitation", "invitations", 1),
    Rule("arena_10", "arena_games", 10),
    Rule("arena_podium", "arena_podiums", 1),
    Rule("arena_win", "arena_wins", 1),
    Rule("rating_1500", "best_rating", 1500),
    Rule("rating_1800", "best_rating", 1800),
    Rule("rating_2000", "best_rating", 2000),
    Rule("team_player", "team", 1),
    Rule("knight_tour_closed", "closed_tours", 1),
)


async def _metrics(db: AsyncSession, user: User) -> dict[str, int]:
    """
    Счётчики игрока, с которыми сравниваются пороги RULES. Источники: games (законченные партии без симуляций
    турниров; human_wins — победы, где оба игрока не боты), puzzle_attempts (решённые), lesson_progress (пройденные
    записи, делятся по началу кода: basics-, endgame-, остальное — уроки), tournament_players (место в законченном
    турнире, из которого игрок не вышел; приглашение — турнир карьеры со ступенью invitational*), arena_players
    (сумма партий в аренах), arena_awards (призовые места в аренах, arena_awards.trophies), team_members,
    trainer_results (обход конём) и рейтинги из users.
    """
    finished =(Game.status == GameStatus.COMPLETED) & Game.is_simulation.is_(False)
    mine = (Game.white_player_id == user.id) | (Game.black_player_id == user.id)
    games = await db.scalar(select(func.count()).select_from(Game).where(finished, mine)) or 0
    wins = await db.scalar(select(func.count()).select_from(Game).where(finished, Game.winner_id == user.id)) or 0
    bots = select(User.id).where(User.is_bot.is_(True))
    human_wins = await db.scalar(select(func.count()).select_from(Game).where(
        finished, Game.winner_id == user.id, Game.white_player_id.not_in(bots), Game.black_player_id.not_in(bots))) or 0
    puzzles = await db.scalar(select(func.count()).select_from(PuzzleAttempt).where(
        PuzzleAttempt.user_id == user.id, PuzzleAttempt.solved.is_(True))) or 0
    completed = (LessonProgress.user_id == user.id) & LessonProgress.completed_at.is_not(None)
    # Уроки — без упражнений азбуки и эндшпиля (у них свои достижения). Отбор — по началу кода записи: всё, что не
    # basics-* и не endgame-*, считается уроком.
    lessons = await db.scalar(select(func.count()).select_from(LessonProgress).where(
        completed, LessonProgress.lesson_id.not_like("basics-%"), LessonProgress.lesson_id.not_like("endgame-%"))) or 0
    basics = await db.scalar(select(func.count()).select_from(LessonProgress).where(
        completed, LessonProgress.lesson_id.like("basics-%"))) or 0
    endgames = await db.scalar(select(func.count()).select_from(LessonProgress).where(
        completed, LessonProgress.lesson_id.like("endgame-%"))) or 0
    placed = select(TournamentPlayer.place, Tournament.career_stage).join(
        Tournament, Tournament.id == TournamentPlayer.tournament_id).where(
        TournamentPlayer.user_id == user.id, Tournament.status == "finished", Tournament.withdrawn_at.is_(None),
        TournamentPlayer.place.is_not(None))
    places = (await db.execute(placed)).all()
    arena_games = await db.scalar(
        select(func.coalesce(func.sum(ArenaPlayer.games), 0)).where(ArenaPlayer.user_id == user.id)) or 0
    awards = await arena_awards.trophies(db, user.id)
    team = await db.scalar(select(func.count()).select_from(TeamMember).where(TeamMember.user_id == user.id)) or 0
    # Замкнутый обход конём 8×8 (таск 19.4, уровень 3 тренажёра): за замкнутый обход записано больше 100 очков.
    closed_tours = await db.scalar(select(func.count()).select_from(TrainerResult).where(
        TrainerResult.user_id == user.id, TrainerResult.trainer == "knight_tour", TrainerResult.level == 3,
        TrainerResult.score > CLOSED_TOUR_MIN)) or 0
    return {
        "games": games, "wins": wins, "human_wins": human_wins, "puzzles": puzzles, "puzzle_rating": user.puzzle_rating,
        "lessons": lessons, "basics": basics, "endgames": endgames,
        "podiums": sum(1 for place, _ in places if place <= 3),
        "tournament_wins": sum(1 for place, _ in places if place == 1),
        "invitations": sum(1 for _, stage in places if stage and stage.startswith("invitational")),
        "arena_games": int(arena_games), "best_rating": _best_rating(user),
        "arena_podiums": sum(awards.values()), "arena_wins": awards["gold"],
        "team": team,
        "closed_tours": closed_tours,
    }


def _best_rating(user: User) -> int:
    return max(int(user.rating_for(c)) for c in CATEGORIES)


def title(user: User) -> str:
    """
    Код звания клуба: newcomer, пока в четырёх категориях вместе сыграно меньше TITLE_MIN_GAMES партий; дальше — по
    лучшему из четырёх рейтингов (таблица TITLES).
    """
    rated = 0
    for c in CATEGORIES:
        rated += int(user.games_played_for(c) or 0)
    if rated < TITLE_MIN_GAMES:
        return "newcomer"
    best = _best_rating(user)
    return next(code for threshold, code in TITLES if best >= threshold)


def _earned_at(item: UserAchievement | None) -> str | None:
    return item.earned_at.isoformat() if item is not None and item.earned_at else None


async def evaluate(db: AsyncSession, user: User) -> dict:
    """
    Звание и все достижения с прогрессом (не больше порога) и датой открытия. Достижения, условие которых выполнено
    впервые, записываются в user_achievements (commit) и в этом ответе помечаются "new".
    """
    metrics = await _metrics(db, user)
    earned = {a.code: a for a in (await db.execute(
        select(UserAchievement).where(UserAchievement.user_id == user.id))).scalars()}
    fresh = []
    for rule in RULES:
        if rule.code not in earned and metrics[rule.metric] >= rule.target:
            item = UserAchievement(user_id=user.id, code=rule.code)
            db.add(item)
            fresh.append(item)
    if fresh:
        await db.commit()
        for item in fresh:
            await db.refresh(item)
            earned[item.code] = item
    return {
        "title": title(user),
        "achievements": [{
            "code": rule.code, "target": rule.target, "progress": min(metrics[rule.metric], rule.target),
            "earned_at": _earned_at(earned.get(rule.code)),
            "new": any(item.code == rule.code for item in fresh),
        } for rule in RULES],
    }
