# --- FILE: tests/test_course_progress.py ---
"""
Автозачёт шагов курса (задача 6 плана 18.11, src/services/course_progress.py): GET /learn/course-progress через
настоящие запросы — пройденные уроки, темы по нормативу ступени, тренажёры с попыткой, последние оценки экзаменов;
чужие данные не попадают; без входа — 401. Плюс чистый норматив темы.
"""

from src.models.puzzle import ThemeProgress
from src.models.trainer import ExamResult
from src.services.course_progress import THEME_PASS_STAGE, theme_passed

API = "/api/v1/learn"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_course_progress_collects_what_the_player_did(client, db_session, test_user_1, test_user_2,
                                                            token_user_1):
    headers = auth(token_user_1)
    client.put(f"{API}/progress/tactics-pin", headers=headers, json={"step": 4, "steps_total": 5, "completed": True})
    client.put(f"{API}/progress/endgame-kq-center", headers=headers, json={"step": 0, "steps_total": 1, "completed": True})
    client.put(f"{API}/progress/basics-capture", headers=headers, json={"step": 1, "steps_total": 6})  # не до конца
    db_session.add_all([
        ThemeProgress(user_id=test_user_1.id, theme="fork", stage=THEME_PASS_STAGE, recent="", solved=8),
        ThemeProgress(user_id=test_user_1.id, theme="pin", stage=1, recent="11111111", solved=8),
        ThemeProgress(user_id=test_user_1.id, theme="skewer", stage=4, recent="", solved=40, mastered=True),
        ThemeProgress(user_id=test_user_2.id, theme="discovered_attack", stage=3, recent="", solved=20),
        ExamResult(user_id=test_user_1.id, section="level1", correct=8, total=10, estimate=1050),
    ])
    await db_session.commit()
    saved = client.post("/api/v1/trainers/results", headers=headers,
                        json={"trainer": "coord_find", "level": 1, "score": 12, "time_ms": 30000, "mistakes": 0})
    assert saved.status_code == 200, saved.text

    body = client.get(f"{API}/course-progress", headers=headers).json()
    assert body == {
        "lessons": ["endgame-kq-center", "tactics-pin"],
        "themes": ["fork", "skewer"],
        "trainers": ["coord_find"],
        "exams": {"level1": 1050},
    }


def test_course_progress_needs_login(client):
    assert client.get(f"{API}/course-progress").status_code == 401


def test_theme_norm():
    assert theme_passed(THEME_PASS_STAGE, False)
    assert not theme_passed(THEME_PASS_STAGE - 1, False)
    assert theme_passed(1, True)
