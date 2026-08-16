"""InsightFace loading and one-face embedding extraction."""

from __future__ import annotations

import threading
import time
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
    bbox: np.ndarray | None = None


@dataclass(frozen=True)
class FaceAnalysisTrace:
    """Measured timings for the two real stages inside the local face engine."""

    decode_ms: int
    inference_ms: int
    image_width: int
    image_height: int
    face_count: int


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

    def analyze_many(self, image_bytes: bytes) -> tuple[list[FaceObservation], FaceAnalysisTrace]:
        """Extract every detectable face so recognition can handle a shared frame."""

        try:
            import cv2
        except ImportError as error:
            raise RuntimeError(
                "OpenCV is not installed. Install requirements.txt before starting the API."
            ) from error

        decode_started = time.perf_counter()
        encoded = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise FaceAnalysisError("invalid_image", "Tệp không phải một ảnh hợp lệ.")

        decode_ms = round((time.perf_counter() - decode_started) * 1000)
        inference_started = time.perf_counter()
        faces = self._get_analyzer().get(image)
        observations: list[FaceObservation] = []
        for face in faces:
            embedding = np.asarray(face.normed_embedding, dtype=np.float32)
            keypoints = np.asarray(face.kps, dtype=np.float32)
            bbox = np.asarray(face.bbox, dtype=np.float32)
            if embedding.ndim != 1 or keypoints.shape[0] < 3 or bbox.shape != (4,):
                raise FaceAnalysisError("face_model_error", "Model không trả về embedding, landmarks hoặc khung mặt hợp lệ.")
            observations.append(
                FaceObservation(
                    embedding=np.ascontiguousarray(embedding),
                    keypoints=np.ascontiguousarray(keypoints),
                    bbox=np.ascontiguousarray(bbox),
                )
            )
        return observations, FaceAnalysisTrace(
            decode_ms=decode_ms,
            inference_ms=round((time.perf_counter() - inference_started) * 1000),
            image_width=int(image.shape[1]),
            image_height=int(image.shape[0]),
            face_count=len(observations),
        )

    def analyze(self, image_bytes: bytes) -> tuple[FaceObservation, FaceAnalysisTrace]:
        """Keep registration strict: it must receive exactly one consenting person."""

        observations, trace = self.analyze_many(image_bytes)
        if not observations:
            raise FaceAnalysisError("face_not_found", "Không tìm thấy khuôn mặt trong khung hình.")
        if len(observations) != 1:
            raise FaceAnalysisError(
                "multiple_faces",
                "Đăng ký chỉ nhận một khuôn mặt trong khung hình để tránh lưu nhầm dữ liệu.",
            )
        return observations[0], trace
