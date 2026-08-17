from __future__ import annotations

import unittest

import numpy as np

from server.face_service import FaceAnalysisError, FaceObservation
from server.liveness import pose_offset, verify_pose_challenge


def observation(nose_x: float) -> FaceObservation:
    keypoints = np.array(
        [
            [100.0, 100.0],
            [200.0, 100.0],
            [nose_x, 150.0],
            [120.0, 200.0],
            [180.0, 200.0],
        ],
        dtype=np.float32,
    )
    return FaceObservation(embedding=np.ones(4, dtype=np.float32), keypoints=keypoints)


class LivenessTests(unittest.TestCase):
    def test_pose_offset_is_scale_independent(self) -> None:
        original = observation(160)
        scaled_keypoints = original.keypoints * 2

        self.assertAlmostEqual(pose_offset(original.keypoints), pose_offset(scaled_keypoints))

    def test_pose_change_passes_challenge(self) -> None:
        result = verify_pose_challenge(observation(150), observation(160))

        self.assertEqual(result.status, "challenge_passed")
        self.assertEqual(result.method, "two_frame_pose_challenge")
        self.assertGreaterEqual(result.pose_delta, 0.06)

    def test_small_pose_change_is_rejected(self) -> None:
        with self.assertRaises(FaceAnalysisError) as raised:
            verify_pose_challenge(observation(150), observation(154))

        self.assertEqual(raised.exception.code, "liveness_challenge_failed")


if __name__ == "__main__":
    unittest.main()
