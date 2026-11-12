from src.models.user import RatingCategory

# Категория по оценке длительности партии (база + 40 ходов на добавление за ход) — та же
# эвристика, что использует lichess.org для разделения пули/блица/рапида/классики.
_BLITZ_THRESHOLD_S = 180
_RAPID_THRESHOLD_S = 480
_CLASSICAL_THRESHOLD_S = 1500
# Сколько ходов закладывается в оценку длительности партии.
ESTIMATED_MOVES = 40


def classify_time_control(base_time_ms: int, increment_ms: int) -> RatingCategory:
    estimated_s = base_time_ms / 1000 + ESTIMATED_MOVES * (increment_ms / 1000)
    if estimated_s < _BLITZ_THRESHOLD_S:
        return "bullet"
    if estimated_s < _RAPID_THRESHOLD_S:
        return "blitz"
    if estimated_s < _CLASSICAL_THRESHOLD_S:
        return "rapid"
    return "classical"


def category_duration_bounds_ms(category: RatingCategory) -> tuple[int | None, int | None]:
    """
    Границы категории [нижняя, верхняя) по оценке длительности base_time_ms + 40 * increment_ms.
    Нужны, чтобы отбирать партии категории в SQL тем же правилом, что и classify_time_control.
    """
    thresholds_ms = [_BLITZ_THRESHOLD_S * 1000, _RAPID_THRESHOLD_S * 1000, _CLASSICAL_THRESHOLD_S * 1000]
    lower = [None, *thresholds_ms]
    upper = [*thresholds_ms, None]
    index = ("bullet", "blitz", "rapid", "classical").index(category)
    return lower[index], upper[index]


class FideEloSystem:
    """
    Система подсчета рейтинга по стандартам ФИДЕ.
    Включает динамический K-фактор в зависимости от текущего рейтинга и опыта.
    """

    @staticmethod
    def get_k_factor(rating: int, games_played: int = 30) -> int:
        if games_played < 30:
            return 40
        if rating >= 2400:
            return 10
        return 20

    @staticmethod
    def expected_score(rating_a: int, rating_b: int) -> float:
        return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))

    @classmethod
    def calculate_new_ratings(
        cls,
        white_rating: int,
        black_rating: int,
        result: str,
        white_games: int = 30,
        black_games: int = 30
    ) -> tuple[int, int, int, int]:
        """
        Возвращает: (новый_рейтинг_белых, дельта_белых, новый_рейтинг_черных, дельта_черных)
        """
        if result in ("1-0", "white_won_on_time"):
            score_white, score_black = 1.0, 0.0
        elif result in ("0-1", "black_won_on_time"):
            score_white, score_black = 0.0, 1.0
        elif result in ("1/2-1/2", "draw_agreement"):
            score_white, score_black = 0.5, 0.5
        else:
            raise ValueError(f"Unknown game result: {result}")

        expected_white = cls.expected_score(white_rating, black_rating)
        expected_black = cls.expected_score(black_rating, white_rating)

        k_white = cls.get_k_factor(white_rating, white_games)
        k_black = cls.get_k_factor(black_rating, black_games)

        delta_white = round(k_white * (score_white - expected_white))
        delta_black = round(k_black * (score_black - expected_black))

        # Защита от падения рейтинга ниже 100
        new_white = max(100, white_rating + delta_white)
        new_black = max(100, black_rating + delta_black)

        return new_white, delta_white, new_black, delta_black


elo_calculator = FideEloSystem()
