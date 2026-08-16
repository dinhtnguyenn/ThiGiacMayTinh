from __future__ import annotations

import tempfile
import unittest
import sqlite3
from pathlib import Path

from server.database import Database


class DatabaseTests(unittest.TestCase):
    def create_database(self, directory: str) -> Database:
        database = Database(Path(directory) / "faceops.sqlite3", retention_days=1, signing_secret="test-secret")
        database.initialize()
        return database

    def test_workspace_isolated_and_challenge_is_single_use(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = self.create_database(directory)
            workspace, token = database.create_workspace()

            self.assertEqual(database.workspace_for_token(token), workspace)
            self.assertIsNone(database.workspace_for_token("wrong-token"))

            challenge = database.create_challenge(workspace.id, ttl_seconds=90)
            self.assertTrue(database.consume_challenge(workspace.id, challenge.id))
            self.assertFalse(database.consume_challenge(workspace.id, challenge.id))

    def test_legacy_profiles_are_moved_to_the_shared_directory_before_pruning(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = self.create_database(directory)
            first, _ = database.create_workspace()
            database.add_profile(first.id, "Owner", "image", b"1234", 1)

            # A new process opening the existing database represents a CI/CD restart.
            database = self.create_database(directory)
            public = database.public_workspace()

            profiles = database.profiles_for_public_directory(include_embeddings=False)
            self.assertEqual({profile.name for profile in profiles}, {"Owner"})
            self.assertEqual(len(profiles[0].samples), 1)
            self.assertEqual(database.profiles_for_workspace(first.id, include_embeddings=False), [])

    def test_upgrade_adds_samples_without_rebuilding_an_old_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "faceops.sqlite3"
            with sqlite3.connect(path) as connection:
                connection.executescript(
                    """
                    CREATE TABLE workspaces (
                      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
                      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
                    );
                    CREATE TABLE face_profiles (
                      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
                      source_mode TEXT NOT NULL, embedding BLOB NOT NULL,
                      embedding_dim INTEGER NOT NULL, created_at INTEGER NOT NULL
                    );
                    INSERT INTO workspaces VALUES ('legacy', 'hash', 1, 2147483647);
                    INSERT INTO face_profiles VALUES ('profile-1', 'legacy', 'Owner', 'image', X'0102', 2, 1);
                    """
                )

            database = Database(path, retention_days=1, signing_secret="test-secret")
            database.initialize()

            with sqlite3.connect(path) as connection:
                columns = {row[1] for row in connection.execute("PRAGMA table_info(face_profiles)")}
            profiles = database.profiles_for_public_directory(include_embeddings=True)
            self.assertIn("enrollment_token_hash", columns)
            self.assertEqual(len(profiles), 1)
            self.assertEqual(len(profiles[0].samples), 1)
            self.assertEqual(profiles[0].samples[0].embedding, b"\x01\x02")

    def test_multiple_enrollment_captures_share_one_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = self.create_database(directory)
            workspace = database.public_workspace()

            first = database.enroll_profile_sample(
                workspace.id, "Nguyen Van A", "image", b"1111", 1, 0.9, max_samples=3
            )
            self.assertIsNotNone(first)
            assert first is not None
            second = database.enroll_profile_sample(
                workspace.id,
                "nguyen van a",
                "image",
                b"2222",
                1,
                0.8,
                max_samples=3,
                enrollment_token=first.enrollment_token,
            )

            self.assertIsNotNone(second)
            assert second is not None
            self.assertTrue(first.created_profile)
            self.assertFalse(second.created_profile)
            self.assertEqual(first.profile.id, second.profile.id)
            self.assertEqual(second.sample_count, 2)
            profiles = database.profiles_for_public_directory(include_embeddings=True)
            self.assertEqual(len(profiles), 1)
            self.assertEqual(len(profiles[0].samples), 2)
            detail = database.profile_for_workspace(workspace.id, first.profile.id, include_embeddings=True)
            self.assertIsNotNone(detail)
            assert detail is not None
            self.assertEqual({sample.embedding for sample in detail.samples}, {b"1111", b"2222"})
            self.assertIsNone(database.profile_for_workspace(workspace.id, "missing", include_embeddings=True))

    def test_name_alone_cannot_add_a_sample_to_an_existing_profile(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = self.create_database(directory)
            workspace = database.public_workspace()
            first = database.enroll_profile_sample(workspace.id, "Owner", "image", b"1111", 1, 0.8, 3)
            self.assertIsNotNone(first)

            other = database.enroll_profile_sample(workspace.id, "owner", "image", b"2222", 1, 0.8, 3)

            self.assertIsNotNone(other)
            assert first is not None and other is not None
            self.assertNotEqual(first.profile.id, other.profile.id)
            profiles = database.profiles_for_public_directory(include_embeddings=True)
            self.assertEqual(len(profiles), 2)
            self.assertEqual({len(profile.samples) for profile in profiles}, {1})

    def test_enrollment_respects_the_sample_limit_without_creating_an_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = self.create_database(directory)
            workspace = database.public_workspace()
            first = database.enroll_profile_sample(workspace.id, "Owner", "image", b"1111", 1, 0.8, 1)
            self.assertIsNotNone(first)
            assert first is not None
            rejected = database.enroll_profile_sample(
                workspace.id, "owner", "image", b"2222", 1, 0.8, 1, first.enrollment_token
            )

            self.assertIsNone(rejected)
            profiles = database.profiles_for_public_directory(include_embeddings=True)
            self.assertEqual(len(profiles), 1)
            self.assertEqual(len(profiles[0].samples), 1)


if __name__ == "__main__":
    unittest.main()
