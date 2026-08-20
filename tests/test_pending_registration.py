from __future__ import annotations

import unittest

from server.pending_registration import PendingRegistrationStore


class PendingRegistrationStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = 1_700_000_000
        self.store = PendingRegistrationStore(60, clock=lambda: self.now)

    def create_pending(self):
        return self.store.create(
            name="Nguyen Van A",
            source_mode="camera",
            embedding=b"embedding",
            embedding_dim=512,
            quality_score=0.8,
            enrollment_token="continuation-token",
        )

    def test_confirm_payload_can_only_be_consumed_once(self) -> None:
        pending = self.create_pending()

        consumed = self.store.consume(pending.id)

        self.assertEqual(consumed, pending)
        self.assertIsNone(self.store.consume(pending.id))

    def test_cancel_discards_the_preview_without_persistence(self) -> None:
        pending = self.create_pending()

        self.assertTrue(self.store.discard(pending.id))
        self.assertIsNone(self.store.consume(pending.id))

    def test_expired_preview_is_not_available_for_confirmation(self) -> None:
        pending = self.create_pending()
        self.now += 60

        self.assertIsNone(self.store.consume(pending.id))


if __name__ == "__main__":
    unittest.main()
