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

    def test_profiles_do_not_leave_their_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = self.create_database(directory)
            first, _ = database.create_workspace()
            second, _ = database.create_workspace()
            database.add_profile(first.id, "Owner", "image", b"1234", 1)

            self.assertEqual(len(database.profiles_for_workspace(first.id, include_embeddings=False)), 1)
            self.assertEqual(database.profiles_for_workspace(second.id, include_embeddings=False), [])


if __name__ == "__main__":
    unittest.main()
