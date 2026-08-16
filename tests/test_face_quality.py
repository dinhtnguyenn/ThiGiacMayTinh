from __future__ import annotations

import unittest

import numpy as np

from server.face_service import FaceAnalysisError, FaceObservation, FaceQuality, validate_enrollment_quality


def observation(quality: FaceQuality) -> FaceObservation:
    return FaceObservation(
        embedding=np.ones(4, dtype=np.float32),
        keypoints=np.ones((5, 2), dtype=np.float32),
        quality=quality,
    )


class FaceQualityTests(unittest.TestCase):
    def validate(self, quality: FaceQuality) -> FaceQuality:
        return validate_enrollment_quality(
            observation(quality),
            min_face_size=120,
            min_detection_score=0.65,
            min_sharpness=35,
            min_brightness=45,
            max_brightness=220,
        )

    def test_accepts_a_clear_well_lit_face(self) -> None:
        quality = FaceQuality(180, 190, 0.95, 130, 80, 0.87)

        self.assertEqual(self.validate(quality), quality)

    def test_rejects_a_small_face_before_storing_an_embedding(self) -> None:
        with self.assertRaisesRegex(FaceAnalysisError, "quá nhỏ") as raised:
            self.validate(FaceQuality(90, 150, 0.95, 130, 80, 0.6))

        self.assertEqual(raised.exception.code, "face_too_small")

    def test_rejects_a_blurry_face_before_storing_an_embedding(self) -> None:
        with self.assertRaisesRegex(FaceAnalysisError, "bị mờ") as raised:
            self.validate(FaceQuality(180, 190, 0.95, 130, 20, 0.6))

        self.assertEqual(raised.exception.code, "image_too_blurry")


if __name__ == "__main__":
    unittest.main()
