from __future__ import annotations

import sys
import types
import unittest
from unittest.mock import patch

import numpy as np

from server.face_service import (
    FaceAnalysisError,
    FaceObservation,
    FaceQuality,
    InsightFaceService,
    highest_embedding_similarity,
    validate_enrollment_quality,
)


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


class EmbeddingSimilarityTests(unittest.TestCase):
    def test_returns_the_strongest_compatible_profile_sample(self) -> None:
        candidate = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        same_person = np.array([0.9, 0.1, 0.0], dtype=np.float32)
        other_person = np.array([0.0, 1.0, 0.0], dtype=np.float32)

        similarity = highest_embedding_similarity(
            candidate,
            [(other_person.tobytes(), 3), (same_person.tobytes(), 3)],
        )

        self.assertIsNotNone(similarity)
        assert similarity is not None
        self.assertGreater(similarity, 0.99)

    def test_ignores_incompatible_or_corrupt_embeddings(self) -> None:
        candidate = np.array([1.0, 0.0, 0.0], dtype=np.float32)

        similarity = highest_embedding_similarity(
            candidate,
            [(b"too-short", 3), (np.ones(4, dtype=np.float32).tobytes(), 4)],
        )

        self.assertIsNone(similarity)

    def test_accepts_a_serialized_candidate_from_an_adjusted_registration_crop(self) -> None:
        candidate = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        stored_sample = np.array([0.95, 0.05, 0.0], dtype=np.float32)

        similarity = highest_embedding_similarity(
            candidate.tobytes(),
            [(stored_sample.tobytes(), 3)],
        )

        self.assertIsNotNone(similarity)
        assert similarity is not None
        self.assertGreater(similarity, 0.99)

    def test_returns_none_for_a_malformed_serialized_candidate(self) -> None:
        self.assertIsNone(highest_embedding_similarity(b"bad", []))


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


class FaceAlignmentTests(unittest.TestCase):
    def test_creates_a_standardized_crop_from_five_landmarks(self) -> None:
        received: dict[str, object] = {}

        def norm_crop(image, landmarks, image_size):
            received["image"] = image
            received["landmarks"] = landmarks
            received["image_size"] = image_size
            return np.full((112, 112, 3), 127, dtype=np.uint8)

        fake_cv2 = types.SimpleNamespace(
            IMREAD_COLOR=1,
            IMWRITE_JPEG_QUALITY=2,
            error=RuntimeError,
            imdecode=lambda encoded, mode: np.zeros((200, 200, 3), dtype=np.uint8),
            imencode=lambda extension, image, options: (True, np.array([1, 2, 3], dtype=np.uint8)),
        )
        fake_face_align = types.SimpleNamespace(norm_crop=norm_crop)
        fake_utils = types.ModuleType("insightface.utils")
        fake_utils.face_align = fake_face_align
        fake_insightface = types.ModuleType("insightface")
        fake_insightface.utils = fake_utils
        detected_face = FaceObservation(
            embedding=np.ones(4, dtype=np.float32),
            keypoints=np.array([[50, 60], [150, 60], [100, 100], [65, 145], [135, 145]], dtype=np.float32),
        )

        with patch.dict(
            sys.modules,
            {"cv2": fake_cv2, "insightface": fake_insightface, "insightface.utils": fake_utils},
        ):
            aligned = InsightFaceService.aligned_face_preview(b"source-image", detected_face)

        self.assertEqual(aligned, b"\x01\x02\x03")
        self.assertEqual(received["image_size"], 112)
        self.assertTrue(np.array_equal(received["landmarks"], detected_face.keypoints))


if __name__ == "__main__":
    unittest.main()
