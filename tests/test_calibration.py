from __future__ import annotations

import unittest

import numpy as np

from server.calibration import threshold_report
from server.database import StoredProfile, StoredProfileSample


def profile(profile_id: str, vectors: list[list[float]]) -> StoredProfile:
    samples = tuple(
        StoredProfileSample(
            id=f"{profile_id}-{index}",
            profile_id=profile_id,
            source_mode="image",
            created_at=index,
            embedding=np.asarray(vector, dtype=np.float32).tobytes(),
            embedding_dim=len(vector),
            quality_score=0.9,
        )
        for index, vector in enumerate(vectors)
    )
    return StoredProfile(profile_id, profile_id, "image", 0, b"", 0, samples)


class CalibrationTests(unittest.TestCase):
    def test_report_recommends_a_threshold_when_pairs_are_available(self) -> None:
        report = threshold_report(
            [profile("a", [[1, 0], [0.99, 0.01]]), profile("b", [[0, 1], [0.01, 0.99]])],
            current_threshold=0.45,
        )

        self.assertTrue(report["ready"])
        self.assertGreater(report["recommended_threshold"], 0.01)
        self.assertLess(report["recommended_threshold"], 0.99)
        self.assertEqual(report["genuine_pairs"], 2)
        self.assertEqual(report["impostor_pairs"], 4)

    def test_report_requires_more_than_one_profile_and_sample(self) -> None:
        report = threshold_report([profile("a", [[1, 0]])], current_threshold=0.45)

        self.assertFalse(report["ready"])


if __name__ == "__main__":
    unittest.main()
