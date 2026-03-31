"""
Interrupt-aware graph lifecycle manager.

When MemorySaver is the checkpointer (no PostgreSQL configured), interrupted threads
that are abandoned by the user (browser closed after the "Execute SQL?" prompt) accumulate
in memory forever.  This module tracks when each thread entered the interrupted state and
runs a periodic background task to prune checkpoints that have been idle too long.

PostgreSQL-backed deployments don't need this: the checkpointer lives in the database,
not in process heap, so set_memory_saver() is simply never called and all helpers are no-ops.
"""
import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Set once by the lifespan when MemorySaver is chosen; None when Postgres is used.
_memory_saver = None

# thread_id → unix timestamp of when the interrupt was registered.
_interrupt_timestamps: dict[str, float] = {}

_cleanup_task: Optional[asyncio.Task] = None


# ---------------------------------------------------------------------------
# Public API (called from main.py lifespan and endpoint handlers)
# ---------------------------------------------------------------------------

def set_memory_saver(saver) -> None:
    """Register the MemorySaver instance so the cleanup task can prune it."""
    global _memory_saver
    _memory_saver = saver


def register_interrupt(thread_id: str) -> None:
    """Record that *thread_id* is currently suspended at a HITL interrupt."""
    _interrupt_timestamps[thread_id] = time.time()


def clear_interrupt(thread_id: str) -> None:
    """Remove *thread_id* from the pending registry (user resumed or pipeline completed)."""
    _interrupt_timestamps.pop(thread_id, None)


def start_cleanup_task(interval_seconds: int = 300, max_age_minutes: int = 30) -> None:
    """
    Start the background loop.  Call once from the FastAPI lifespan after the
    MemorySaver graph is ready.  Silently skips if no MemorySaver is registered.
    """
    global _cleanup_task
    _cleanup_task = asyncio.ensure_future(
        _cleanup_loop(interval_seconds=interval_seconds, max_age_minutes=max_age_minutes)
    )
    logger.info(
        "Interrupt cleanup task started (interval=%ds, max_age=%dmin).",
        interval_seconds,
        max_age_minutes,
    )


def stop_cleanup_task() -> None:
    """Cancel the background loop.  Call from the FastAPI lifespan shutdown path."""
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        _cleanup_task = None
        logger.info("Interrupt cleanup task stopped.")


# ---------------------------------------------------------------------------
# Core cleanup logic
# ---------------------------------------------------------------------------

async def cleanup_stale_threads(max_age_minutes: int = 30) -> int:
    """
    Prune MemorySaver checkpoints for threads that have been waiting on an interrupt
    longer than *max_age_minutes*.  Returns the number of threads pruned.

    Handles two internal layouts that LangGraph has used across versions:
      - Flat:  storage[thread_id] = {...}                    (thread_id is a top-level key)
      - Tuple: storage[(thread_id, checkpoint_ns, ...)] = …  (thread_id is key[0])
    """
    if _memory_saver is None:
        return 0

    cutoff = time.time() - max_age_minutes * 60
    stale = [tid for tid, ts in list(_interrupt_timestamps.items()) if ts < cutoff]
    if not stale:
        return 0

    storage = getattr(_memory_saver, "storage", None)
    writes = getattr(_memory_saver, "writes", None)
    pruned = 0

    for thread_id in stale:
        try:
            removed = False

            if storage is not None:
                if thread_id in storage:
                    # Flat layout: thread_id is a direct key.
                    del storage[thread_id]
                    removed = True
                else:
                    # Tuple-key layout: iterate and collect matching keys.
                    stale_keys = [
                        k for k in list(storage.keys())
                        if isinstance(k, tuple) and len(k) > 0 and k[0] == thread_id
                    ]
                    for k in stale_keys:
                        del storage[k]
                        removed = True

            if writes is not None:
                # Writes dict keys often embed the thread_id as a prefix.
                stale_write_keys = [
                    k for k in list(writes.keys())
                    if (k == thread_id) or (isinstance(k, str) and k.startswith(thread_id))
                    or (isinstance(k, tuple) and len(k) > 0 and k[0] == thread_id)
                ]
                for k in stale_write_keys:
                    del writes[k]

            if removed:
                pruned += 1
                logger.info(
                    "Pruned stale interrupted thread %s (idle > %d min).",
                    thread_id,
                    max_age_minutes,
                )
        except Exception:
            logger.exception("Failed to prune thread %s from MemorySaver.", thread_id)
        finally:
            # Always remove from registry even if storage pruning failed.
            _interrupt_timestamps.pop(thread_id, None)

    if pruned:
        logger.info("Interrupt cleanup: pruned %d stale thread(s).", pruned)
    return pruned


async def _cleanup_loop(interval_seconds: int = 300, max_age_minutes: int = 30) -> None:
    """Background coroutine: sleep, then prune, repeat."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await cleanup_stale_threads(max_age_minutes)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Unexpected error in interrupt cleanup loop.")
