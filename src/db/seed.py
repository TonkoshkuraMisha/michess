import asyncio
import os
import random
from pathlib import Path
import chess.pgn
from dotenv import load_dotenv

# Загружаем переменные из .env ДО импорта наших модулей
load_dotenv()

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import sys

# Чтобы скрипт мог импортировать модули src, находясь внутри папки
sys.path.append(str(Path(__file__).parent.parent.parent))

from src.db.session import AsyncSessionLocal
from src.models.user import User
from src.models.game import Game, GameStatus
from src.models.move import Move
from src.core.security import get_password_hash

# Путь жестко задан под расположение файлов
PGN_DIR = Path(__file__).parent / "data" / "pgns"
BATCH_SIZE = 100  # Размер пачки для коммита в БД


async def get_or_create_user(db: AsyncSession, username: str, rating: str, user_cache: dict) -> int:
    """Ищет пользователя в кэше/базе, если нет — создает и возвращает ID."""
    safe_username = "".join(c for c in username if c.isalnum() or c in "_-")[:50]
    if not safe_username:
        safe_username = f"player_{random.randint(1000, 9999)}"

    # 1. Ищем в кэше (самый быстрый путь)
    if safe_username in user_cache:
        return user_cache[safe_username]

    r = 1200
    if rating and rating.isdigit():
        r = int(rating)

    # 2. Ищем в БД
    result = await db.execute(select(User).where(User.username == safe_username))
    user = result.scalars().first()

    # 3. Создаем, если нигде нет
    if not user:
        user = User(
            username=safe_username,
            hashed_password=get_password_hash("password123"),
            rating=r,
            trust_factor=100
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    # Сохраняем в кэш
    user_cache[safe_username] = user.id
    return user.id


async def seed_from_pgns():
    if not PGN_DIR.exists():
        print(f"📁 Папка {PGN_DIR} не найдена.")
        return

    pgn_files = list(PGN_DIR.glob("*.pgn"))
    if not pgn_files:
        print(f"⚠️ В папке {PGN_DIR} нет .pgn файлов.")
        return

    # In-memory кэш ID пользователей
    user_cache = {}

    async with AsyncSessionLocal() as db:
        print("🚀 Начинаем массовый парсинг и заливку PGN...")

        for pgn_file in pgn_files:
            print(f"\n📂 Обработка файла: {pgn_file.name}")
            with open(pgn_file, "r", encoding="utf-8", errors="replace") as f:
                games_processed = 0

                while True:
                    game = chess.pgn.read_game(f)
                    if game is None:
                        break  # Конец файла

                    white_name = game.headers.get("White", "UnknownWhite")
                    black_name = game.headers.get("Black", "UnknownBlack")
                    white_rating = game.headers.get("WhiteElo", "1200")
                    black_rating = game.headers.get("BlackElo", "1200")

                    white_id = await get_or_create_user(db, white_name, white_rating, user_cache)
                    black_id = await get_or_create_user(db, black_name, black_rating, user_cache)

                    exporter = chess.pgn.StringExporter(headers=False, variations=False, comments=False)
                    pgn_string = game.accept(exporter)

                    db_game = Game(
                        white_player_id=white_id,
                        black_player_id=black_id,
                        pgn=pgn_string,
                        status=GameStatus.COMPLETED,
                        is_rated=True
                    )

                    db.add(db_game)
                    # Flush позволяет получить ID партии до фактического коммита транзакции
                    await db.flush()

                    moves_to_insert = []
                    board = game.board()

                    for i, move in enumerate(game.mainline_moves()):
                        board.push(move)
                        moves_to_insert.append(Move(
                            game_id=db_game.id,
                            player_id=white_id if i % 2 == 0 else black_id,
                            move_number=board.fullmove_number,
                            notation=move.uci(),
                            time_taken_ms=random.randint(500, 12000),
                            window_blurred_before_move=random.choices([True, False], weights=[0.05, 0.95])[0],
                            is_premove=random.choices([True, False], weights=[0.1, 0.9])[0],
                            network_lag_ms=random.randint(10, 150)
                        ))

                    db.add_all(moves_to_insert)
                    games_processed += 1

                    # Коммитим пачками
                    if games_processed % BATCH_SIZE == 0:
                        await db.commit()
                        print(f"⏳ Сохранено {games_processed} партий из {pgn_file.name}...")

                # Сохраняем "хвост" данных, если они не кратны BATCH_SIZE
                if games_processed % BATCH_SIZE != 0:
                    await db.commit()

                print(f"✅ Файл {pgn_file.name} полностью залит. Итого: {games_processed} партий.")

        print("\n🎉 Массовая заливка тестовых данных успешно завершена!")


if __name__ == "__main__":
    asyncio.run(seed_from_pgns())