# --- FILE: src/db/seed.py ---

import asyncio
import io
import logging
import os
import re
import sys
import zipfile
from pathlib import Path

import requests
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.user import User

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PRIMARY_PGNS_DIR = PROJECT_ROOT / "src" / "db" / "data" / "pgns"
PGNS_DIRS = [
    PRIMARY_PGNS_DIR,
    PROJECT_ROOT / "data" / "pgns",
]

PGN_MENTOR_BASE_URL = "https://www.pgnmentor.com/players"

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
DATE_TAG_RE = re.compile(r'\[(?:Event)?Date\s+"([^"]+)"\]')
SITE_TAG_RE = re.compile(r'\[Site\s+"([^"]+)"\]')
ECO_TAG_RE = re.compile(r'\[ECO\s+"([^"]+)"\]')

_SEED_LOCKS: dict[str, asyncio.Lock] = {}


def extract_pgn_metadata(raw_pgn: str, fallback_result: str = "*") -> dict[str, str | None]:
    result_str = fallback_result or "*"
    pgn_date: str | None = None
    site: str | None = None
    eco: str | None = None

    if not raw_pgn:
        return {"result": result_str, "pgn_date": None, "site": None, "eco": None}

    res_match = RESULT_TAG_RE.search(raw_pgn)
    if res_match:
        result_str = res_match.group(1).strip()[:10]
    elif result_str == "*":
        tail_match = re.search(r"(1-0|0-1|1/2-1/2)\s*$", raw_pgn.strip())
        if tail_match:
            result_str = tail_match.group(1)

    for d_match in DATE_TAG_RE.finditer(raw_pgn):
        val = d_match.group(1).strip()
        if val and not val.startswith("?"):
            pgn_date = val[:20]
            break

    s_match = SITE_TAG_RE.search(raw_pgn)
    if s_match and s_match.group(1).strip() != "?":
        site = s_match.group(1).strip()[:100]

    e_match = ECO_TAG_RE.search(raw_pgn)
    if e_match and e_match.group(1).strip() != "?":
        eco = e_match.group(1).strip()[:10]

    return {
        "result": result_str,
        "pgn_date": pgn_date,
        "site": site,
        "eco": eco,
    }


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
    alt_lower = f"{champ_id.lower()}_all_games.pgn"

    for folder in PGNS_DIRS:
        if not folder.exists():
            continue
        for pgn_path in folder.glob("*.pgn"):
            name_low = pgn_path.name.lower()
            if name_low in (target_lower, alt_lower) and pgn_path.stat().st_size > 100:
                return pgn_path
    return None


def _download_champion_pgn_sync(champ_id: str) -> Path | None:
    if "pytest" in sys.modules or os.environ.get("PYTEST_CURRENT_TEST"):
        return None

    PRIMARY_PGNS_DIR.mkdir(parents=True, exist_ok=True)
    target_path = PRIMARY_PGNS_DIR / f"{champ_id}.pgn"
    if target_path.exists() and target_path.stat().st_size > 100:
        return target_path

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://www.pgnmentor.com/files.html",
    }

    zip_url = f"{PGN_MENTOR_BASE_URL}/{champ_id}.zip"
    pgn_url = f"{PGN_MENTOR_BASE_URL}/{champ_id}.pgn"

    try:
        resp = requests.get(zip_url, headers=headers, timeout=30)
        if resp.status_code == 200 and len(resp.content) > 200:
            with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
                pgn_members = [m for m in zf.namelist() if m.lower().endswith(".pgn")]
                if pgn_members:
                    raw_bytes = zf.read(pgn_members[0])
                    text = raw_bytes.decode("utf-8", errors="ignore")
                    if "[Event " in text:
                        target_path.write_text(text, encoding="utf-8")
                        return target_path
    except Exception as exc:
        logger.warning("Не удалось скачать ZIP для %s (%s), пробуем прямой .pgn...", champ_id, exc)

    try:
        resp = requests.get(pgn_url, headers=headers, timeout=30)
        if resp.status_code == 200 and "[Event " in resp.text:
            target_path.write_text(resp.text, encoding="utf-8")
            return target_path
    except Exception as exc:
        logger.error("Ошибка загрузки PGN для %s: %s", champ_id, exc)

    return None


def _is_target_champion_name(raw_name: str, champ_key: str, meta: dict) -> bool:
    low = raw_name.lower()
    if any(ex in low for ex in meta.get("exclude", ())):
        return False
    # Надёжное сопоставление по фамилии (даже при сокращении инициалов в PGN Mentor)
    surname = meta["canonical"].split(",")[0].strip().lower()
    return surname in low or champ_key in low


def _split_pgn_games(content: str) -> list[str]:
    cleaned = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        return []
    chunks = re.split(r'(?m)^(?=\[Event\s+")', cleaned)
    return [c.strip() for c in chunks if c.strip() and "[White " in c]


async def ensure_champion_seeded(db: AsyncSession, username_or_id: str) -> User | None:
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
            pgn_file = await asyncio.to_thread(_download_champion_pgn_sync, meta["id"])

        if not pgn_file or not pgn_file.exists():
            await db.commit()
            return champ_user

        content = pgn_file.read_text(encoding="utf-8", errors="ignore")
        raw_games = _split_pgn_games(content)
        if not raw_games:
            await db.commit()
            return champ_user

        new_opponents: dict[str, User] = {}
        parsed_entries: list[tuple[str, str, dict, str]] = []

        for raw_pgn in raw_games:
            w_match = WHITE_TAG_RE.search(raw_pgn)
            b_match = BLACK_TAG_RE.search(raw_pgn)
            if not w_match or not b_match:
                continue

            w_raw = w_match.group(1).strip()[:50]
            b_raw = b_match.group(1).strip()[:50]
            meta_fields = extract_pgn_metadata(raw_pgn)

            w_name = canonical_name if _is_target_champion_name(w_raw, champ_key, meta) else w_raw
            b_name = canonical_name if _is_target_champion_name(b_raw, champ_key, meta) else b_raw

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

            parsed_entries.append((w_name, b_name, meta_fields, raw_pgn))

        if new_opponents:
            db.add_all(new_opponents.values())
            await db.flush()
            users_by_name.update(new_opponents)

        existing_pgns_res = await db.execute(
            select(Game.pgn).where(
                or_(Game.white_player_id == champ_user.id, Game.black_player_id == champ_user.id)
            )
        )
        existing_pgns = {row[0] for row in existing_pgns_res.all() if row[0]}

        games_to_insert: list[Game] = []
        for w_name, b_name, meta_fields, raw_pgn in parsed_entries:
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
                    result=meta_fields["result"],
                    pgn_date=meta_fields["pgn_date"],
                    site=meta_fields["site"],
                    eco=meta_fields["eco"],
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
    print(f"=== Полный импорт архивов 21 чемпиона мира (Корень: {PROJECT_ROOT}) ===")
    async with AsyncSessionLocal() as db:
        for _, meta in CHAMPIONS_META.items():
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
