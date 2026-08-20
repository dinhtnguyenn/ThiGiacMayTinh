"""Short-lived in-memory enrollment previews that are never written to SQLite."""

from __future__ import annotations

import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class PendingRegistration:
    """Validated embedding held only until the visitor confirms enrollment."""

    id: str
    name: str
    source_mode: str
    embedding: bytes
    embedding_dim: int
    quality_score: float
    enrollment_token: str | None
    expires_at: int


class PendingRegistrationStore:
    """Keep a one-time enrollment payload in process memory for a short time."""

    def __init__(self, ttl_seconds: int, clock: Callable[[], float] = time.time) -> None:
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._items: dict[str, PendingRegistration] = {}
        self._lock = threading.Lock()

    def create(
        self,
        *,
        name: str,
        source_mode: str,
        embedding: bytes,
        embedding_dim: int,
        quality_score: float,
        enrollment_token: str | None,
    ) -> PendingRegistration:
        now = int(self._clock())
        pending = PendingRegistration(
            id=secrets.token_urlsafe(24),
            name=name,
            source_mode=source_mode,
            embedding=embedding,
            embedding_dim=embedding_dim,
            quality_score=quality_score,
            enrollment_token=enrollment_token,
            expires_at=now + self.ttl_seconds,
        )
        with self._lock:
            self._purge_expired(now)
            self._items[pending.id] = pending
        return pending

    def consume(self, pending_id: str) -> PendingRegistration | None:
        """Return a preview at most once so a confirm request cannot duplicate a sample."""

        now = int(self._clock())
        with self._lock:
            self._purge_expired(now)
            return self._items.pop(pending_id, None)

    def peek(self, pending_id: str) -> PendingRegistration | None:
        """Read a valid preview without consuming it so an edited crop can be checked first."""

        now = int(self._clock())
        with self._lock:
            self._purge_expired(now)
            return self._items.get(pending_id)

    def discard(self, pending_id: str) -> bool:
        now = int(self._clock())
        with self._lock:
            self._purge_expired(now)
            return self._items.pop(pending_id, None) is not None

    def _purge_expired(self, now: int) -> None:
        expired_ids = [item_id for item_id, item in self._items.items() if item.expires_at <= now]
        for item_id in expired_ids:
            del self._items[item_id]
