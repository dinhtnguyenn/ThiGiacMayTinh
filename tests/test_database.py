from __future__ import annotations

import tempfile
import unittest
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
            self.assertEqual(database.profiles_for_workspace(first.id, include_embeddings=False), [])


if __name__ == "__main__":
    unittest.main()
