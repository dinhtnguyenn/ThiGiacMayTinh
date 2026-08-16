"""Small SQLite repository scoped by an opaque workspace token."""

from __future__ import annotations

import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .security import create_workspace_token, token_digest


@dataclass(frozen=True)
class Workspace:
    id: str
    expires_at: int


@dataclass(frozen=True)
class Challenge:
    id: str
    expires_at: int


@dataclass(frozen=True)
class StoredProfile:
    id: str
    name: str
    source_mode: str
    created_at: int
    embedding: bytes
    embedding_dim: int


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS liveness_challenges (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS face_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_mode TEXT NOT NULL,
  embedding BLOB NOT NULL,
  embedding_dim INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS face_profiles_workspace_idx
  ON face_profiles(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notebook_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  nbformat TEXT NOT NULL,
  code_cells INTEGER NOT NULL,
  markdown_cells INTEGER NOT NULL,
  kernel_name TEXT,
  created_at INTEGER NOT NULL
);
"""


class Database:
    def __init__(self, path: Path, retention_days: int, signing_secret: str) -> None:
        self.path = path
        self.retention_days = retention_days
        self.signing_secret = signing_secret

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as connection:
            connection.executescript(SCHEMA)
            self._prune_expired(connection, int(time.time()))

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _prune_expired(connection: sqlite3.Connection, now: int) -> None:
        connection.execute("DELETE FROM liveness_challenges WHERE expires_at <= ?", (now,))
        connection.execute("DELETE FROM workspaces WHERE expires_at <= ?", (now,))

    def create_workspace(self) -> tuple[Workspace, str]:
        now = int(time.time())
        token = create_workspace_token()
        workspace = Workspace(
            id=str(uuid.uuid4()),
            expires_at=now + self.retention_days * 24 * 60 * 60,
        )
        with self.connection() as connection:
            self._prune_expired(connection, now)
            connection.execute(
                "INSERT INTO workspaces (id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (workspace.id, token_digest(token, self.signing_secret), now, workspace.expires_at),
            )
        return workspace, token

    def workspace_for_token(self, token: str) -> Workspace | None:
        now = int(time.time())
        with self.connection() as connection:
            self._prune_expired(connection, now)
            row = connection.execute(
                "SELECT id, expires_at FROM workspaces WHERE token_hash = ? AND expires_at > ?",
                (token_digest(token, self.signing_secret), now),
            ).fetchone()
        return Workspace(id=row["id"], expires_at=row["expires_at"]) if row else None

    def create_challenge(self, workspace_id: str, ttl_seconds: int) -> Challenge:
        now = int(time.time())
        challenge = Challenge(id=str(uuid.uuid4()), expires_at=now + ttl_seconds)
        with self.connection() as connection:
            self._prune_expired(connection, now)
            connection.execute(
                "INSERT INTO liveness_challenges (id, workspace_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (challenge.id, workspace_id, now, challenge.expires_at),
            )
        return challenge

    def consume_challenge(self, workspace_id: str, challenge_id: str) -> bool:
        now = int(time.time())
        with self.connection() as connection:
            result = connection.execute(
                """
                UPDATE liveness_challenges
                SET used_at = ?
                WHERE id = ? AND workspace_id = ? AND used_at IS NULL AND expires_at > ?
                """,
                (now, challenge_id, workspace_id, now),
            )
        return result.rowcount == 1

    def add_profile(
        self,
        workspace_id: str,
        name: str,
        source_mode: str,
        embedding: bytes,
        embedding_dim: int,
    ) -> StoredProfile:
        profile = StoredProfile(
            id=str(uuid.uuid4()),
            name=name,
            source_mode=source_mode,
            embedding=embedding,
            embedding_dim=embedding_dim,
            created_at=int(time.time()),
        )
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO face_profiles
                  (id, workspace_id, name, source_mode, embedding, embedding_dim, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    profile.id,
                    workspace_id,
                    profile.name,
                    profile.source_mode,
                    profile.embedding,
                    profile.embedding_dim,
                    profile.created_at,
                ),
            )
        return profile

    def profiles_for_workspace(self, workspace_id: str, include_embeddings: bool) -> list[StoredProfile]:
        fields = "id, name, source_mode, created_at, embedding, embedding_dim" if include_embeddings else "id, name, source_mode, created_at, X'' AS embedding, 0 AS embedding_dim"
        with self.connection() as connection:
            rows = connection.execute(
                f"SELECT {fields} FROM face_profiles WHERE workspace_id = ? ORDER BY created_at DESC",
                (workspace_id,),
            ).fetchall()
        return [
            StoredProfile(
                id=row["id"],
                name=row["name"],
                source_mode=row["source_mode"],
                embedding=bytes(row["embedding"]),
                embedding_dim=row["embedding_dim"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def add_notebook(
        self,
        workspace_id: str,
        filename: str,
        nbformat: str,
        code_cells: int,
        markdown_cells: int,
        kernel_name: str | None,
    ) -> str:
        notebook_id = str(uuid.uuid4())
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO notebook_imports
                  (id, workspace_id, filename, nbformat, code_cells, markdown_cells, kernel_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    notebook_id,
                    workspace_id,
                    filename,
                    nbformat,
                    code_cells,
                    markdown_cells,
                    kernel_name,
                    int(time.time()),
                ),
            )
        return notebook_id

    def delete_workspace(self, workspace_id: str) -> bool:
        with self.connection() as connection:
            result = connection.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
        return result.rowcount == 1
