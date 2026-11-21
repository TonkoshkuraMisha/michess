# --- FILE: src/services/legal.py ---
"""
Согласие с условиями при регистрации (таск 23.1): какая версия документов («Правила сообщества» и «Конфиденциальность»,
страницы клиента /rules и /privacy) действует сейчас и как фиксируется согласие игрока.

TERMS_VERSION — дата редакции документов. Меняется при каждой правке их смысла; игроки с более старой отметкой
(users.terms_version) видны в базе, чтобы при необходимости запросить повторное согласие. Согласие хранится в
users.terms_version и users.terms_accepted_at; архивные игроки из PGN и боты его не имеют (NULL). Включает проверку
настройка REQUIRE_TERMS_CONSENT (src/core/config.py): тесты и закрытые стенды могут её выключить.
"""

from datetime import UTC, datetime

from src.core.errors import ApiError
from src.models.user import User

# Редакция документов, с которой соглашается новый игрок (дата в формате ГГГГ-ММ-ДД).
TERMS_VERSION = "2026-11-21"


def require_consent(accepted: bool, required: bool) -> None:
    """Отказ регистрации без согласия (400 terms_not_accepted), если проверка включена настройкой."""
    if required and not accepted:
        raise ApiError(400, "terms_not_accepted")


def record_consent(user: User, accepted: bool, now: datetime | None = None) -> None:
    """Записывает отметку согласия в нового игрока; без согласия (проверка выключена) поля остаются пустыми."""
    if not accepted:
        return
    user.terms_version = TERMS_VERSION
    user.terms_accepted_at = now or datetime.now(UTC)
