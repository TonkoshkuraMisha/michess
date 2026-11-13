# --- FILE: tests/test_celery_queues.py ---
"""Очереди Celery (таск A.4): разбор партий и симуляция турниров не мешают друг другу."""

from pathlib import Path

from src.worker.celery_app import ANALYSIS_QUEUE, SIMULATION_QUEUE, celery_app
from src.worker.tasks import analyze_game_task, simulate_tournament_game_task

ROOT = Path(__file__).resolve().parent.parent


def route(task) -> str:
    return celery_app.amqp.router.route({}, task.name)["queue"].name


def test_analysis_and_simulation_go_to_separate_queues():
    assert route(analyze_game_task) == ANALYSIS_QUEUE
    assert route(simulate_tournament_game_task) == SIMULATION_QUEUE
    assert celery_app.conf.task_default_queue == ANALYSIS_QUEUE


def test_every_queue_has_a_worker_in_production_and_development():
    compose = (ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")
    assert '"-Q", "analysis"' in compose and '"-Q", "simulation"' in compose
    dev = (ROOT / "start_dev.ps1").read_text(encoding="utf-8")
    assert "-Q analysis,simulation" in dev
