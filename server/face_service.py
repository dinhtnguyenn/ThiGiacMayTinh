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
    quality: "FaceQuality | None" = None


@dataclass(frozen=True)
class FaceQuality:
    """Non-biometric image diagnostics calculated from the detected face crop."""

    width: int
    height: int
    detection_score: float
    brightness: float
    sharpness: float
    score: float


@dataclass(frozen=True)
class FaceAnalysisTrace:
    """Measured timings for the two real stages inside the local face engine."""

    decode_ms: int
    inference_ms: int
    image_width: int
    image_height: int
    face_count: int


def validate_enrollment_quality(
    observation: FaceObservation,
    *,
    min_face_size: int,
    min_detection_score: float,
    min_sharpness: float,
    min_brightness: float,
    max_brightness: float,
) -> FaceQuality:
    """Reject captures that are predictably poor enrollment references.

    These checks do not claim liveness.  They only prevent saving a tiny, blurry,
    badly exposed, or weakly detected face that would make later matching unreliable.
    """

    quality = observation.quality
    if quality is None:
        raise FaceAnalysisError("quality_unavailable", "Không thể đánh giá chất lượng khuôn mặt. Hãy chụp lại ảnh.")
    if min(quality.width, quality.height) < min_face_size:
        raise FaceAnalysisError(
            "face_too_small",
            f"Khuôn mặt quá nhỏ. Hãy đưa mặt gần camera hơn (ít nhất {min_face_size} px).",
        )
    if quality.detection_score < min_detection_score:
        raise FaceAnalysisError(
            "face_detection_uncertain",
            "Khuôn mặt chưa rõ. Hãy nhìn thẳng camera và tránh che mặt.",
        )
    if quality.sharpness < min_sharpness:
        raise FaceAnalysisError(
            "image_too_blurry",
            "Ảnh khuôn mặt bị mờ. Giữ yên camera và chụp lại ở nơi đủ sáng.",
        )
    if quality.brightness < min_brightness:
        raise FaceAnalysisError(
            "image_too_dark",
            "Ảnh khuôn mặt quá tối. Hãy tăng ánh sáng phía trước mặt.",
        )
    if quality.brightness > max_brightness:
        raise FaceAnalysisError(
            "image_too_bright",
            "Ảnh khuôn mặt quá sáng. Hãy tránh đèn hoặc cửa sổ chiếu thẳng vào mặt.",
        )
    return quality


class InsightFaceService:
    def __init__(self, model_root: Path, model_name: str, detector_size: int = 512) -> None:
        self.model_root = model_root
        self.model_name = model_name
        self.detector_size = detector_size
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
                analyzer.prepare(ctx_id=0, det_size=(self.detector_size, self.detector_size))
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
            quality = self._face_quality(image, bbox, float(getattr(face, "det_score", 0.0)))
            observations.append(
                FaceObservation(
                    embedding=np.ascontiguousarray(embedding),
                    keypoints=np.ascontiguousarray(keypoints),
                    bbox=np.ascontiguousarray(bbox),
                    quality=quality,
                )
            )
        return observations, FaceAnalysisTrace(
            decode_ms=decode_ms,
            inference_ms=round((time.perf_counter() - inference_started) * 1000),
            image_width=int(image.shape[1]),
            image_height=int(image.shape[0]),
            face_count=len(observations),
        )

    @staticmethod
    def _face_quality(image: np.ndarray, bbox: np.ndarray, detection_score: float) -> FaceQuality:
        """Measure lighting and focus on the detected crop, never persisting pixels."""

        import cv2

        image_height, image_width = image.shape[:2]
        x1, y1, x2, y2 = (int(round(float(value))) for value in bbox)
        x1 = min(max(x1, 0), image_width)
        x2 = min(max(x2, 0), image_width)
        y1 = min(max(y1, 0), image_height)
        y2 = min(max(y2, 0), image_height)
        crop = image[y1:y2, x1:x2]
        width = max(0, x2 - x1)
        height = max(0, y2 - y1)
        if crop.size == 0:
            return FaceQuality(width, height, detection_score, 0.0, 0.0, 0.0)
        grayscale = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        brightness = float(grayscale.mean())
        sharpness = float(cv2.Laplacian(grayscale, cv2.CV_64F).var())
        size_score = min(1.0, min(width, height) / 220.0)
        exposure_score = max(0.0, 1.0 - abs(brightness - 135.0) / 135.0)
        focus_score = min(1.0, sharpness / 120.0)
        score = max(0.0, min(1.0, (size_score + exposure_score + focus_score + detection_score) / 4.0))
        return FaceQuality(width, height, detection_score, brightness, sharpness, score)

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
