"""InsightFace loading and one-face embedding extraction."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np


class FaceAnalysisError(ValueError):
    """Raised when an uploaded image is unsuitable for face recognition."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class FaceObservation:
    embedding: np.ndarray
    keypoints: np.ndarray


class InsightFaceService:
    def __init__(self, model_root: Path, model_name: str) -> None:
        self.model_root = model_root
        self.model_name = model_name
        self._analyzer = None
        self._load_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._analyzer is not None

    def _get_analyzer(self):
        if self._analyzer is not None:
            return self._analyzer
        with self._load_lock:
            if self._analyzer is None:
                try:
                    from insightface.app import FaceAnalysis
                except ImportError as error:
                    raise RuntimeError(
                        "InsightFace is not installed. Install requirements.txt before starting the API."
                    ) from error
                self.model_root.mkdir(parents=True, exist_ok=True)
                analyzer = FaceAnalysis(
                    name=self.model_name,
                    root=str(self.model_root),
                    providers=["CPUExecutionProvider"],
                )
                analyzer.prepare(ctx_id=0, det_size=(640, 640))
                self._analyzer = analyzer
        return self._analyzer

    def analyze(self, image_bytes: bytes) -> FaceObservation:
        try:
            import cv2
        except ImportError as error:
            raise RuntimeError(
                "OpenCV is not installed. Install requirements.txt before starting the API."
            ) from error

        encoded = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise FaceAnalysisError("invalid_image", "Tệp không phải một ảnh hợp lệ.")

        faces = self._get_analyzer().get(image)
        if not faces:
            raise FaceAnalysisError("face_not_found", "Không tìm thấy khuôn mặt trong khung hình.")
        if len(faces) != 1:
            raise FaceAnalysisError(
                "multiple_faces",
                "Chỉ đặt một khuôn mặt trong khung hình để bảo vệ quyền riêng tư.",
            )

        face = faces[0]
        embedding = np.asarray(face.normed_embedding, dtype=np.float32)
        keypoints = np.asarray(face.kps, dtype=np.float32)
        if embedding.ndim != 1 or keypoints.shape[0] < 3:
            raise FaceAnalysisError("face_model_error", "Model không trả về embedding hoặc landmarks hợp lệ.")
        return FaceObservation(
            embedding=np.ascontiguousarray(embedding),
            keypoints=np.ascontiguousarray(keypoints),
        )
