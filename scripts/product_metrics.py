# --- FILE: scripts/product_metrics.py ---
"""
Отчёт владельца по продуктовым метрикам (таск 23.5): регистрации, активация и удержание — из своей базы,
без сторонних трекеров.

    python scripts/product_metrics.py            # когорты за последние 30 дней
    python scripts/product_metrics.py --days 90

Активация — доля новых игроков, сыгравших первую партию за 5 минут и в первые сутки после регистрации (ориентир
беты — больше 60 % за 5 минут). Удержание D1/D7/D30 — доля когорты, активная ровно через 1, 7 и 30 дней (ориентир
35 % / 15 % / 7 %); у свежих когорт, для которых день ещё не наступил, вместо доли — «…».
"""

import argparse
import asyncio
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.services.product_metrics import RETENTION_DAYS, Report, build_report, utc_today  # noqa: E402


def _share(part: int, whole: int) -> str:
    return f"{100 * part / whole:5.1f}%" if whole else "    —"


def render(report: Report) -> str:
    today = utc_today()
    header = f"{'когорта':<12}{'рег.':>6}{'≤5 мин':>9}{'≤сутки':>9}" + "".join(f"{'D' + str(n):>8}" for n in RETENTION_DAYS)
    lines = [header, "-" * len(header)]
    totals = {"registered": 0, "fast": 0, "day": 0}
    retained_totals = {n: [0, 0] for n in RETENTION_DAYS}  # [вернулись, могли вернуться]
    for cohort in report.cohorts:
        if cohort.registered == 0:
            continue
        totals["registered"] += cohort.registered
        totals["fast"] += cohort.activated_fast
        totals["day"] += cohort.activated_day
        cells = []
        for n in RETENTION_DAYS:
            if cohort.day + timedelta(days=n) > today:
                cells.append(f"{'…':>8}")
                continue
            retained_totals[n][0] += cohort.retained[n]
            retained_totals[n][1] += cohort.registered
            cells.append(f"{_share(cohort.retained[n], cohort.registered):>8}")
        lines.append(
            f"{cohort.day.isoformat():<12}{cohort.registered:>6}"
            f"{_share(cohort.activated_fast, cohort.registered):>9}{_share(cohort.activated_day, cohort.registered):>9}"
            + "".join(cells)
        )
    lines.append("-" * len(header))
    lines.append(
        f"{'итого':<12}{totals['registered']:>6}{_share(totals['fast'], totals['registered']):>9}"
        f"{_share(totals['day'], totals['registered']):>9}"
        + "".join(f"{_share(*retained_totals[n]):>8}" for n in RETENTION_DAYS)
    )
    lines.append("")
    lines.append(f"Игроков с событиями за всё время: {report.total_users}. Дошли до раздела:")
    names = {"game_finished": "партия", "puzzle_attempt": "задача", "lesson_completed": "урок",
             "tournament_created": "турнир"}
    for kind, count in report.reached.items():
        lines.append(f"  {names.get(kind, kind):<8} {count:>6}  {_share(count, report.total_users)}")
    return "\n".join(lines)


async def main(days: int) -> None:
    from src.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        report = await build_report(db, since=utc_today() - timedelta(days=days - 1))
    print(render(report))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=30, help="Сколько последних дней когорт показать")
    asyncio.run(main(parser.parse_args().days))
