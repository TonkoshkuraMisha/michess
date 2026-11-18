# --- FILE: src/services/engine_pool.py ---
"""
Пул долгоживущих процессов Stockfish.

Раньше каждый запрос к боту или анализу запускал новый процесс движка (popen_uci) — это
сотни миллисекунд на старт и неограниченное число параллельных процессов под нагрузкой.
Пул держит не более ENGINE_POOL_SIZE процессов на один бинарник, переиспользует их между
запросами и ограничивает число одновременных расчётов: при исчерпании пула ожидающий
вызов получает EngineBusyError по таймауту, а не порождает новый процесс.

Пул синхронный и потокобезопасный: им пользуются из asyncio.to_thread (API) и из Celery.

Настройки (src/core/config.py): ENGINE_POOL_SIZE — предел процессов, ENGINE_ACQUIRE_TIMEOUT_S — сколько секунд ждать
свободный движок. Пул живёт в памяти процесса: у каждого процесса API и у каждого воркера Celery свой пул, так что
предел действует на процесс, а не на весь сервер. Путь к бинарнику передаёт вызывающий
(bots/base.resolve_stockfish_path). Метрики Prometheus — время занятости движка, ожидание и отказы по видам работ.
"""

import atexit
import logging
import os
import queue
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar

import chess.engine
from prometheus_client import Counter, Histogram

from src.core.config import settings

logger = logging.getLogger(__name__)

# Опции, которые боты меняют под свой стиль. Перед каждой выдачей движка они сбрасываются
# к значениям полной силы, чтобы настройки одного вызова не «протекали» в следующий.
_DEFAULT_OPTIONS: dict[str, int | bool] = {
    "Skill Level": 20,
    "UCI_LimitStrength": False,
}


# --- Бюджет движка (таск 23.3): время, пока движок занят, по видам работ ----------------------------------------
# Главная статья расходов — процессор Stockfish. Каждая выдача движка из пула засчитывает время, пока он был занят,
# виду работы из контекста вызова (engine_work). Метки — из конечного набора ENGINE_WORK_KINDS.

ENGINE_WORK_KINDS = ("bot_move", "analysis", "coach", "simulation", "puzzles", "other")
_work_kind: ContextVar[str] = ContextVar("engine_work_kind", default="other")

ENGINE_SECONDS = Counter(
    "michess_engine_seconds_total", "Time Stockfish engines were held from the pool, by kind of work", ["kind"],
)
ENGINE_ACQUIRE_WAIT_SECONDS = Histogram(
    "michess_engine_acquire_wait_seconds", "Waiting for a free engine in the pool", ["kind"],
    buckets=(0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)
ENGINE_BUSY = Counter("michess_engine_busy_total", "Requests refused because every engine was busy", ["kind"])


@contextmanager
def engine_work(kind: str) -> Iterator[None]:
    """
    Вид работы для учёта времени движка внутри блока. Внешний вид важнее внутреннего: ход бота в симуляции турнира
    засчитывается симуляции. Контекст переживает asyncio.to_thread (contextvars копируются в поток).
    """
    if kind not in ENGINE_WORK_KINDS:
        kind = "other"
    if _work_kind.get() != "other":
        yield
        return
    token = _work_kind.set(kind)
    try:
        yield
    finally:
        _work_kind.reset(token)


def current_engine_work() -> str:
    """Вид работы текущего контекста вызова; вне блока engine_work — "other"."""
    return _work_kind.get()


class EngineUnavailableError(RuntimeError):
    """Бинарник Stockfish отсутствует или не запускается."""


class EngineBusyError(RuntimeError):
    """Все движки пула заняты дольше допустимого времени ожидания."""


class EnginePool:
    """
    Пул процессов Stockfish одного бинарника: не больше size процессов, свободные переиспользуются. acquire выдаёт
    движок на время расчёта; если свободного нет дольше acquire_timeout_s — EngineBusyError.
    """
    def __init__(self, engine_path: str, size: int, acquire_timeout_s: float):
        self.engine_path = engine_path
        self.size = max(1, int(size))
        self.acquire_timeout_s = acquire_timeout_s
        # Семафор ограничивает число одновременно выданных движков; в очереди лежат свободные запущенные процессы
        # (последний освободившийся выдаётся первым). Процесс запускается только при выдаче, когда свободных нет.
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
        """
        Настраивает движок перед выдачей: значения полной силы (_DEFAULT_OPTIONS), поверх них — options вызывающего.
        Опции, которых у этой сборки движка нет, пропускаются; числовые приводятся к её допустимому диапазону
        (например, UCI_Elo ниже минимума сборки становится минимумом).
        """
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
        timeout_s — сколько ждать свободный движок (по умолчанию acquire_timeout_s пула); не дождались —
        EngineBusyError. Время ожидания и время, пока движок был выдан, пишутся в метрики по виду работы
        (current_engine_work).
        """
        if self._closed:
            raise EngineUnavailableError("Engine pool is closed")

        wait = self.acquire_timeout_s if timeout_s is None else timeout_s
        kind = current_engine_work()
        waiting_since = time.perf_counter()
        if not self._slots.acquire(timeout=wait):
            ENGINE_BUSY.labels(kind).inc()
            raise EngineBusyError("All chess engines are busy")
        held_since = time.perf_counter()
        ENGINE_ACQUIRE_WAIT_SECONDS.labels(kind).observe(held_since - waiting_since)

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
            ENGINE_SECONDS.labels(kind).inc(time.perf_counter() - held_since)

    def close(self) -> None:
        """
        Закрывает пул: завершает свободные движки и запрещает новые выдачи. Движок, выданный в этот момент,
        завершится при возврате.
        """
        self._closed = True
        while True:
            try:
                engine = self._idle.get_nowait()
            except queue.Empty:
                break
            self._quit(engine)


class EngineLease:
    """
    Один движок пула на несколько вызовов подряд — например, на ход бота: анализ MultiPV, опорный ход с
    ограничением силы и оценка этого хода. Без аренды каждый шаг заново вставал в очередь пула: под нагрузкой ход
    ждал движок 2–3 раза и мог получить EngineBusyError посередине.

    Движок берётся при первом use() (если до движка дело не дошло — пул не трогается) и держится до close().
    Опции UCI задаются на каждый use() заново поверх полной силы, как в acquire(). Ошибка протокола или таймаут
    внутри use() сразу возвращают движок пулу как сломанный; следующий use() возьмёт новый.
    """

    def __init__(self, engine_path: str | None):
        self.engine_path = engine_path
        self._stack: ExitStack | None = None
        self._engine: chess.engine.SimpleEngine | None = None

    @contextmanager
    def use(self, options: dict | None = None) -> Iterator[chess.engine.SimpleEngine]:
        """
        Движок аренды: при первом обращении берётся из пула и остаётся за арендой до её конца, при следующих только
        перенастраивается. Ошибка движка возвращает его в пул.
        """
        fresh = self._engine is None
        if self._engine is None:
            stack = ExitStack()
            self._engine = stack.enter_context(get_engine_pool(self.engine_path).acquire(options))
            self._stack = stack
        try:
            if not fresh:
                EnginePool._configure(self._engine, options or {})
            yield self._engine
        except (chess.engine.EngineError, TimeoutError):
            self._release(*sys.exc_info())
            raise

    def _release(self, *exc_info) -> None:
        """Возвращает движок аренды пулу; exc_info — ошибка, с которой он возвращается (тогда пул его завершит)."""
        stack, self._stack, self._engine = self._stack, None, None
        if stack is not None:
            stack.__exit__(*exc_info)

    def close(self) -> None:
        self._release(None, None, None)

    def __enter__(self) -> EngineLease:
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()


_pools: dict[str, EnginePool] = {}
_pools_lock = threading.Lock()


def get_engine_pool(engine_path: str | None) -> EnginePool:
    """
    Возвращает пул для указанного бинарника (по одному пулу на путь, создаётся лениво). Размер и время ожидания —
    из настроек ENGINE_POOL_SIZE и ENGINE_ACQUIRE_TIMEOUT_S на момент создания. Пустой путь — EngineUnavailableError.
    """
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
    """Закрывает все пулы процесса и забывает их; следующий get_engine_pool создаст новый. Вызывается при выходе."""
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
