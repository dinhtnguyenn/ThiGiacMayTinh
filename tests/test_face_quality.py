from __future__ import annotations

import unittest

import numpy as np

from server.face_service import FaceAnalysisError, FaceObservation, FaceQuality, InsightFaceService, validate_enrollment_quality


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


class FaceCropBoundsTests(unittest.TestCase):
    def test_adds_adjustment_room_around_the_detected_face(self) -> None:
        face = FaceObservation(
            embedding=np.ones(4, dtype=np.float32),
            keypoints=np.ones((5, 2), dtype=np.float32),
            bbox=np.array([100, 100, 200, 300], dtype=np.float32),
        )

        bounds = InsightFaceService.crop_face_bounds(1000, 800, face)

        self.assertEqual(bounds, (65, 30, 235, 370))

    def test_crop_bounds_stay_inside_the_source_image(self) -> None:
        face = FaceObservation(
            embedding=np.ones(4, dtype=np.float32),
            keypoints=np.ones((5, 2), dtype=np.float32),
            bbox=np.array([0, 0, 100, 100], dtype=np.float32),
        )

        bounds = InsightFaceService.crop_face_bounds(200, 200, face)

        self.assertEqual(bounds, (0, 0, 135, 135))

    def test_initial_selection_never_cuts_a_face_at_the_image_edge(self) -> None:
        face = FaceObservation(
            embedding=np.ones(4, dtype=np.float32),
            keypoints=np.ones((5, 2), dtype=np.float32),
            bbox=np.array([0, 0, 100, 100], dtype=np.float32),
        )

        selection = InsightFaceService.initial_crop_selection(200, 200, face)

        self.assertEqual(selection["x"], 0.0)
        self.assertEqual(selection["y"], 0.0)
        self.assertGreaterEqual(selection["width"], 100 / 135)
        self.assertGreaterEqual(selection["height"], 100 / 135)


if __name__ == "__main__":
    unittest.main()
