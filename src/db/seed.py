# --- FILE: src/db/seed.py ---

import asyncio
import logging
import re
from pathlib import Path
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.user import User

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PGNS_DIRS = [
    PROJECT_ROOT / "src" / "db" / "data" / "pgns",
    PROJECT_ROOT / "data" / "pgns",
]

# Каноническое соответствие ID чемпионов из frontend/src/config/champions.ts
CHAMPIONS_META: dict[str, dict] = {
    "steinitz": {"id": "Steinitz", "canonical": "Steinitz, Wilhelm", "rating": 2650, "exclude": ()},
    "lasker": {"id": "Lasker", "canonical": "Lasker, Emanuel", "rating": 2720,
               "exclude": ("edward", "berthold", "alfred")},
    "rubinstein": {"id": "Rubinstein", "canonical": "Rubinstein, Akiba", "rating": 2690, "exclude": ("simon",)},
    "capablanca": {"id": "Capablanca", "canonical": "Capablanca, Jose Raul", "rating": 2725, "exclude": ()},
    "alekhine": {"id": "Alekhine", "canonical": "Alekhine, Alexander", "rating": 2690, "exclude": ("alexei",)},
    "euwe": {"id": "Euwe", "canonical": "Euwe, Max", "rating": 2650, "exclude": ()},
    "keres": {"id": "Keres", "canonical": "Keres, Paul", "rating": 2670, "exclude": ()},
    "botvinnik": {"id": "Botvinnik", "canonical": "Botvinnik, Mikhail", "rating": 2720, "exclude": ()},
    "geller": {"id": "Geller", "canonical": "Geller, Efim", "rating": 2665, "exclude": ("jakov",)},
    "korchnoi": {"id": "Korchnoi", "canonical": "Korchnoi, Viktor", "rating": 2695, "exclude": ()},
    "smyslov": {"id": "Smyslov", "canonical": "Smyslov, Vasily", "rating": 2690, "exclude": ()},
    "tal": {"id": "Tal", "canonical": "Tal, Mikhail", "rating": 2705, "exclude": ()},
    "petrosian": {"id": "Petrosian", "canonical": "Petrosian, Tigran", "rating": 2690,
                  "exclude": ("tigran l", "arshak", "manuel")},
    "spassky": {"id": "Spassky", "canonical": "Spassky, Boris", "rating": 2690, "exclude": ()},
    "fischer": {"id": "Fischer", "canonical": "Fischer, Robert James", "rating": 2785, "exclude": ("julie",)},
    "karpov": {"id": "Karpov", "canonical": "Karpov, Anatoly", "rating": 2780, "exclude": ()},
    "kasparov": {"id": "Kasparov", "canonical": "Kasparov, Garry", "rating": 2851, "exclude": ("sergey",)},
    "kramnik": {"id": "Kramnik", "canonical": "Kramnik, Vladimir", "rating": 2817, "exclude": ()},
    "anand": {"id": "Anand", "canonical": "Anand, Viswanathan", "rating": 2817, "exclude": ()},
    "carlsen": {"id": "Carlsen", "canonical": "Carlsen, Magnus", "rating": 2882, "exclude": ("henrik",)},
    "ding": {"id": "Ding", "canonical": "Ding, Liren", "rating": 2816, "exclude": ("yilun",)},
}

WHITE_TAG_RE = re.compile(r'\[White\s+"([^"]+)"\]')
BLACK_TAG_RE = re.compile(r'\[Black\s+"([^"]+)"\]')
RESULT_TAG_RE = re.compile(r'\[Result\s+"([^"]+)"\]')

# Блокировка от параллельного засеивания одного и того же чемпиона при двойных запросах React StrictMode
_SEED_LOCKS: dict[str, asyncio.Lock] = {}


def get_champion_meta(username_or_id: str) -> dict | None:
    key = (username_or_id or "").strip().lower()
    if key in CHAMPIONS_META:
        return CHAMPIONS_META[key]
    for meta in CHAMPIONS_META.values():
        if meta["canonical"].lower() == key:
            return meta
    return None


def find_champion_pgn_file(champ_id: str) -> Path | None:
    target_lower = f"{champ_id.lower()}.pgn"
    for folder in PGNS_DIRS:
        if not folder.exists():
            continue
        for pgn_path in folder.glob("*.pgn"):
            if pgn_path.name.lower() == target_lower:
                return pgn_path
    return None


def _is_target_champion_name(raw_name: str, champ_key: str, meta: dict) -> bool:
    low = raw_name.lower()
    if any(ex in low for ex in meta.get("exclude", ())):
        return False
    return champ_key in low


def _split_pgn_games(content: str) -> list[str]:
    cleaned = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        return []
    chunks = re.split(r'(?m)^(?=\[Event\s+")', cleaned)
    return [c.strip() for c in chunks if c.strip() and "[White " in c]


async def ensure_champion_seeded(db: AsyncSession, username_or_id: str) -> User | None:
    """
    Проверяет, есть ли чемпион и его партии в БД.
    Если партий ещё нет, автоматически импортирует их из src/db/data/pgns/{Champion}.pgn.
    """
    meta = get_champion_meta(username_or_id)
    if not meta:
        return None

    champ_key = meta["id"].lower()
    lock = _SEED_LOCKS.setdefault(champ_key, asyncio.Lock())

    async with lock:
        canonical_name = meta["canonical"]
        res = await db.execute(
            select(User).where(
                or_(User.username == canonical_name, User.username == meta["id"])
            )
        )
        champ_user = res.scalars().first()

        if champ_user is not None:
            count_q = select(func.count(Game.id)).where(
                or_(Game.white_player_id == champ_user.id, Game.black_player_id == champ_user.id),
                Game.status == GameStatus.COMPLETED,
            )
            games_count = (await db.execute(count_q)).scalar() or 0
            if games_count > 0:
                return champ_user

        # Загружаем всех существующих пользователей в память для мгновенного маппинга соперников
        all_users_res = await db.execute(select(User))
        users_by_name: dict[str, User] = {u.username: u for u in all_users_res.scalars().all()}

        if champ_user is None:
            champ_user = User(
                username=canonical_name,
                hashed_password="!historical_archive_no_login!",
                rating=meta["rating"],
                is_cheater=False,
                trust_factor=100,
            )
            db.add(champ_user)
            await db.flush()
            users_by_name[canonical_name] = champ_user

        pgn_file = find_champion_pgn_file(meta["id"])
        if not pgn_file or not pgn_file.exists():
            await db.commit()
            return champ_user

        content = pgn_file.read_text(encoding="utf-8", errors="ignore")
        raw_games = _split_pgn_games(content)
        if not raw_games:
            await db.commit()
            return champ_user

        # Сначала создаём недостающих пользователей-соперников одним пакетом
        new_opponents: dict[str, User] = {}
        parsed_entries: list[tuple[str, str, str, str]] = []

        for raw_pgn in raw_games:
            w_match = WHITE_TAG_RE.search(raw_pgn)
            b_match = BLACK_TAG_RE.search(raw_pgn)
            if not w_match or not b_match:
                continue

            w_raw = w_match.group(1).strip()[:50]
            b_raw = b_match.group(1).strip()[:50]
            res_match = RESULT_TAG_RE.search(raw_pgn)
            result_str = res_match.group(1).strip()[:10] if res_match else "*"

            w_name = canonical_name if _is_target_champion_name(w_raw, champ_key, meta) else w_raw
            b_name = canonical_name if _is_target_champion_name(b_raw, champ_key, meta) else b_raw

            # Пропускаем партии однофамильцев, не относящиеся к чемпиону
            if w_name != canonical_name and b_name != canonical_name:
                continue

            for opp_name in (w_name, b_name):
                if opp_name not in users_by_name and opp_name not in new_opponents:
                    opp_meta = get_champion_meta(opp_name)
                    opp_rating = opp_meta["rating"] if opp_meta else 2450
                    new_opponents[opp_name] = User(
                        username=opp_name,
                        hashed_password="!historical_archive_no_login!",
                        rating=opp_rating,
                        is_cheater=False,
                        trust_factor=100,
                    )

            parsed_entries.append((w_name, b_name, result_str, raw_pgn))

        if new_opponents:
            db.add_all(new_opponents.values())
            await db.flush()
            users_by_name.update(new_opponents)

        # Проверяем уже существующие PGN у этого чемпиона, чтобы избежать дубликатов при пересечении матчей
        existing_pgns_res = await db.execute(
            select(Game.pgn).where(
                or_(Game.white_player_id == champ_user.id, Game.black_player_id == champ_user.id)
            )
        )
        existing_pgns = {row[0] for row in existing_pgns_res.all() if row[0]}

        games_to_insert: list[Game] = []
        for w_name, b_name, result_str, raw_pgn in parsed_entries:
            if raw_pgn in existing_pgns:
                continue
            existing_pgns.add(raw_pgn)

            w_user = users_by_name[w_name]
            b_user = users_by_name[b_name]
            games_to_insert.append(
                Game(
                    white_player_id=w_user.id,
                    black_player_id=b_user.id,
                    pgn=raw_pgn,
                    status=GameStatus.COMPLETED,
                    result=result_str,
                    is_rated=True,
                )
            )

        if games_to_insert:
            db.add_all(games_to_insert)

        await db.commit()
        logger.info(
            "Импортировано %d партий для чемпиона %s из %s",
            len(games_to_insert),
            canonical_name,
            pgn_file.name,
        )
        return champ_user


async def seed_all_champions() -> None:
    """Полный импорт всех архивов чемпионов мира в БД (для вызова через python -m src.db.seed)."""
    print(f"=== Импорт архивов чемпионов мира в БД (Корень: {PROJECT_ROOT}) ===")
    async with AsyncSessionLocal() as db:
        for champ_key, meta in CHAMPIONS_META.items():
            user = await ensure_champion_seeded(db, meta["id"])
            if user:
                count_q = select(func.count(Game.id)).where(
                    or_(Game.white_player_id == user.id, Game.black_player_id == user.id),
                    Game.status == GameStatus.COMPLETED,
                )
                total = (await db.execute(count_q)).scalar() or 0
                print(f"[+] {meta['id']:12s} ({meta['canonical']:24s}): в базе {total:4d} партий")
    print("=== Импорт всех чемпионов успешно завершён! ===")


if __name__ == "__main__":
    asyncio.run(seed_all_champions())
