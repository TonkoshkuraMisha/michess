# --- FILE: migrations/versions/e1a7c3d9b5f2_neutral_bot_identities.py ---

"""neutral_bot_identities

Таск 11.0c: сервер не хранит и не отдаёт русские тексты — имена на языке игрока ставит клиент.

* Боты-пользователи получают нейтральные имена: исторический бот — свой id («morphy»), общий соперник из
  мастерской — «workshop_opponent» (служебные «… [бот]» — «<id>_bot»).
* Партии с архетипами мастерской хранят в personality_name ключ «archetype:<id>» вместо русского имени.
* В заголовках PGN русские имена ботов заменяются именами для PGN (латиница, как в архивах мастеров), имена
  архетипов — английскими.

Обратная миграция возвращает прежние имена. Персоналия игрока, названная в точности как архетип, при переходе
станет архетипом (неразличимы по данным); на ход партий и рейтинги это не влияет.

Revision ID: e1a7c3d9b5f2
Revises: c8e1f4a7b2d5
Create Date: 2026-11-13 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e1a7c3d9b5f2"
down_revision: str | Sequence[str] | None = "c8e1f4a7b2d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# id бота → (прежнее имя пользователя, имя для PGN)
BOTS = {
    "philidor": ("Ф.-А. Филидор", "Philidor, François-André"),
    "labourdonnais": ("Л.-Ш. Лабурдонне", "La Bourdonnais, Louis-Charles"),
    "staunton": ("Г. Стаунтон", "Staunton, Howard"),
    "anderssen": ("А. Андерсен", "Anderssen, Adolf"),
    "morphy": ("Пол Морфи", "Morphy, Paul"),
    "paulsen": ("Л. Паульсен", "Paulsen, Louis"),
    "zukertort": ("И. Цукерторт", "Zukertort, Johannes"),
}
WORKSHOP = ("Соперник-из-мастерской", "workshop_opponent")

# id архетипа → (прежнее русское имя, имя для PGN)
ARCHETYPES = {
    "rusher": ("Торопыга", "Rusher"),
    "quiet": ("Тихоня", "Quiet One"),
    "pawn_keeper": ("Пешечник", "Pawn Keeper"),
    "cavalier": ("Кавалерист", "Cavalier"),
    "centralist": ("Центровик", "Centralist"),
    "fortress": ("Крепость", "Fortress"),
    "adventurer": ("Авантюрист", "Adventurer"),
    "strategist": ("Стратег", "Strategist"),
    "hunter": ("Охотник", "Hunter"),
    "combinator": ("Комбинатор", "Combinator"),
}


def _rename_user(old: str, new: str) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE users SET username = :new, username_key = :new_key "
            "WHERE username = :old AND is_bot "
            "AND NOT EXISTS (SELECT 1 FROM users other WHERE other.username = :new)"
        ),
        {"old": old, "new": new, "new_key": new.casefold()},
    )


def _replace_pgn_names(
        old: str, new: str, *, bot_username: str | None = None, personality_name: str | None = None,
) -> None:
    """
    Имя в заголовках White/Black — только в партиях этого бота (или этой персоналии): партии мастеров в
    историческом архиве с тем же именем в заголовке (например, «Morphy, Paul») не трогаются.
    """
    condition = "pgn LIKE :pattern"
    params: dict[str, str] = {"pattern": f'%"{old}"]%'}
    if bot_username is not None:
        condition += (
            " AND EXISTS (SELECT 1 FROM users bot WHERE bot.username = :bot AND bot.is_bot"
            " AND bot.id IN (games.white_player_id, games.black_player_id))"
        )
        params["bot"] = bot_username
    if personality_name is not None:
        condition += " AND personality_name = :personality"
        params["personality"] = personality_name
    for tag in ("White", "Black"):
        op.get_bind().execute(
            sa.text(f"UPDATE games SET pgn = replace(pgn, :old_tag, :new_tag) WHERE {condition}"),
            {**params, "old_tag": f'[{tag} "{old}"]', "new_tag": f'[{tag} "{new}"]'},
        )


def upgrade() -> None:
    for bot_id, (old_name, pgn_name) in BOTS.items():
        _rename_user(old_name, bot_id)
        _rename_user(f"{old_name} [бот]", f"{bot_id}_bot")
        for username in (bot_id, f"{bot_id}_bot"):
            _replace_pgn_names(old_name, pgn_name, bot_username=username)
    _rename_user(*WORKSHOP)

    bind = op.get_bind()
    for archetype_id, (old_name, pgn_name) in ARCHETYPES.items():
        key = f"archetype:{archetype_id}"
        bind.execute(
            sa.text("UPDATE games SET personality_name = :key WHERE personality_name = :old"),
            {"key": key, "old": old_name},
        )
        _replace_pgn_names(old_name, pgn_name, personality_name=key)


def downgrade() -> None:
    bind = op.get_bind()
    for archetype_id, (old_name, pgn_name) in ARCHETYPES.items():
        key = f"archetype:{archetype_id}"
        _replace_pgn_names(pgn_name, old_name, personality_name=key)
        bind.execute(
            sa.text("UPDATE games SET personality_name = :old WHERE personality_name = :key"),
            {"key": key, "old": old_name},
        )

    _rename_user(WORKSHOP[1], WORKSHOP[0])
    for bot_id, (old_name, pgn_name) in BOTS.items():
        for username in (bot_id, f"{bot_id}_bot"):
            _replace_pgn_names(pgn_name, old_name, bot_username=username)
        _rename_user(f"{bot_id}_bot", f"{old_name} [бот]")
        _rename_user(bot_id, old_name)
