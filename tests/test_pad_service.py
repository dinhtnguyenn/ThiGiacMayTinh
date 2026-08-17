from __future__ import annotations

import unittest
from pathlib import Path

import numpy as np

from server.pad_service import PresentationAttackService


class PresentationAttackServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = PresentationAttackService(
            Path("/tmp/minifasnet_v2.onnx"),
            "https://example.test/minifasnet_v2.onnx",
            "0" * 64,
            0.55,
            0.97,
        )

    def test_high_live_score_is_live(self) -> None:
        result = self.service._result_from_scores(np.array([0.91, 0.04, 0.05], dtype=np.float32))

        self.assertEqual(result.status, "live")
        self.assertIsNone(result.attack_type)

    def test_high_print_score_is_spoof(self) -> None:
        result = self.service._result_from_scores(np.array([0.002, 0.994, 0.004], dtype=np.float32))

        self.assertEqual(result.status, "spoof")
        self.assertEqual(result.attack_type, "print")

    def test_high_replay_score_is_spoof(self) -> None:
        result = self.service._result_from_scores(np.array([0.006, 0.003, 0.991], dtype=np.float32))

        self.assertEqual(result.status, "spoof")
        self.assertEqual(result.attack_type, "replay")

    def test_ambiguous_result_is_uncertain(self) -> None:
        result = self.service._result_from_scores(np.array([0.45, 0.31, 0.24], dtype=np.float32))

        self.assertEqual(result.status, "uncertain")
        self.assertIsNone(result.attack_type)


if __name__ == "__main__":
    unittest.main()
