# --- FILE: tests/test_project_status.py ---
"""Сводка состояния проекта (project_status.py): задачи ToDo.md и порядок работ разбираются правильно."""

from pathlib import Path

from project_status import build_status, next_tasks, parse_plan

PLAN = """
**Новый порядок (13.11.2026, стратегия запуска — Часть III):** сначала блокеры.

1. **10.5** — честная сила ботов.
1a. **A.1–A.3** — найденное самопроверкой.
2. **Спринт 23** — готовность к запуску, вместе с **17.5**.

## СПРИНТ 10. Мастерская
### - [x] Таск 10.4. Лестница (`feat/bot-ladder`)
### - [ ] Таск 10.5. Сила ботов (`fix/bot-strength`)
## Найдено при самопроверке
### - [ ] Таск A.1. Лавина задач (`fix/a`)
### - [x] Таск A.2. Переигровка (`fix/b`)
### - [ ] Таск A.3. Выход (`feat/c`)
## СПРИНТ 17. Клуб
### - [ ] Таск 17.5. Учётная запись (`feat/account`)
## СПРИНТ 23. Запуск
### - [ ] Таск 23.1. Юридическое (`chore/legal`)
### - [ ] Таск 23.2. Инфраструктура (`chore/prod-infra`)
"""


def test_plan_is_parsed_by_sections():
    plan = parse_plan(PLAN)
    assert [t.id for t in plan.tasks] == ["10.4", "10.5", "A.1", "A.2", "A.3", "17.5", "23.1", "23.2"]
    assert plan.tasks[0].done and plan.tasks[0].title == "Лестница"
    assert set(plan.sections) == {"СПРИНТ 10. Мастерская", "Найдено при самопроверке", "СПРИНТ 17. Клуб", "СПРИНТ 23. Запуск"}


def test_priority_expands_ranges_and_sprints_and_skips_done():
    plan = parse_plan(PLAN)
    assert plan.priority == ["10.5", "A.1", "A.2", "A.3", "17.5", "23.1", "23.2"]
    assert [t.id for t in next_tasks(plan)] == ["10.5", "A.1", "A.3", "17.5", "23.1", "23.2"]


def test_real_status_builds():
    status = build_status(Path(__file__).resolve().parent.parent)
    assert "# Состояние проекта" in status and "Голова миграций" in status and "Следующие по порядку работ" in status
