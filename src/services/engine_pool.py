# --- FILE: src/services/engine_pool.py ---
"""
Пул долгоживущих процессов Stockfish.

Раньше каждый запрос к боту или анализу запускал новый процесс движка (popen_uci) — это
сотни миллисекунд на старт и неограниченное число параллельных процессов под нагрузкой.
Пул держит не более ENGINE_POOL_SIZE процессов на один бинарник, переиспользует их между
запросами и ограничивает число одновременных расчётов: при исчерпании пула ожидающий
вызов получает EngineBusyError по таймауту, а не порождает новый процесс.

Пул синхронный и потокобезопасный: им пользуются из asyncio.to_thread (API) и из Celery.
"""

import atexit
import logging
import os
import queue
import threading
from contextlib import contextmanager
from typing import Iterator

import chess.engine

from src.core.config import settings

logger = logging.getLogger(__name__)

# Опции, которые боты меняют под свой стиль. Перед каждой выдачей движка они сбрасываются
# к значениям полной силы, чтобы настройки одного вызова не «протекали» в следующий.
_DEFAULT_OPTIONS: dict[str, int | bool] = {
    "Skill Level": 20,
    "UCI_LimitStrength": False,
}


class EngineUnavailableError(RuntimeError):
    """Бинарник Stockfish отсутствует или не запускается."""


class EngineBusyError(RuntimeError):
    """Все движки пула заняты дольше допустимого времени ожидания."""


class EnginePool:
    def __init__(self, engine_path: str, size: int, acquire_timeout_s: float):
        self.engine_path = engine_path
        self.size = max(1, int(size))
        self.acquire_timeout_s = acquire_timeout_s
        self._slots = threading.BoundedSemaphore(self.size)
        self._idle: queue.LifoQueue[chess.engine.SimpleEngine] = queue.LifoQueue()
        self._closed = False

    def _spawn(self) -> chess.engine.SimpleEngine:
        if not os.path.exists(self.engine_path):
            raise EngineUnavailableError(f"Stockfish not found: {self.engine_path}")
        try:
            return chess.engine.SimpleEngine.popen_uci(self.engine_path)
        except Exception as exc:
            raise EngineUnavailableError(f"Cannot start Stockfish ({self.engine_path}): {exc}") from exc

    @staticmethod
    def _quit(engine: chess.engine.SimpleEngine) -> None:
        try:
            engine.quit()
        except Exception:
            try:
                engine.close()
            except Exception:
                pass

    @staticmethod
    def _is_alive(engine: chess.engine.SimpleEngine) -> bool:
        """Процесс движка ещё работает (вызывающий код мог проглотить EngineTerminatedError)."""
        try:
            return not engine.protocol.returncode.done()
        except Exception:
            return False

    @staticmethod
    def _configure(engine: chess.engine.SimpleEngine, options: dict) -> None:
        merged = {**_DEFAULT_OPTIONS, **options}
        supported: dict = {}
        for name, value in merged.items():
            option = engine.options.get(name)
            if option is None:
                continue
            # Числовые (spin) опции приводим к диапазону конкретной сборки движка.
            if option.type == "spin" and isinstance(value, (int, float)) and not isinstance(value, bool):
                if option.min is not None:
                    value = max(option.min, value)
                if option.max is not None:
                    value = min(option.max, value)
                value = int(value)
            supported[name] = value
        if supported:
            engine.configure(supported)

    @contextmanager
    def acquire(self, options: dict | None = None, timeout_s: float | None = None) -> Iterator[chess.engine.SimpleEngine]:
        """
        Выдаёт движок в монопольное пользование на время блока with.

        options — UCI-опции поверх значений по умолчанию (полная сила).
        Движок, упавший с ошибкой протокола или по таймауту, не возвращается в пул, а
        завершается; вместо него при следующем запросе будет запущен новый процесс.
        """
        if self._closed:
            raise EngineUnavailableError("Engine pool is closed")

        wait = self.acquire_timeout_s if timeout_s is None else timeout_s
        if not self._slots.acquire(timeout=wait):
            raise EngineBusyError("All chess engines are busy")

        engine: chess.engine.SimpleEngine | None = None
        healthy = True
        try:
            try:
                engine = self._idle.get_nowait()
            except queue.Empty:
                engine = self._spawn()

            self._configure(engine, options or {})
            yield engine
        except (chess.engine.EngineError, TimeoutError):
            healthy = False
            raise
        finally:
            if engine is not None:
                if healthy and not self._closed and self._is_alive(engine):
                    self._idle.put(engine)
                else:
                    self._quit(engine)
            self._slots.release()

    def close(self) -> None:
        self._closed = True
        while True:
            try:
                engine = self._idle.get_nowait()
            except queue.Empty:
                break
            self._quit(engine)


_pools: dict[str, EnginePool] = {}
_pools_lock = threading.Lock()


def get_engine_pool(engine_path: str | None) -> EnginePool:
    """Возвращает пул для указанного бинарника (по одному пулу на путь, создаётся лениво)."""
    if not engine_path:
        raise EngineUnavailableError("Stockfish path is not configured")
    key = os.path.abspath(engine_path)
    with _pools_lock:
        pool = _pools.get(key)
        if pool is None or pool._closed:
            pool = EnginePool(key, settings.ENGINE_POOL_SIZE, settings.ENGINE_ACQUIRE_TIMEOUT_S)
            _pools[key] = pool
        return pool


def close_all_engine_pools() -> None:
    with _pools_lock:
        pools = list(_pools.values())
        _pools.clear()
    for pool in pools:
        pool.close()


# python-chess держит для каждого SimpleEngine фоновый НЕ-daemon поток. Интерпретатор ждёт
# такие потоки до вызова обычных atexit-обработчиков, поэтому процесс (Celery-воркер, pytest)
# с открытым пулом зависал бы на выходе. threading._register_atexit срабатывает раньше этого
# ожидания (так же завершается concurrent.futures); atexit — запасной вариант.
_register_early_exit_hook = getattr(threading, "_register_atexit", None)
if _register_early_exit_hook is not None:
    _register_early_exit_hook(close_all_engine_pools)
else:
    atexit.register(close_all_engine_pools)
