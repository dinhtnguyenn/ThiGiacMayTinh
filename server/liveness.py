"""A replay-resistant-to-static-image liveness challenge, not a certified PAD model."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .face_service import FaceAnalysisError, FaceObservation


@dataclass(frozen=True)
class LivenessResult:
    status: str
    method: str
    pose_delta: float


def pose_offset(keypoints: np.ndarray) -> float:
    """Return a scale-independent horizontal head-pose signal from landmarks."""

    left_eye, right_eye, nose = keypoints[:3]
    eye_center_x = (float(left_eye[0]) + float(right_eye[0])) / 2
    eye_distance = abs(float(right_eye[0]) - float(left_eye[0]))
    if eye_distance < 1:
        raise FaceAnalysisError("liveness_landmarks", "Không đọc được landmarks để kiểm tra liveness.")
    return (float(nose[0]) - eye_center_x) / eye_distance


def verify_pose_challenge(
    baseline: FaceObservation,
    challenge: FaceObservation,
    min_pose_delta: float = 0.045,
) -> LivenessResult:
    """Require a measurable face-pose change between two freshly captured frames."""

    baseline_offset = pose_offset(baseline.keypoints)
    challenge_offset = pose_offset(challenge.keypoints)
    pose_delta = abs(challenge_offset - baseline_offset)
    if pose_delta < min_pose_delta:
        raise FaceAnalysisError(
            "liveness_challenge_failed",
            "Không thấy thay đổi pose đủ rõ. Giữ thẳng đầu rồi xoay nhẹ sang một bên và thử lại.",
        )
    return LivenessResult(
        status="challenge_passed",
        method="two_frame_pose_challenge",
        pose_delta=round(pose_delta, 4),
    )
